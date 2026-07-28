-- Muro v3: vuelve el flujo de ultimas llamadas, al lado del ranking.
--
-- Al reorganizar en v2 se perdio el seguimiento por llamada, y eso era lo que
-- mantenia la pantalla viva durante el dia. El ranking es el ACUMULADO; el
-- flujo es lo que esta pasando AHORA. Son dos preguntas distintas y el
-- televisor tiene ancho de sobra para las dos.
--
-- El flujo vuelve como en v1: hora, nombre de pila, puntaje tecnico y semaforo.
-- Sin apellidos, sin `cliente_ref` y sin duraciones (esas se leian como horas
-- del dia al lado de la columna de hora).
--
-- Se agrega ademas `montoUnitarioUsd`: el precio del programa derivado de los
-- cierres del dia, para que la linea del pie que define "cobrado" no lleve un
-- 799 escrito a mano en el codigo. Si el precio cambia, la pantalla lo sigue.
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
      count(*) filter (where cerro_venta)                                     as cierres,
      count(*) filter (where cerro_venta and forma_pago = 'tarjeta')          as cierres_tarjeta,
      coalesce(sum(monto_usd) filter (where cerro_venta), 0)                  as monto,
      count(*)                                                                as llamadas,
      max(case semaforo when 'rojo' then 3 when 'amarillo' then 2 else 1 end) as peor
    from llamadas_dia
    group by 1
  )
  select jsonb_build_object(
    'fecha', (select fecha from efectiva),
    'esFallback', (select fecha from efectiva) is distinct from p_fecha,

    -- ── Zona 1: el heroe ──
    'cierres', (
      select jsonb_build_object(
        'total',    count(*) filter (where cerro_venta),
        'montoUsd', coalesce(sum(monto_usd) filter (where cerro_venta), 0),
        'llamadas', count(*),
        -- Precio del programa segun los cierres del dia. Alimenta la linea que
        -- define "cobrado" en el pie, para no hardcodear la cifra en la UI.
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

    -- ── Zona 2a: el ranking (el acumulado del dia) ──
    'ranking', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'agente',   agente,
          'cierres',  cierres,
          'tarjeta',  cierres_tarjeta,
          'montoUsd', monto,
          'llamadas', llamadas,
          'semaforo', case peor when 3 then 'rojo' when 2 then 'amarillo' else 'verde' end
        )
        order by cierres desc, monto desc, agente
      )
      from (select * from por_agente order by cierres desc, monto desc, agente limit 7) r
    ), '[]'::jsonb),

    -- ── Zona 2b: el flujo (lo que esta pasando ahora) ──
    'ultimas', coalesce((
      select jsonb_agg(x order by ord desc) from (
        select jsonb_build_object(
                 'hora',      to_char(fecha_hora at time zone 'America/Bogota', 'HH24:MI'),
                 'agente',    split_part(agente_nombre, ' ', 1),
                 'tecnica',   puntaje_tecnico,
                 'semaforo',  semaforo,
                 'cerroVenta', cerro_venta
               ) x,
               fecha_hora ord
        from llamadas_dia
        order by fecha_hora desc
        limit 12
      ) s
    ), '[]'::jsonb),

    -- ── Zona 3: el pie ──
    'pie', jsonb_build_object(
      'recobro', (
        select jsonb_build_object(
          'debitosRebotados',  coalesce(debitos_rebotados, 0),
          'pendientesRecobro', coalesce(pendientes_recobro, 0),
          'montoEnRiesgoUsd',  coalesce(monto_en_riesgo_usd, 0)
        )
        from calidad_recobro_dia c, efectiva e
        where c.workspace_id = p_workspace_id and c.fecha = e.fecha
      ),
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
      'banderaTop', (
        select jsonb_build_object('codigo', h.codigo, 'titulo', min(h.titulo), 'veces', count(*))
        from calidad_llamadas_hallazgos h
        join llamadas_dia l on l.id = h.llamada_id
        where h.eje = 'cumplimiento' and h.codigo is not null
        group by h.codigo
        order by count(*) desc, h.codigo
        limit 1
      )
    )
  );
$$;

revoke execute on function public.get_calidad_muro(uuid, date) from public;
revoke execute on function public.get_calidad_muro(uuid, date) from anon;
grant  execute on function public.get_calidad_muro(uuid, date) to authenticated;
grant  execute on function public.get_calidad_muro(uuid, date) to service_role;
