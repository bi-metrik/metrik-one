-- Una sola funcion reparte las ventas en cuotas. La consumen el muro y la
-- vista de dueño.
--
-- POR QUE
--
-- El muro repartia el total entre seis partes iguales y la vista de dueño
-- aplicaba una caida derivada del recobro real. Dos pantallas del mismo
-- producto repartiendo distinto: una contradiccion que el cliente encuentra
-- solo con abrir las dos. Y si cada una implementa la misma formula por su
-- lado, vuelven a separarse en el proximo cambio — es exactamente el error que
-- acabamos de corregir con las ventas y el vendido.
--
-- DOS CORRECCIONES DE MODELO, ADEMAS DE LA UNIFICACION
--
-- 1. LA CAIDA APLICA A TODOS LOS DEBITOS, TAMBIEN AL PRIMERO. Antes la curva
--    daba por cobrada entera la primera cuota. Pero la tasa de rebote se mide
--    sobre los debitos SIN distinguir cual es: suponer que el primero nunca
--    rebota es una suposicion extra que el dato no respalda. Ahora
--    retencion(n) = (1 - tasa)^n para las seis. La consecuencia visible es que
--    lo que entra en la primera cuota baja: es el punto del cambio, porque
--    dividir entre seis asume que nadie deja de pagar, que es justo lo que el
--    producto viene a demostrar que no ocurre.
--
-- 2. LA CURVA SOLO APLICA A LAS VENTAS A CUOTAS. El muro ya separaba "cobrado
--    completo" (pago los US$799 de una vez) de "a seis cuotas", pero la vista
--    de dueño corria el embudo sobre TODAS las ventas, incluidas las que ya
--    habian pagado entero. Eso exageraba el riesgo con plata que ya estaba en
--    la casa. Las de una vez entran completas; solo las de cuotas se exponen.
--
-- LA TASA SE MIDE SIEMPRE SOBRE 30 DIAS, aunque se pregunte por el dia: la
-- fraccion que rebota es un rasgo de la cartera, no del dia. Con la ventana de
-- un dia el numero saltaria por ruido y la misma venta valdria distinto segun
-- cuando se mire.
create or replace function public.calidad_reparto_cuotas(
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
  with ventas as (
    select
      count(*) filter (where forma_pago = 'tarjeta')                        as n_una_vez,
      coalesce(sum(monto_usd) filter (where forma_pago = 'tarjeta'), 0)     as usd_una_vez,
      count(*) filter (where forma_pago = 'cuenta')                         as n_cuotas,
      coalesce(sum(monto_usd) filter (where forma_pago = 'cuenta'), 0)      as usd_cuotas
    from calidad_llamadas
    where workspace_id = p_workspace_id
      and cerro_venta
      and (fecha_hora at time zone 'America/Bogota')::date between p_desde and p_hasta
  ),
  -- Denominador de la tasa: SIEMPRE los ultimos 30 dias hasta `p_hasta`.
  ventana as (
    select
      (select count(*) from calidad_llamadas
        where workspace_id = p_workspace_id and cerro_venta
          and (fecha_hora at time zone 'America/Bogota')::date between p_hasta - 29 and p_hasta) as ventas30,
      (select coalesce(sum(pendientes_recobro), 0) from calidad_recobro_dia
        where workspace_id = p_workspace_id and fecha between p_hasta - 29 and p_hasta)          as pendientes30
  ),
  tasa as (
    -- Acotada a [0, 0.5]: por encima de la mitad la curva dejaria de describir
    -- una cartera y describiria un fraude.
    select least(0.5, greatest(0,
      (select pendientes30 from ventana)::numeric / nullif((select ventas30 from ventana), 0)
    )) as t
  ),
  cuotas as (
    select
      n                                                        as cuota,
      round((select usd_cuotas from ventas) / 6.0, 2)          as esperado_usd,
      power(1 - (select t from tasa), n)                       as retencion
    from generate_series(1, 6) as n
  )
  select jsonb_build_object(
    'desde', p_desde,
    'hasta', p_hasta,
    'tasaCaida', round((select t from tasa)::numeric, 4),
    'precioUsd', 799,

    -- `ventasCerradas` y no `ventas`: es el nombre que ya usa la vista de dueño
    -- y el que consume su tipo. Un alias distinto aqui obligaria a traducir en
    -- cada consumidor, que es como se abren las grietas.
    'ventasCerradas', (select n_una_vez + n_cuotas from ventas),
    'vendidoUsd',     (select usd_una_vez + usd_cuotas from ventas),

    -- Pago completo al cierre: no pasa por la curva, ya entro.
    'deUnaVez', (select jsonb_build_object('n', n_una_vez, 'usd', usd_una_vez) from ventas),

    'aCuotas', (select jsonb_build_object(
        'n',        n_cuotas,
        'usd',      usd_cuotas,
        'cuotaUsd', round(usd_cuotas / 6.0, 2),
        -- Lo que se espera que entre de la PRIMERA cuota, ya descontado lo que
        -- historicamente rebota. Es el numero que el muro pone en su linea.
        'primeraCuotaUsd', (select round(esperado_usd * retencion, 2) from cuotas where cuota = 1),
        'entraUsd', (select round(sum(esperado_usd * retencion), 2) from cuotas)
      ) from ventas),

    'cuotas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'cuota',       cuota,
          'ventas',      round((select n_cuotas from ventas) * retencion),
          'esperadoUsd', esperado_usd,
          'entraUsd',    round(esperado_usd * retencion, 2)
        ) order by cuota
      ) from cuotas
    ), '[]'::jsonb),

    'recaudadoUsd', (
      select round((select usd_una_vez from ventas) + coalesce(sum(esperado_usd * retencion), 0), 2) from cuotas
    ),
    'recaudoPct', (
      select case when (select usd_una_vez + usd_cuotas from ventas) > 0
        then round(100.0 * ((select usd_una_vez from ventas) + coalesce(sum(esperado_usd * retencion), 0))
                   / (select usd_una_vez + usd_cuotas from ventas))
        else 0 end
      from cuotas
    ),
    'llegaronCuota6', (
      select round((select n_cuotas from ventas) * retencion) from cuotas where cuota = 6
    )
  );
$$;

revoke execute on function public.calidad_reparto_cuotas(uuid, date, date) from public;
revoke execute on function public.calidad_reparto_cuotas(uuid, date, date) from anon;
grant  execute on function public.calidad_reparto_cuotas(uuid, date, date) to authenticated;
grant  execute on function public.calidad_reparto_cuotas(uuid, date, date) to service_role;

-- Mismos grants que `get_calidad_muro` y `get_calidad_dinero`, que son quienes
-- la llaman: `authenticated` y `service_role`, nunca `anon`. El muro se
-- proyecta desde una sesion abierta, no sin sesion.
