-- Muro v6: el periodo manda sobre TODA la pantalla, no solo sobre la tabla.
--
-- Desde v5 el ranking rota entre dia, semana y mes, pero el encabezado y el
-- heroe se quedaban en el dia: con "Ranking mes" abajo, arriba seguia diciendo
-- "HOY · martes 28 de julio" y los 23 cierres del dia. Quien mira ve el mes
-- abajo y el dia arriba sin saber cual esta leyendo. Lo detecto Mauricio en la
-- pantalla en vivo.
--
-- El arreglo no es pintar tres numeros mas: es que exista **un solo bloque por
-- periodo**. Si el heroe y el ranking se calcularan por separado terminarian
-- divergiendo en algun borde (zona horaria, limite del dia) y la pantalla se
-- contradiria a si misma sin que nadie pueda decir cual de los dos miente.
-- `calidad_bloque_periodo` devuelve cobertura, totales, bandera y ranking de un
-- mismo rango, en una sola pasada.
--
-- Lo que NO entra al bloque: las ULTIMAS LLAMADAS. Son el pulso en vivo, no un
-- agregado; en vista de mes serian exactamente las mismas diez que en vista de
-- dia. Se quedan fuera, a nivel raiz, y no rotan.
--
-- La cobertura del periodo se SUMA de `calidad_cobertura_dia`, incluido el
-- baseline: si a mano se auditaban 5 al dia, en 30 dias son 150. Sale del dato,
-- no multiplicado en el componente.

-- `calidad_ranking_periodo` (v5) queda absorbida: devolvia solo el ranking y
-- tener dos funciones de periodo es justamente la puerta a que diverjan.
drop function if exists public.calidad_ranking_periodo(uuid, date, date);

create or replace function public.calidad_bloque_periodo(
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
      l.cerro_venta,
      l.forma_pago,
      l.monto_usd
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
      count(*)                              as llamadas,
      count(*) filter (where b.cerro_venta) as cierres,
      round(avg(b.puntaje_tecnico))::int    as tecnica,
      coalesce(max(c.n), 0)::int            as banderas
    from base b
    left join criticas c on c.agente = b.agente
    group by b.agente
  ),
  umbrales as (
    -- Terciles del equipo EN ESE PERIODO. Un umbral fijo ("tecnica bajo 70 es
    -- mala") es una opinion sobre una operacion que no conocemos; los terciles
    -- se auto-normalizan. Sin dispersion (alta = baja) la pantalla no pinta.
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

    -- ── Heroe del periodo ──
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
      ) from base
    ),

    -- ── Cobertura del periodo, baseline incluido ──
    'cobertura', (
      select jsonb_build_object(
        'recibidas', coalesce(sum(recibidas), 0),
        'auditadas', coalesce(sum(auditadas), 0),
        'baseline',  coalesce(sum(baseline_manual), 0),
        'pct', case when coalesce(sum(recibidas), 0) > 0
                    then round(100.0 * sum(auditadas) / sum(recibidas)) else 0 end
      )
      from calidad_cobertura_dia c
      where c.workspace_id = p_workspace_id and c.fecha between p_desde and p_hasta
    ),

    -- ── La bandera que mas se repite en el periodo ──
    'banderaTop', (
      select jsonb_build_object('codigo', h.codigo, 'titulo', min(h.titulo), 'veces', count(*))
      from calidad_llamadas_hallazgos h
      join base b on b.id = h.llamada_id
      where h.eje = 'cumplimiento' and h.codigo is not null
      group by h.codigo
      order by count(*) desc, h.codigo
      limit 1
    ),

    -- ── Ranking del periodo ──
    'ranking', jsonb_build_object(
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
          -- Orden por cierres: asi se lee un ranking de ventas. El desempate es
          -- por VOLUMEN, no por calidad — desempatar por tecnica dejaria que el
          -- eje de cumplimiento reordene un ranking de ventas por la puerta de
          -- atras.
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
    )
  );
$$;

revoke execute on function public.calidad_bloque_periodo(uuid, date, date) from public;
revoke execute on function public.calidad_bloque_periodo(uuid, date, date) from anon;
grant  execute on function public.calidad_bloque_periodo(uuid, date, date) to authenticated;
grant  execute on function public.calidad_bloque_periodo(uuid, date, date) to service_role;

-- ── Muro ────────────────────────────────────────────────────────────────────
--
-- ⚠️ INCIDENTE Y POR QUE ESTA FUNCION DEVUELVE DOS FORMAS
--
-- Esta migracion se aplico a la base ANTES de que el codigo que la consume
-- estuviera desplegado. La base es compartida con produccion, asi que el muro
-- de Regat — publico y en vivo — quedo mostrando "Sin llamadas en este
-- periodo": el codigo desplegado (v5) leia `cierres` / `cobertura` /
-- `banderaTop` / `rankings` a nivel raiz y v6 los habia movido dentro de
-- `periodos`.
--
-- Por eso la funcion devuelve TAMBIEN las claves de v5, proyectadas desde el
-- mismo bloque de dia (no son un calculo paralelo: son el mismo dato leido de
-- otra forma). Con las dos formas conviviendo, el codigo viejo y el nuevo
-- funcionan a la vez y no hay ventana de rotura.
--
-- REGLA que deja este incidente: una RPC que ya tiene consumidores en
-- produccion no cambia de forma; se amplia. El cambio destructivo va DESPUES
-- del despliegue del consumidor.
--
-- BORRAR las claves de compatibilidad cuando este PR este mergeado y
-- desplegado (estan marcadas abajo).
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
    -- Red de seguridad: si el dia pedido no tuvo actividad, cae al ultimo dia
    -- con llamadas. Un televisor nunca puede quedar en blanco.
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
  -- Semana y mes son ventanas MOVILES (ultimos 7 y 30 dias), no calendario: un
  -- lunes, "la semana" calendario mostraria un solo dia, que en un televisor es
  -- peor que no mostrar nada.
  bloques as (
    select
      e.fecha,
      calidad_bloque_periodo(p_workspace_id, e.fecha,      e.fecha) as dia,
      calidad_bloque_periodo(p_workspace_id, e.fecha - 6,  e.fecha) as semana,
      calidad_bloque_periodo(p_workspace_id, e.fecha - 29, e.fecha) as mes
    from efectiva e
  )
  select jsonb_build_object(
    'fecha', b.fecha,
    'esFallback', b.fecha is distinct from p_fecha,

    'periodos', jsonb_build_object('dia', b.dia, 'semana', b.semana, 'mes', b.mes),

    -- ── Flujo: NO rota ──
    --
    -- Las diez ultimas son el pulso en vivo. En vista de mes serian las mismas
    -- diez que en vista de dia, asi que recalcularlas por periodo es trabajo
    -- sin efecto — y peor: sugeriria que cambian cuando no cambian.
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
        from calidad_llamadas l
        where l.workspace_id = p_workspace_id
          and (l.fecha_hora at time zone 'America/Bogota')::date = b.fecha
        order by fecha_hora desc
        limit 10
      ) s
    ), '[]'::jsonb),

    -- ── Compatibilidad con el codigo v5 desplegado. BORRAR tras el merge. ──
    'cierres',    b.dia->'cierres',
    'cobertura',  b.dia->'cobertura',
    'banderaTop', b.dia->'banderaTop',
    'rankings', jsonb_build_object(
      'dia',    (b.dia->'ranking')    || jsonb_build_object('desde', b.dia->'desde',    'hasta', b.dia->'hasta'),
      'semana', (b.semana->'ranking') || jsonb_build_object('desde', b.semana->'desde', 'hasta', b.semana->'hasta'),
      'mes',    (b.mes->'ranking')    || jsonb_build_object('desde', b.mes->'desde',    'hasta', b.mes->'hasta')
    )
  )
  from bloques b;
$$;

revoke execute on function public.get_calidad_muro(uuid, date) from public;
revoke execute on function public.get_calidad_muro(uuid, date) from anon;
grant  execute on function public.get_calidad_muro(uuid, date) to authenticated;
grant  execute on function public.get_calidad_muro(uuid, date) to service_role;
