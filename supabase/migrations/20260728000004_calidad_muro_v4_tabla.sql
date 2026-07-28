-- Muro v4: la tabla de agentes completa, con denominador, y el recobro fuera.
--
-- Revision visual de Mauricio sobre la pantalla real. Cinco cosas del muro v3
-- no funcionaban a tres metros, y tres son de datos:
--
--   1. Falta el DENOMINADOR por agente. "Felipe 6 cierres" no dice nada sin
--      saber de cuantas llamadas. Con el denominador aparece el dato que hoy
--      no se ve y que es el mejor argumento de la pantalla: Tatiana cierra al
--      MISMO ritmo que Felipe (38%) con la mitad de llamadas, todo cobrado y
--      sin banderas.
--   2. La tabla estaba recortada a 7. Una lista truncada es informacion
--      sesgada: si un agente no aparece, el piso no puede saber si es que no
--      cerro o que no cupo. Se devuelven TODOS.
--   3. Los debitos rebotados se van del muro a la vista de dueno. Son
--      cobranza, no operacion de piso.
--
-- El flujo pasa de 8 a 10 llamadas (lo pide el mismo criterio: mas contexto de
-- lo que esta pasando ahora).
--
-- El `pie` como envoltorio desaparece: la cobertura sube al encabezado como
-- sello y la bandera mas repetida pasa a banda destacada. Quedan como claves
-- de primer nivel porque ya no son "pie de pagina" de nada.
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
  ),
  -- Agente por NOMBRE DE PILA desde el arranque: asi el apellido no existe en
  -- ningun punto del pipeline, ni siquiera en un agregado intermedio.
  por_agente as (
    select
      split_part(agente_nombre, ' ', 1)                                       as agente,
      count(*)                                                                as llamadas,
      count(*) filter (where cerro_venta)                                     as cierres,
      count(*) filter (where cerro_venta and forma_pago = 'tarjeta')          as cierres_tarjeta,
      coalesce(sum(monto_usd) filter (where cerro_venta), 0)                  as monto,
      max(case semaforo when 'rojo' then 3 when 'amarillo' then 2 else 1 end) as peor
    from llamadas_dia
    group by 1
  )
  select jsonb_build_object(
    'fecha', (select fecha from efectiva),
    'esFallback', (select fecha from efectiva) is distinct from p_fecha,

    -- ── Heroe ──
    'cierres', (
      select jsonb_build_object(
        'total',    count(*) filter (where cerro_venta),
        'montoUsd', coalesce(sum(monto_usd) filter (where cerro_venta), 0),
        'llamadas', count(*),
        -- % de conversion del dia: el numero que la operacion entiende.
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

    -- ── Tabla de agentes: TODOS, sin recorte ──
    'ranking', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'agente',    agente,
          'llamadas',  llamadas,
          'cierres',   cierres,
          'pctCierre', case when llamadas > 0 then round(100.0 * cierres / llamadas) else 0 end,
          'tarjeta',   cierres_tarjeta,
          'montoUsd',  monto,
          'semaforo',  case peor when 3 then 'rojo' when 2 then 'amarillo' else 'verde' end
        )
        order by cierres desc, monto desc, agente
      )
      from por_agente
    ), '[]'::jsonb),

    -- ── Flujo: 10 ultimas ──
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

-- Nota: `calidad_recobro_dia` sigue existiendo y sigue sembrandose. Solo cambio
-- QUIEN la mira: sale del muro del piso y entra a la vista de dueno, junto al
-- recaudo a seis cuotas y el riesgo acumulado. Ver getDatosDueno.
