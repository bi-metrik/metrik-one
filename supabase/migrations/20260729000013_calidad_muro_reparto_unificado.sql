-- El muro reparte las cuotas con la MISMA regla que la vista de dueño.
--
-- QUE CAMBIA
--
-- La linea "a seis cuotas" del muro dividia el total entre seis partes iguales.
-- La vista de dueño aplicaba una caida derivada del recobro real. Dos pantallas
-- del mismo producto repartiendo distinto: una contradiccion que el cliente
-- encuentra solo con abrir las dos.
--
-- De las dos reglas gana la derivada del dato: dividir entre seis asume que
-- nadie deja de pagar, que es exactamente lo que el producto viene a demostrar
-- que no ocurre. La otra sale de un hecho observado — cuantos debitos rebotan y
-- no se recuperan — y vive escrita en `calidad_reparto_cuotas`, que ahora
-- consumen las dos pantallas. Si cada una implementara la formula por su lado,
-- volverian a separarse en el proximo cambio.
--
-- ⚠️ ESTA MIGRACION CAMBIA UNA CIFRA QUE YA SE REVISO EN PANTALLA. La base es
-- compartida entre `main` y las ramas, asi que aplicarla mueve el muro en vivo
-- al instante. Lo que entra en la primera cuota baja un 8,2%:
--
--     dia     US$1.731,17  →  US$1.589,22
--     semana  US$10.387,00 →  US$9.535,30
--     mes     US$41.015,33 →  US$37.652,22
--
-- Es el punto del cambio, no un efecto colateral. Aplicar solo cuando el dueño
-- del tablero ya lo sepa.
create or replace function public.calidad_bloque_periodo(
  p_workspace_id uuid,
  p_desde        date,
  p_hasta        date
)
returns jsonb
language sql
stable
set search_path = public
as $$
  with base as (
    select
      l.id,
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
          -- Lo que ENTRA de la primera cuota, no el sexto aritmetico. Sale de
          -- la misma funcion que reparte en la vista de dueño.
          'primeraCuotaUsd',
            (calidad_reparto_cuotas(p_workspace_id, p_desde, p_hasta) -> 'aCuotas' ->> 'primeraCuotaUsd')::numeric
        )
      ) from base
    ),
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
    'banderaTop', (
      select jsonb_build_object('codigo', h.codigo, 'titulo', min(h.titulo), 'veces', count(*))
      from calidad_llamadas_hallazgos h
      join base b on b.id = h.llamada_id
      where h.eje = 'cumplimiento' and h.codigo is not null
      group by h.codigo
      order by count(*) desc, h.codigo
      limit 1
    ),
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
