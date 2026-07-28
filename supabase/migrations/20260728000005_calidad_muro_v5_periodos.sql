-- Muro v5: el ranking con los dos ejes separados, en tres temporalidades.
--
-- Dos cambios de fondo sobre v4, ambos de Mauricio mirando la pantalla:
--
--   1. LA COLUMNA DE CUMPLIMIENTO NO ORDENABA. El semaforo esta diseñado para
--      UNA llamada (rojo si tiene al menos una bandera critica). Agregado a un
--      dia con 15 llamadas por agente, casi todos salen en rojo, y una columna
--      donde 6 de 7 filas valen lo mismo no ordena: ocupa espacio.
--
--      En su lugar van las DOS columnas de los dos ejes de la rubrica:
--        · TECNICA  = promedio de `puntaje_tecnico` del periodo (0-100).
--        · BANDERAS = conteo de hallazgos de severidad critica del periodo.
--
--      Conteo, no promedio: un error critico no se promedia con nada. La
--      columna LLAMADAS al lado da el volumen para poder comparar agentes.
--
--      Al separarlos aparece lo que una sola columna escondia: Karina y Liliana
--      empatan en tecnica (70) con 4 y 6 criticas; Hector tiene la tecnica mas
--      baja (62) y solo 3 criticas, mientras Felipe con 64 tiene 12. Ejecutar
--      bien la venta y exponer a la empresa son cosas independientes.
--
--   2. TRES TEMPORALIDADES. El muro rota solo entre dia, semana y mes: nadie
--      toca un televisor. Se devuelven las tres en la MISMA llamada en vez de
--      re-consultar en cada giro — asi la rotacion no depende de la red y un
--      refresco de datos no puede dejar una pantalla en blanco a mitad de ciclo.
--
-- Semana y mes son ventanas MOVILES (ultimos 7 y 30 dias), no semana ni mes
-- calendario. Un lunes, "la semana" calendario mostraria un solo dia, que en un
-- televisor es peor que no mostrar nada. Cada periodo devuelve su `desde` y su
-- `hasta` para que la pantalla pueda decir de que rango habla.
--
-- Se va la columna COBRADO del ranking: el desglose cobrado / a cuotas vive en
-- el heroe y no le hace falta a esta tabla.

-- ── Helper: ranking de un rango de fechas ───────────────────────────────────
--
-- Devuelve `{ filas, umbrales, desde, hasta }`.
--
-- Los UMBRALES de color salen del propio dato, no escritos a mano: son los
-- terciles (p33 / p67) del equipo EN ESE PERIODO. Un umbral fijo ("tecnica < 70
-- es malo") es una opinion sobre una operacion que no conocemos y envejece mal;
-- los terciles se auto-normalizan y siempre señalan el mejor y el peor tercio.
-- Cuando no hay dispersion (p33 = p67) la pantalla no pinta nada, que es lo
-- honesto: no hay a quien señalar.
create or replace function public.calidad_ranking_periodo(
  p_workspace_id uuid,
  p_desde        date,
  p_hasta        date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with base as (
    select
      l.id,
      -- Nombre de pila desde el arranque: el apellido no existe en ningun punto
      -- del pipeline, ni siquiera en un agregado intermedio. El muro es publico.
      split_part(l.agente_nombre, ' ', 1) as agente,
      l.puntaje_tecnico,
      l.cerro_venta
    from calidad_llamadas l
    where l.workspace_id = p_workspace_id
      and (l.fecha_hora at time zone 'America/Bogota')::date between p_desde and p_hasta
  ),
  criticas as (
    select b.agente, count(*) as n
    from calidad_llamadas_hallazgos h
    join base b on b.id = h.llamada_id
    where h.eje = 'cumplimiento' and h.severidad = 'critica'
    group by 1
  ),
  agg as (
    select
      b.agente,
      count(*)                                   as llamadas,
      count(*) filter (where b.cerro_venta)      as cierres,
      round(avg(b.puntaje_tecnico))::int         as tecnica,
      coalesce(max(c.n), 0)::int                 as banderas
    from base b
    left join criticas c on c.agente = b.agente
    group by b.agente
  ),
  umbrales as (
    select
      percentile_cont(0.33) within group (order by tecnica)  as tecnica_baja,
      percentile_cont(0.67) within group (order by tecnica)  as tecnica_alta,
      percentile_cont(0.33) within group (order by banderas) as banderas_baja,
      percentile_cont(0.67) within group (order by banderas) as banderas_alta
    from agg
  )
  select jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'filas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'agente',    agente,
          'llamadas',  llamadas,
          'cierres',   cierres,
          'pctCierre', case when llamadas > 0 then round(100.0 * cierres / llamadas) else 0 end,
          'tecnica',   tecnica,
          'banderas',  banderas
        )
        -- Orden por cierres: asi se lee un ranking de ventas. Tecnica y
        -- banderas son las columnas que lo desmienten o lo confirman, no las
        -- que ordenan — por eso el desempate es por VOLUMEN, no por calidad.
        -- Desempatar por tecnica dejaria que el eje de calidad reordenara un
        -- ranking de ventas por la puerta de atras.
        order by cierres desc, llamadas desc, agente
      ) from agg
    ), '[]'::jsonb),
    'umbrales', (
      select jsonb_build_object(
        'tecnicaBaja',  tecnica_baja,
        'tecnicaAlta',  tecnica_alta,
        'banderasBaja', banderas_baja,
        'banderasAlta', banderas_alta
      ) from umbrales
    )
  );
$$;

revoke execute on function public.calidad_ranking_periodo(uuid, date, date) from public;
revoke execute on function public.calidad_ranking_periodo(uuid, date, date) from anon;
grant  execute on function public.calidad_ranking_periodo(uuid, date, date) to authenticated;
grant  execute on function public.calidad_ranking_periodo(uuid, date, date) to service_role;

-- ── Muro ────────────────────────────────────────────────────────────────────
create or replace function public.get_calidad_muro(
  p_workspace_id uuid,
  p_fecha        date default (now() at time zone 'America/Bogota')::date
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with efectiva as (
    select coalesce(
      (select p_fecha
        where exists (
          select 1 from calidad_llamadas
          where workspace_id = p_workspace_id
            and (fecha_hora at time zone 'America/Bogota')::date = p_fecha
        )),
      (select max((fecha_hora at time zone 'America/Bogota')::date)
         from calidad_llamadas where workspace_id = p_workspace_id)
    ) as fecha
  ),
  llamadas_dia as (
    select l.*
    from calidad_llamadas l, efectiva e
    where l.workspace_id = p_workspace_id
      and (l.fecha_hora at time zone 'America/Bogota')::date = e.fecha
  )
  select jsonb_build_object(
    'fecha', (select fecha from efectiva),
    'esFallback', (select fecha from efectiva) is distinct from p_fecha,

    -- ── Heroe: siempre el DIA, no rota ──
    --
    -- La rotacion es de la tabla. El heroe responde "como vamos hoy" y cambiarlo
    -- cada 20 s obligaria a leer dos veces para saber de que periodo habla.
    'cierres', (
      select jsonb_build_object(
        'total',    count(*) filter (where cerro_venta),
        'montoUsd', coalesce(sum(monto_usd) filter (where cerro_venta), 0),
        'llamadas', count(*),
        'pctCierre', case when count(*) > 0
                          then round(100.0 * count(*) filter (where cerro_venta) / count(*))
                          else 0 end,
        'montoUnitarioUsd', coalesce(max(monto_usd) filter (where cerro_venta), 0),
        'tarjeta', jsonb_build_object(
          'n',        count(*) filter (where cerro_venta and forma_pago = 'tarjeta'),
          'montoUsd', coalesce(sum(monto_usd) filter (where cerro_venta and forma_pago = 'tarjeta'), 0)
        ),
        'cuenta', jsonb_build_object(
          'n',        count(*) filter (where cerro_venta and forma_pago = 'cuenta'),
          'montoUsd', coalesce(sum(monto_usd) filter (where cerro_venta and forma_pago = 'cuenta'), 0),
          'primeraCuotaUsd', round(coalesce(sum(monto_usd) filter (where cerro_venta and forma_pago = 'cuenta'), 0) / 6.0, 2)
        )
      ) from llamadas_dia
    ),

    -- ── Ranking en tres temporalidades ──
    'rankings', jsonb_build_object(
      'dia',    calidad_ranking_periodo(p_workspace_id, (select fecha from efectiva), (select fecha from efectiva)),
      'semana', calidad_ranking_periodo(p_workspace_id, (select fecha from efectiva) - 6,  (select fecha from efectiva)),
      'mes',    calidad_ranking_periodo(p_workspace_id, (select fecha from efectiva) - 29, (select fecha from efectiva))
    ),

    -- ── Flujo: 10 ultimas del dia ──
    'ultimas', coalesce((
      select jsonb_agg(x order by ord desc) from (
        select jsonb_build_object(
                 'hora',       to_char(fecha_hora at time zone 'America/Bogota', 'HH24:MI'),
                 'agente',     split_part(agente_nombre, ' ', 1),
                 'tecnica',    puntaje_tecnico,
                 'semaforo',   semaforo,
                 'cerroVenta', cerro_venta
               ) x,
               fecha_hora ord
        from llamadas_dia
        order by fecha_hora desc
        limit 10
      ) s
    ), '[]'::jsonb),

    -- ── Sello del encabezado ──
    'cobertura', (
      select jsonb_build_object(
        'recibidas', coalesce(recibidas, 0),
        'auditadas', coalesce(auditadas, 0),
        'baseline',  coalesce(baseline_manual, 0),
        'pct', case when coalesce(recibidas, 0) > 0
                    then round(100.0 * auditadas / recibidas) else 0 end
      )
      from calidad_cobertura_dia c, efectiva e
      where c.workspace_id = p_workspace_id and c.fecha = e.fecha
    ),

    -- ── Banda destacada: lo unico accionable para el piso ──
    'banderaTop', (
      select jsonb_build_object('codigo', h.codigo, 'titulo', min(h.titulo), 'veces', count(*))
      from calidad_llamadas_hallazgos h
      join llamadas_dia l on l.id = h.llamada_id
      where h.eje = 'cumplimiento' and h.codigo is not null
      group by h.codigo
      order by count(*) desc, h.codigo
      limit 1
    )
  );
$$;

revoke execute on function public.get_calidad_muro(uuid, date) from public;
revoke execute on function public.get_calidad_muro(uuid, date) from anon;
grant  execute on function public.get_calidad_muro(uuid, date) to authenticated;
grant  execute on function public.get_calidad_muro(uuid, date) to service_role;

-- El ranking de mes agrega ~3.000 llamadas y sus hallazgos. El indice
-- (workspace_id, fecha_hora desc) ya existe y resuelve el rango; este cubre el
-- lado de los hallazgos, que hasta v4 solo se consultaban por llamada del dia.
create index if not exists idx_calidad_hallazgos_ws_eje_sev
  on public.calidad_llamadas_hallazgos(workspace_id, eje, severidad);
