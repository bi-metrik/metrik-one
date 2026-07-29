-- La vista de dueño, con UNA sola fuente para cada numero.
--
-- QUE ARREGLA
--
-- La tabla de dinero decia 37 ventas y US$29.563 mientras el muro, sobre los
-- mismos 30 dias, decia 626 cierres y US$500.174. Diecisiete veces de
-- diferencia entre dos pantallas del mismo tablero. La causa no fue un calculo
-- malo: fue que habia DOS fuentes para el mismo hecho — las llamadas y una
-- tabla de cuotas sembrada aparte — y al reanclar la historia solo se movio
-- una. Mientras existan dos, van a volver a separarse en el proximo cambio.
--
-- Por eso ventas y vendido salen de `calidad_llamadas`, igual que el muro.
-- `calidad_dinero_cuotas` deja de ser fuente de verdad (se conserva por ahora
-- para no romper nada que la lea; ya no la lee la aplicacion).
--
-- LA REGLA DEL RECAUDO POR CUOTA, ESCRITA
--
-- El reparto a seis cuotas no vive en las llamadas, asi que se DERIVA de ellas
-- con una regla explicita, no con cifras sembradas por separado:
--
--   1. Cada venta son US$799 en 6 cuotas iguales de US$133,17. Lo que se debe
--      cobrar en cada cuota es siempre lo mismo: ventas x 133,17.
--   2. En cada cuota se cae la fraccion que rebota y NO se recupera. Esa
--      fraccion no es un numero inventado: es `pendientes_recobro /  ventas`
--      del periodo, tomada de `calidad_recobro_dia`, que es justo lo que la
--      pantalla ya afirma mas abajo ("la cuota que no entro empezo por
--      rebotar"). Derivarla de ahi vuelve cierta esa frase.
--   3. La retencion es acumulativa: quien se cayo en la cuota 3 no paga la 4.
--      Retencion(n) = (1 - tasa)^(n-1).
--
-- Si mañana el recobro real mejora, la curva mejora sola. No hay que resembrar
-- nada, que es el punto.
create or replace function public.get_calidad_dinero(
  p_workspace_id uuid,
  p_dias         integer default 30
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with rango as (
    select
      (now() at time zone 'America/Bogota')::date                as hasta,
      (now() at time zone 'America/Bogota')::date - (p_dias - 1) as desde
  ),
  ventas as (
    -- Misma fuente y mismo corte que el muro. Los dias sembrados por delante
    -- no cuentan: el dueño no factura contra el futuro.
    select
      count(*)                        as n,
      coalesce(sum(l.monto_usd), 0)   as usd
    from calidad_llamadas l, rango r
    where l.workspace_id = p_workspace_id
      and l.cerro_venta
      and (l.fecha_hora at time zone 'America/Bogota')::date between r.desde and r.hasta
  ),
  recobro as (
    select
      coalesce(sum(d.debitos_rebotados), 0)               as rebotados,
      coalesce(sum(d.pendientes_recobro), 0)              as pendientes,
      coalesce(sum(d.monto_en_riesgo_usd), 0)             as en_riesgo,
      count(*)                                            as dias
    from calidad_recobro_dia d, rango r
    where d.workspace_id = p_workspace_id
      and d.fecha between r.desde and r.hasta
  ),
  tasa as (
    -- Fraccion que se cae en cada cuota. Acotada a [0, 0.5]: por encima de la
    -- mitad la curva dejaria de describir una cartera y describiria un fraude.
    select least(0.5, greatest(0,
      (select pendientes from recobro)::numeric / nullif((select n from ventas), 0)
    )) as valor
  ),
  cuotas as (
    select
      n                                                        as cuota,
      round((select usd from ventas) / 6.0, 2)                 as vendido_usd,
      power(1 - (select valor from tasa), n - 1)               as retencion
    from generate_series(1, 6) as n
  )
  select jsonb_build_object(
    'desde', (select desde from rango),
    'hasta', (select hasta from rango),
    'dias',  p_dias,

    'ventasCerradas', (select n from ventas),
    'vendidoTotal',   (select usd from ventas),
    'precioUsd',      799,
    'tasaCaida',      round((select valor from tasa)::numeric, 4),

    'cuotas', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'cuota',        cuota,
          'ventas',       round((select n from ventas) * retencion),
          'vendidoUsd',   vendido_usd,
          'recaudadoUsd', round(vendido_usd * retencion, 2)
        ) order by cuota
      ) from cuotas
    ), '[]'::jsonb),

    'recaudadoTotal', (select round(sum(vendido_usd * retencion), 2) from cuotas),
    'recaudoPct',     (
      select case when (select usd from ventas) > 0
                  then round(100.0 * sum(vendido_usd * retencion) / (select usd from ventas))
                  else 0 end
      from cuotas
    ),
    'llegaronCuota6', (
      select round((select n from ventas) * retencion) from cuotas where cuota = 6
    ),

    'recobro', jsonb_build_object(
      -- HOY es hoy. Antes se tomaba la fila mas reciente, que con la historia
      -- sembrada hasta el dia de la presentacion era una fila del futuro.
      'hoy', (
        select case when d.fecha is null then null else jsonb_build_object(
          'debitosRebotados',  d.debitos_rebotados,
          'pendientesRecobro', d.pendientes_recobro,
          'montoEnRiesgoUsd',  d.monto_en_riesgo_usd
        ) end
        from rango r
        left join calidad_recobro_dia d
          on d.workspace_id = p_workspace_id and d.fecha = r.hasta
      ),
      'acumulado', jsonb_build_object(
        'debitosRebotados',  (select rebotados from recobro),
        'pendientesRecobro', (select pendientes from recobro),
        'montoEnRiesgoUsd',  (select en_riesgo from recobro)
      ),
      'dias', (select dias from recobro)
    )
  );
$$;

revoke execute on function public.get_calidad_dinero(uuid, integer) from public;
revoke execute on function public.get_calidad_dinero(uuid, integer) from anon;
grant  execute on function public.get_calidad_dinero(uuid, integer) to authenticated;
grant  execute on function public.get_calidad_dinero(uuid, integer) to service_role;
