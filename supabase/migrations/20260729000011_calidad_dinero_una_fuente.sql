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
-- EL REPARTO A CUOTAS LO HACE `calidad_reparto_cuotas`, que es la MISMA funcion
-- que usa el muro. La regla vive escrita ahi, en un solo sitio: si cada
-- pantalla implementara la formula por su lado volverian a separarse en el
-- proximo cambio, que es el error que esta migracion existe para cerrar.
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
  reparto as (
    select calidad_reparto_cuotas(p_workspace_id, (select desde from rango), (select hasta from rango)) as j
  ),
  recobro as (
    select
      coalesce(sum(d.debitos_rebotados), 0)   as rebotados,
      coalesce(sum(d.pendientes_recobro), 0)  as pendientes,
      coalesce(sum(d.monto_en_riesgo_usd), 0) as en_riesgo,
      count(*)                                as dias
    from calidad_recobro_dia d, rango r
    where d.workspace_id = p_workspace_id and d.fecha between r.desde and r.hasta
  )
  select (select j from reparto) || jsonb_build_object(
    'dias', p_dias,
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
