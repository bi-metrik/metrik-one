-- ============================================================================
-- Un pago no es una transaccion: es que se COMPLETE un tramo del honorario.
--
-- Definicion de Mauricio (2026-08-11): "pago 1" es que se complete el tramo 1 del
-- honorario; "pago 2", el tramo 2. Al cliente no se le puede exigir que pague de forma
-- estructurada: si hace su 50% en cinco transferencias, es su decision. Lo que importa
-- es que complete.
--
-- Y la tarifa de la UPME **nunca va a llegar clasificada como tal**: es la diferencia
-- entre lo que paga el cliente y el honorario, segun el plan. No hay nada que arreglar
-- en la captura — se DERIVA, y esta vista es esa derivacion.
--
-- CADA NEGOCIO TIENE TRES CUENTAS CON TECHO
--
--   | Cuenta      | Plan 1 (50/50)    | Plan 2 (100% anticipado) | Techo                    |
--   | tramo 1     | 50% del honorario | 100% del honorario       | precio_aprobado + plan   |
--   | tramo 2     | el otro 50%       | NO EXISTE                | idem                     |
--   | tarifa UPME | valor confirmado  | valor confirmado         | tarifa_upme_confirmada   |
--
-- La tarifa NO es "lo que sobra": tiene techo propio y conocido. Medido el 2026-08-11:
-- 65 de los 70 negocios con cobro de SOENA la tienen confirmada, y cero exceden el
-- honorario sin tenerla.
--
-- ORDEN DE IMPUTACION (duro, sin prorrateo): tramo 1 → tarifa → tramo 2 → excedente.
--
-- ⚠️ La tarifa va ANTES del tramo 2 y eso NO es comodidad: el tramo 2 del Plan 1 se
-- paga al exito, asi que no puede llenarse con la misma plata que trae la tarifa. Es lo
-- unico que reproduce los CINCO casos reales de Plan 1, medidos el 2026-08-11:
--
--   V0025 / V0099 / V0103 → primer giro $1.126.812 = 425.000 (50%) + 701.812 (tarifa)
--   V0277 / V0287         → primer giro $701.812   = la tarifa sola
--
-- Con "honorario entero primero", V0103 apareceria con el honorario COMPLETO tras un
-- solo giro y el hito "pago 2" disparado el dia uno, cuando lo que pago fue su mitad
-- mas la tarifa. Los cinco darian falso. **Pendiente de confirmacion de Mauricio**;
-- revertirlo es intercambiar dos franjas aqui y en `src/lib/upme/imputacion.ts`.
--
-- El contrato entre esta vista y su espejo en TypeScript vive en
-- `src/lib/upme/imputacion.test.ts` (14 casos). Si una de las dos cambia sin la otra,
-- los tests son lo unico que lo delata.
--
-- Casos limite, decididos a proposito:
--   * Negocio sin valor declarado  -> SIN techo: todo cuenta como tramo 1. Ausencia de
--     dato no es cero, y un techo en cero borraria del P&L plata realmente cobrada.
--   * Monto negativo (devolucion)  -> va entero a excedente, no descuenta tramos ni
--     libera techo: devuelve plata que nunca fue ingreso, era excedente.
--   * Cobro anulado (monto 0 desde 20260811, PR #248) -> no mueve ninguna cuenta.
--   * `tipo_cobro = 'pasante'`     -> excluido: ya venia declarado como de terceros.
-- ============================================================================

-- ── 1. El negocio expone sus tres techos ────────────────────────────────────

create or replace view v_negocio_valor as
with propuesta as (
  select distinct on (nb.negocio_id)
    nb.negocio_id,
    nullif(nb.data->>'iva_pct','')::numeric  as iva_pct,
    nullif(nb.data->>'aprobado_plan','')::int as plan
  from negocio_bloques nb
  join bloque_configs bc     on bc.id = nb.bloque_config_id
  join bloque_definitions bd on bd.id = bc.bloque_definition_id
  where bd.tipo = 'propuesta_economica'
    and (nb.data->>'aprobado_at') is not null
  order by nb.negocio_id, (nb.data->>'aprobado_at')::timestamptz desc
),
iva_propuesta as (
  select negocio_id, iva_pct from propuesta where iva_pct is not null
),
tarifa as (
  -- La tarifa UPME confirmada del negocio: el mismo dato que ya usa
  -- `count_negocios_por_conciliar` para el valor a recaudar.
  select nb.negocio_id, max((nb.data->>'tarifa_upme_confirmada')::numeric) as tarifa
  from negocio_bloques nb
  join bloque_configs bc on bc.id = nb.bloque_config_id
  where bc.config_extra->'tarifa_confirmacion'->>'enabled' = 'true'
    and nb.data->>'tarifa_confirmada' = 'true'
    and nb.data->>'tarifa_upme_confirmada' ~ '^[0-9]+(\.[0-9]+)?$'
    and (nb.data->>'tarifa_upme_confirmada')::numeric > 0
  group by nb.negocio_id
),
servicio as (
  select linea_id, min(tarifa_iva) as tarifa_iva
  from (
    select distinct e.linea_id, s.tarifa_iva
    from bloque_configs bc
    join etapas_negocio e on e.id = bc.etapa_id
    join servicios s
      on s.id::text = coalesce(
           bc.config_extra->'auto_propuesta'->>'servicio_id',
           bc.config_extra->>'servicio_id')
    where s.tarifa_iva is not null
  ) t
  group by linea_id
  having count(*) = 1
),
candidatos as (
  select
    n.id           as negocio_id,
    n.workspace_id,
    n.linea_id,
    n.precio_aprobado,
    n.precio_estimado,
    p.plan                                                      as plan_pago,
    coalesce(tf.tarifa, 0)                                      as tarifa_confirmada,
    ip.iva_pct                                                  as iva_propuesta,
    nullif(l.config_extra->'honorario'->>'iva_pct','')::numeric as iva_linea,
    sv.tarifa_iva                                               as iva_servicio,
    nullif(w.config_extra->'honorario'->>'iva_pct','')::numeric as iva_workspace
  from negocios n
  left join propuesta      p  on p.negocio_id  = n.id
  left join iva_propuesta  ip on ip.negocio_id = n.id
  left join tarifa         tf on tf.negocio_id = n.id
  left join lineas_negocio l  on l.id = n.linea_id
  left join servicio       sv on sv.linea_id  = n.linea_id
  left join workspaces     w  on w.id = n.workspace_id
),
resuelto as (
  select
    c.*,
    case
      when c.iva_propuesta is not null then 'propuesta'
      when c.iva_linea     is not null then 'linea'
      when c.iva_servicio  is not null then 'servicio'
      when c.iva_workspace is not null then 'workspace'
      else 'sin_declarar'
    end as iva_origen,
    case
      when coalesce(c.iva_propuesta, c.iva_linea, c.iva_servicio, c.iva_workspace) is null then 0
      when coalesce(c.iva_propuesta, c.iva_linea, c.iva_servicio, c.iva_workspace) > 1
        then coalesce(c.iva_propuesta, c.iva_linea, c.iva_servicio, c.iva_workspace) / 100
      else coalesce(c.iva_propuesta, c.iva_linea, c.iva_servicio, c.iva_workspace)
    end as iva_frac
  from candidatos c
)
select
  r.negocio_id,
  r.workspace_id,
  r.linea_id,
  r.iva_frac,
  r.iva_origen,
  (r.iva_origen <> 'sin_declarar') as iva_declarado,

  r.precio_aprobado                                                  as valor_aprobado_total,
  round(r.precio_aprobado / (1 + r.iva_frac), 2)                     as valor_aprobado_base,
  r.precio_aprobado - round(r.precio_aprobado / (1 + r.iva_frac), 2) as valor_aprobado_iva,

  coalesce(r.precio_aprobado, r.precio_estimado, 0)                                       as valor_total,
  round(coalesce(r.precio_aprobado, r.precio_estimado, 0) / (1 + r.iva_frac), 2)          as valor_base,
  coalesce(r.precio_aprobado, r.precio_estimado, 0)
    - round(coalesce(r.precio_aprobado, r.precio_estimado, 0) / (1 + r.iva_frac), 2)      as valor_iva,
  (r.precio_aprobado is null and r.precio_estimado is not null)                           as es_estimado,

  case
    when r.precio_aprobado is null and r.precio_estimado is null then null
    else coalesce(r.precio_aprobado, r.precio_estimado)
  end                                                                                     as valor_techo,

  -- Plan de pago y los tres techos, CON IVA (que es como entra la plata).
  r.plan_pago,
  r.tarifa_confirmada                                                                     as techo_tarifa,
  case
    when r.precio_aprobado is null and r.precio_estimado is null then null
    when r.plan_pago = 1 then coalesce(r.precio_aprobado, r.precio_estimado) / 2
    else coalesce(r.precio_aprobado, r.precio_estimado)
  end                                                                                     as techo_tramo1,
  case
    when r.precio_aprobado is null and r.precio_estimado is null then null
    when r.plan_pago = 1 then coalesce(r.precio_aprobado, r.precio_estimado)
                              - coalesce(r.precio_aprobado, r.precio_estimado) / 2
    else 0
  end                                                                                     as techo_tramo2
from resuelto r;

comment on view v_negocio_valor is
  'Fuente unica del valor de un negocio: total (con IVA), base (sin IVA), IVA, y los tres '
  'techos de recaudo (tramo 1 y 2 del honorario segun el plan, mas la tarifa UPME '
  'confirmada). La tarifa de IVA sale de la propuesta aprobada, la linea, el servicio o la '
  'config del workspace, en ese orden; nunca de un literal.';

alter view v_negocio_valor set (security_invoker = on);
revoke all on v_negocio_valor from anon;
grant select on v_negocio_valor to authenticated;

-- ── 2. Cada peso que entra, a que cuenta se abona ───────────────────────────
-- Se dropean las tres en orden inverso de dependencia: `create or replace view` no
-- puede RENOMBRAR columnas (`propio_con_iva` pasa a ser el desglose por cuenta), y un
-- `cascade` sobre v_cobro_valor se llevaria por delante a las otras dos sin decirlo.

drop view if exists v_pyl_mes;
drop view if exists v_mc_linea_mes;
drop view if exists v_cobro_valor;

create view v_cobro_valor as
with elegibles as (
  select
    c.id, c.workspace_id, c.negocio_id, c.fecha, c.monto, c.tipo_cobro,
    -- Lo POSITIVO cobrado antes que este, en el mismo negocio. Orden por fecha y luego
    -- por id, para que dos cobros del mismo dia se resuelvan siempre igual.
    coalesce(sum(greatest(c.monto, 0)) over (
      partition by c.negocio_id order by c.fecha, c.id
      rows between unbounded preceding and 1 preceding), 0) as consumido_antes
  from cobros c
  where c.fecha is not null
    and coalesce(c.tipo_cobro, '') <> 'pasante'
),
franjas as (
  select
    e.*,
    v.linea_id,
    coalesce(v.iva_frac, 0)                as iva_frac,
    coalesce(v.iva_origen, 'sin_declarar') as iva_origen,
    -- Limites acumulados EN EL ORDEN DE IMPUTACION. NULL = negocio sin techo declarado.
    v.techo_tramo1                                                        as fin_tramo1,
    v.techo_tramo1 + coalesce(v.techo_tarifa, 0)                          as fin_tarifa,
    v.techo_tramo1 + coalesce(v.techo_tarifa, 0) + coalesce(v.techo_tramo2, 0) as fin_tramo2
  from elegibles e
  left join v_negocio_valor v on v.negocio_id = e.negocio_id
),
imputado as (
  select
    f.*,
    f.consumido_antes                as desde,
    f.consumido_antes + f.monto      as hasta,
    -- Sin negocio o sin techo declarado: todo cuenta como tramo 1.
    (f.negocio_id is null or f.fin_tramo1 is null) as sin_techo
  from franjas f
)
select
  i.id as cobro_id,
  i.workspace_id,
  i.negocio_id,
  i.linea_id,
  i.fecha,
  i.tipo_cobro,
  i.monto,
  i.iva_frac,
  i.iva_origen,

  -- Cada cuenta es la interseccion del intervalo (desde, hasta] con su franja.
  case when i.monto <= 0 then 0
       when i.sin_techo then i.monto
       else greatest(0, least(i.hasta, i.fin_tramo1) - greatest(i.desde, 0)) end as a_tramo1,
  case when i.monto <= 0 or i.sin_techo then 0
       else greatest(0, least(i.hasta, i.fin_tarifa) - greatest(i.desde, i.fin_tramo1)) end as a_tarifa,
  case when i.monto <= 0 or i.sin_techo then 0
       else greatest(0, least(i.hasta, i.fin_tramo2) - greatest(i.desde, i.fin_tarifa)) end as a_tramo2,
  case when i.monto <= 0 then i.monto
       when i.sin_techo then 0
       else greatest(0, i.hasta - greatest(i.desde, i.fin_tramo2)) end as excedente,

  -- Hitos: la transaccion que COMPLETA el tramo. `desde < fin` evita marcarlo dos veces.
  (i.monto > 0 and not i.sin_techo and i.desde < i.fin_tramo1 and i.hasta >= i.fin_tramo1) as completa_tramo1,
  (i.monto > 0 and not i.sin_techo and i.fin_tramo2 > i.fin_tarifa
    and i.desde < i.fin_tramo2 and i.hasta >= i.fin_tramo2)                                as completa_tramo2
from imputado i;

comment on view v_cobro_valor is
  'A que se abona cada peso que entra: tramo 1 del honorario, tarifa UPME, tramo 2, o '
  'excedente. `completa_tramo1/2` marcan la transaccion que cierra el tramo — el hito que '
  'el tablero llama "primer pago" y "segundo pago". Espejo SQL de src/lib/upme/imputacion.ts.';

alter view v_cobro_valor set (security_invoker = on);
revoke all on v_cobro_valor from anon;
grant select on v_cobro_valor to authenticated;

-- ── 3. El ingreso propio es el honorario; la tarifa es de terceros ──────────

drop view if exists v_pyl_mes;

create view v_pyl_mes as
with meses as (
  select distinct workspace_id, date_trunc('month', fecha::timestamptz)::date as mes from cobros
  union
  select distinct workspace_id, date_trunc('month', fecha::timestamptz)::date as mes from gastos
),
ingresos as (
  select
    cv.workspace_id,
    date_trunc('month', cv.fecha::timestamptz)::date as mes,
    -- Ingreso propio = honorario (los dos tramos). La tarifa NO es ingreso.
    sum(round((cv.a_tramo1 + cv.a_tramo2) / (1 + cv.iva_frac), 2))                 as ingresos,
    sum(cv.a_tramo1 + cv.a_tramo2)                                                 as ingresos_con_iva,
    sum((cv.a_tramo1 + cv.a_tramo2) - round((cv.a_tramo1 + cv.a_tramo2) / (1 + cv.iva_frac), 2)) as iva_recaudado,
    sum(cv.a_tarifa + cv.excedente)                                                as recaudo_terceros,
    sum(cv.a_tarifa)                                                               as tarifa_recaudada
  from v_cobro_valor cv
  group by 1, 2
),
variables as (
  select workspace_id, date_trunc('month', fecha::timestamptz)::date as mes, sum(monto) as costos_variables
  from gastos where clasificacion_costo = 'variable' group by 1, 2
),
fijos_gastos as (
  select workspace_id, date_trunc('month', fecha::timestamptz)::date as mes, sum(monto) as fijos_gastos
  from gastos where clasificacion_costo = 'fijo' group by 1, 2
),
fijos_config as (
  select workspace_id, sum(monthly_amount) as fijos_recurrentes
  from fixed_expenses where is_active = true group by 1
),
fijos_legacy as (
  select workspace_id, sum(monto_referencia) as fijos_recurrentes_legacy
  from gastos_fijos_config where activo = true group by 1
)
select
  m.workspace_id,
  m.mes,
  coalesce(i.ingresos, 0)          as ingresos,
  coalesce(i.ingresos_con_iva, 0)  as ingresos_con_iva,
  coalesce(i.iva_recaudado, 0)     as iva_recaudado,
  coalesce(i.recaudo_terceros, 0)  as recaudo_terceros,
  coalesce(i.tarifa_recaudada, 0)  as tarifa_recaudada,
  coalesce(v.costos_variables, 0)  as costos_variables,
  coalesce(i.ingresos, 0) - coalesce(v.costos_variables, 0) as mc,
  case
    when coalesce(i.ingresos, 0) > 0
      then (coalesce(i.ingresos, 0) - coalesce(v.costos_variables, 0)) / i.ingresos
    else null
  end as mc_pct,
  coalesce(fg.fijos_gastos, 0) as fijos_gastos_mes,
  coalesce(fc.fijos_recurrentes, 0) + coalesce(fl.fijos_recurrentes_legacy, 0) as fijos_recurrentes,
  coalesce(fg.fijos_gastos, 0) + coalesce(fc.fijos_recurrentes, 0) + coalesce(fl.fijos_recurrentes_legacy, 0) as fijos_total,
  coalesce(i.ingresos, 0) - coalesce(v.costos_variables, 0)
    - (coalesce(fg.fijos_gastos, 0) + coalesce(fc.fijos_recurrentes, 0) + coalesce(fl.fijos_recurrentes_legacy, 0)) as ebitda
from meses m
left join ingresos    i  on i.workspace_id  = m.workspace_id and i.mes  = m.mes
left join variables   v  on v.workspace_id  = m.workspace_id and v.mes  = m.mes
left join fijos_gastos fg on fg.workspace_id = m.workspace_id and fg.mes = m.mes
left join fijos_config fc on fc.workspace_id = m.workspace_id
left join fijos_legacy fl on fl.workspace_id = m.workspace_id;

comment on view v_pyl_mes is
  'P&L mensual en caja. `ingresos` es honorario propio SIN IVA. `tarifa_recaudada` y '
  '`recaudo_terceros` dejan a la vista la plata que entro y no se queda, para conciliar '
  'contra el banco.';

alter view v_pyl_mes set (security_invoker = on);
revoke all on v_pyl_mes from anon;
grant select on v_pyl_mes to authenticated;

drop view if exists v_mc_linea_mes;

create view v_mc_linea_mes as
with ingresos_linea as (
  select
    cv.workspace_id,
    date_trunc('month', cv.fecha::timestamptz)::date as mes,
    cv.linea_id,
    sum(round((cv.a_tramo1 + cv.a_tramo2) / (1 + cv.iva_frac), 2)) as ingresos,
    sum(cv.a_tarifa + cv.excedente)                                as recaudo_terceros
  from v_cobro_valor cv
  group by 1, 2, 3
),
variables_linea as (
  select
    g.workspace_id,
    date_trunc('month', g.fecha::timestamptz)::date as mes,
    n.linea_id,
    sum(g.monto) as costos_variables
  from gastos g
  left join negocios n on n.id = g.negocio_id
  where g.clasificacion_costo = 'variable'
  group by 1, 2, 3
)
select
  coalesce(i.workspace_id, v.workspace_id) as workspace_id,
  coalesce(i.mes, v.mes)                   as mes,
  coalesce(i.linea_id, v.linea_id)         as linea_id,
  l.nombre as linea_nombre,
  l.tipo   as linea_tipo,
  coalesce(i.ingresos, 0)         as ingresos,
  coalesce(i.recaudo_terceros, 0) as recaudo_terceros,
  coalesce(v.costos_variables, 0) as costos_variables,
  coalesce(i.ingresos, 0) - coalesce(v.costos_variables, 0) as mc,
  case
    when coalesce(i.ingresos, 0) > 0
      then (coalesce(i.ingresos, 0) - coalesce(v.costos_variables, 0)) / i.ingresos
    else null
  end as mc_pct
from ingresos_linea i
full join variables_linea v
  on v.workspace_id = i.workspace_id and v.mes = i.mes and not v.linea_id is distinct from i.linea_id
left join lineas_negocio l on l.id = coalesce(i.linea_id, v.linea_id);

comment on view v_mc_linea_mes is
  'MC por linea de negocio, sobre honorario propio sin IVA. El bucket con linea_id NULL '
  'son costos o cobros sin linea asignada.';

alter view v_mc_linea_mes set (security_invoker = on);
revoke all on v_mc_linea_mes from anon;
grant select on v_mc_linea_mes to authenticated;

-- ── 4. El tablero: primer pago, segundo pago y tarifa, derivados ────────────
--
-- Estas tres casillas YA existian y estaban vacias por construccion: `segundo_pago` se
-- calculaba como la suma de cobros con `tipo_cobro = 'saldo'` y `tarifa_recaudada` con
-- `'pasante'`. Medido el 2026-08-11 sobre los 89 cobros con fecha de SOENA: 66
-- `anticipo`, 24 `pago`, 2 `externo`, **cero `saldo` y cero `pasante`**. O sea que el
-- segundo pago mostraba $0 siempre y el primero se llevaba TODO el recaudo, tarifa
-- incluida. Mismo fallo mudo que ya costo tres incidentes en este repositorio: una
-- cifra que depende de un campo que nadie escribe.
--
-- Ahora salen de la derivacion, que no depende de que alguien marque nada.

create or replace function public.get_comercial_kpis_mes_soena(
  p_workspace_id uuid, p_anio integer, p_mes integer
) returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  cobros_neg AS (
    -- Recaudo por negocio, ya desglosado por cuenta.
    SELECT
      cv.negocio_id,
      MIN(cv.fecha)                                        AS fecha_venta,
      SUM(cv.a_tramo1 + cv.a_tramo2)                       AS honorario_recaudado,
      SUM(cv.a_tramo1)                                     AS primer_pago,
      SUM(cv.a_tramo2)                                     AS segundo_pago,
      SUM(cv.a_tarifa)                                     AS tarifa
    FROM v_cobro_valor cv, guard g
    WHERE cv.workspace_id = g.id
    GROUP BY cv.negocio_id
  ),
  ventas_mes AS (
    SELECT
      n.id AS negocio_id,
      vc.comercial_staff_id AS responsable_id,
      cn.fecha_venta,
      COALESCE(vv.valor_aprobado_total, 0)                                      AS honorario_con_iva,
      COALESCE(vv.valor_aprobado_base, 0)                                       AS honorario_sin_iva,
      COALESCE(cn.honorario_recaudado, 0)                                       AS honorario_recaudado,
      COALESCE(cn.primer_pago, 0)                                               AS primer_pago,
      COALESCE(cn.segundo_pago, 0)                                              AS segundo_pago,
      COALESCE(cn.tarifa, 0)                                                    AS tarifa,
      -- Lo recaudado del honorario llega CON IVA: se compara contra el total.
      (COALESCE(cn.honorario_recaudado, 0) >= COALESCE(vv.valor_aprobado_total, 0) - 1) AS caso_completo
    FROM negocios n
    JOIN guard g            ON n.workspace_id = g.id
    JOIN cobros_neg cn      ON cn.negocio_id = n.id AND cn.fecha_venta IS NOT NULL
    JOIN v_negocio_valor vv ON vv.negocio_id = n.id
    LEFT JOIN v_negocio_comercial vc ON vc.negocio_id = n.id
    WHERE EXTRACT(YEAR  FROM cn.fecha_venta) = p_anio
      AND EXTRACT(MONTH FROM cn.fecha_venta) = p_mes
  ),
  cancelados_mes AS (
    SELECT COUNT(*) AS n_perdidos
    FROM negocios n, guard g
    WHERE n.workspace_id = g.id AND n.estado = 'perdido'
      AND EXTRACT(YEAR  FROM n.updated_at) = p_anio
      AND EXTRACT(MONTH FROM n.updated_at) = p_mes
  ),
  tot AS (
    SELECT
      COUNT(*)                                             AS num_ventas,
      COALESCE(SUM(honorario_sin_iva), 0)                  AS valor_sin_iva,
      COALESCE(SUM(honorario_con_iva), 0)                  AS valor_con_iva,
      COALESCE(SUM(primer_pago), 0)                        AS primer_pago,
      COALESCE(SUM(segundo_pago), 0)                       AS segundo_pago,
      COALESCE(SUM(honorario_recaudado), 0)                AS honorario_recaudado,
      COALESCE(SUM(tarifa), 0)                             AS tarifa,
      COUNT(*) FILTER (WHERE caso_completo)                AS casos_completos
    FROM ventas_mes
  ),
  meta_global AS (
    SELECT meta_num_ventas, meta_valor
    FROM metas_comerciales mc, guard g
    WHERE mc.workspace_id = g.id AND mc.staff_id IS NULL
      AND mc.anio = p_anio AND mc.mes = p_mes
    LIMIT 1
  ),
  por_dia AS (
    SELECT fecha_venta::date AS dia, COUNT(*) AS ventas_dia
    FROM ventas_mes GROUP BY fecha_venta::date
  ),
  mejor_dia AS (
    SELECT dia, ventas_dia FROM por_dia ORDER BY ventas_dia DESC, dia LIMIT 1
  )
  SELECT jsonb_build_object(
    'anio', p_anio,
    'mes', p_mes,
    'kpis', jsonb_build_object(
      'num_ventas',           (SELECT num_ventas FROM tot),
      'valor_sin_iva',        (SELECT valor_sin_iva FROM tot),
      'valor_con_iva',        (SELECT valor_con_iva FROM tot),
      'primer_pago',          (SELECT primer_pago FROM tot),
      'segundo_pago',         (SELECT segundo_pago FROM tot),
      'honorario_recaudado',  (SELECT honorario_recaudado FROM tot),
      'tarifa_recaudada',     (SELECT tarifa FROM tot),
      'casos_completos',      (SELECT casos_completos FROM tot),
      'tasa_casos_completos', CASE WHEN (SELECT num_ventas FROM tot) > 0
                                    THEN round(100.0 * (SELECT casos_completos FROM tot) / (SELECT num_ventas FROM tot), 1)
                                    ELSE NULL END,
      'ticket_promedio',      CASE WHEN (SELECT num_ventas FROM tot) > 0
                                    THEN round((SELECT valor_sin_iva FROM tot) / (SELECT num_ventas FROM tot), 0)
                                    ELSE 0 END,
      'mejor_dia',            (SELECT to_char(dia,'YYYY-MM-DD') FROM mejor_dia),
      'mejor_dia_ventas',     COALESCE((SELECT ventas_dia FROM mejor_dia), 0),
      'promedio_ventas_dia',  round((SELECT COALESCE(AVG(ventas_dia),0) FROM por_dia), 2),
      'ingreso_promedio_dia', CASE WHEN (SELECT COUNT(*) FROM por_dia) > 0
                                    THEN round((SELECT valor_sin_iva FROM tot) / (SELECT COUNT(*) FROM por_dia), 0)
                                    ELSE 0 END,
      'ventas_proyectadas',   CASE
        WHEN EXTRACT(YEAR FROM CURRENT_DATE) = p_anio AND EXTRACT(MONTH FROM CURRENT_DATE) = p_mes
          THEN round(
            (SELECT num_ventas FROM tot)::numeric
            * EXTRACT(DAY FROM (date_trunc('month', make_date(p_anio,p_mes,1)) + interval '1 month - 1 day'))
            / GREATEST(EXTRACT(DAY FROM CURRENT_DATE), 1), 1)
        ELSE (SELECT num_ventas FROM tot) END,
      'n_perdidos',           (SELECT n_perdidos FROM cancelados_mes),
      'tasa_cancelacion',     CASE WHEN ((SELECT num_ventas FROM tot) + (SELECT n_perdidos FROM cancelados_mes)) > 0
                                    THEN round(100.0 * (SELECT n_perdidos FROM cancelados_mes)
                                         / ((SELECT num_ventas FROM tot) + (SELECT n_perdidos FROM cancelados_mes)), 1)
                                    ELSE NULL END,
      'tasa_recaudo',         CASE WHEN (SELECT valor_con_iva FROM tot) > 0
                                    THEN round(100.0 * (SELECT honorario_recaudado FROM tot) / (SELECT valor_con_iva FROM tot), 1)
                                    ELSE NULL END,
      'meta_num_ventas',      (SELECT meta_num_ventas FROM meta_global),
      'meta_valor',           (SELECT meta_valor FROM meta_global),
      'cumplimiento_num',     CASE WHEN (SELECT meta_num_ventas FROM meta_global) > 0
                                    THEN round(100.0 * (SELECT num_ventas FROM tot) / (SELECT meta_num_ventas FROM meta_global), 1)
                                    ELSE NULL END,
      'cumplimiento_valor',   CASE WHEN (SELECT meta_valor FROM meta_global) > 0
                                    THEN round(100.0 * (SELECT valor_sin_iva FROM tot) / (SELECT meta_valor FROM meta_global), 1)
                                    ELSE NULL END
    ),
    'porDia', COALESCE((
      SELECT jsonb_agg(jsonb_build_object('dia', to_char(dia,'YYYY-MM-DD'), 'ventas', ventas_dia) ORDER BY dia)
      FROM por_dia
    ), '[]'::jsonb),
    'porVendedor', COALESCE((
      SELECT jsonb_agg(row ORDER BY nventas DESC, nombre)
      FROM (
        SELECT jsonb_build_object(
          'responsable_id',       vm.responsable_id,
          'nombre',               COALESCE(s.full_name, '(sin responsable)'),
          'sin_responsable',      vm.responsable_id IS NULL,
          'es_lider',             COALESCE(bool_or(pf.role IN ('owner','admin','supervisor')), false),
          'num_ventas',           COUNT(*),
          'valor_sin_iva',        COALESCE(SUM(vm.honorario_sin_iva), 0),
          'valor_con_iva',        COALESCE(SUM(vm.honorario_con_iva), 0),
          'primer_pago',          COALESCE(SUM(vm.primer_pago), 0),
          'segundo_pago',         COALESCE(SUM(vm.segundo_pago), 0),
          'casos_completos',      COUNT(*) FILTER (WHERE vm.caso_completo),
          'tasa_casos_completos', CASE WHEN COUNT(*) > 0
                                       THEN round(100.0 * COUNT(*) FILTER (WHERE vm.caso_completo) / COUNT(*), 1)
                                       ELSE NULL END,
          'participacion_pct',    CASE WHEN (SELECT num_ventas FROM tot) > 0
                                       THEN round(100.0 * COUNT(*) / (SELECT num_ventas FROM tot), 1)
                                       ELSE NULL END,
          'meta_num_ventas',      (SELECT meta_num_ventas FROM metas_comerciales mc, guard g
                                    WHERE mc.workspace_id=g.id AND mc.staff_id=vm.responsable_id
                                      AND mc.anio=p_anio AND mc.mes=p_mes LIMIT 1),
          'meta_valor',           (SELECT meta_valor FROM metas_comerciales mc, guard g
                                    WHERE mc.workspace_id=g.id AND mc.staff_id=vm.responsable_id
                                      AND mc.anio=p_anio AND mc.mes=p_mes LIMIT 1)
        ) AS row,
        COUNT(*) AS nventas,
        COALESCE(s.full_name,'(sin responsable)') AS nombre
        FROM ventas_mes vm
        LEFT JOIN staff s     ON s.id = vm.responsable_id
        LEFT JOIN profiles pf ON pf.id = s.profile_id
        GROUP BY vm.responsable_id, s.full_name
      ) t
    ), '[]'::jsonb)
  );
$function$;

revoke execute on function public.get_comercial_kpis_mes_soena(uuid, integer, integer) from public, anon;
grant  execute on function public.get_comercial_kpis_mes_soena(uuid, integer, integer) to authenticated;

create or replace function public.get_comercial_serie_mensual_soena(
  p_workspace_id uuid, p_meses integer default 12
) returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  meses AS (
    SELECT date_trunc('month', CURRENT_DATE) - (n || ' month')::interval AS mes_ini
    FROM generate_series(0, GREATEST(p_meses,1) - 1) n
  ),
  ventas AS (
    SELECT
      n.id AS negocio_id,
      MIN(cv.fecha) AS fecha_venta,
      COALESCE(vv.valor_aprobado_base, 0)  AS honorario_sin_iva,
      COALESCE(vv.valor_aprobado_total, 0) AS honorario_con_iva
    FROM negocios n
    JOIN guard g            ON n.workspace_id = g.id
    JOIN v_cobro_valor cv   ON cv.negocio_id = n.id AND cv.workspace_id = g.id
    JOIN v_negocio_valor vv ON vv.negocio_id = n.id
    GROUP BY n.id, vv.valor_aprobado_base, vv.valor_aprobado_total
  ),
  ventas_por_mes AS (
    SELECT
      date_trunc('month', fecha_venta) AS mes_ini,
      COUNT(*) AS num_ventas,
      SUM(honorario_sin_iva) AS valor_sin_iva,
      SUM(honorario_con_iva) AS valor_con_iva
    FROM ventas GROUP BY 1
  ),
  recaudo_por_mes AS (
    -- Primer pago / segundo pago / tarifa, derivados de las cuentas.
    SELECT
      date_trunc('month', cv.fecha) AS mes_ini,
      SUM(cv.a_tramo1 + cv.a_tramo2) AS honorario_recaudado,
      SUM(cv.a_tramo1)               AS primer_pago,
      SUM(cv.a_tramo2)               AS segundo_pago,
      SUM(cv.a_tarifa)               AS tarifa
    FROM v_cobro_valor cv, guard g
    WHERE cv.workspace_id = g.id
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'serie', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'anio',                EXTRACT(YEAR  FROM m.mes_ini)::int,
        'mes',                 EXTRACT(MONTH FROM m.mes_ini)::int,
        'label',               to_char(m.mes_ini, 'Mon YY'),
        'num_ventas',          COALESCE(vm.num_ventas, 0),
        'valor_sin_iva',       COALESCE(vm.valor_sin_iva, 0),
        'valor_con_iva',       COALESCE(vm.valor_con_iva, 0),
        'honorario_recaudado', COALESCE(rm.honorario_recaudado, 0),
        'primer_pago',         COALESCE(rm.primer_pago, 0),
        'segundo_pago',        COALESCE(rm.segundo_pago, 0),
        'tarifa_recaudada',    COALESCE(rm.tarifa, 0)
      ) ORDER BY m.mes_ini)
      FROM meses m
      LEFT JOIN ventas_por_mes  vm ON vm.mes_ini = m.mes_ini
      LEFT JOIN recaudo_por_mes rm ON rm.mes_ini = m.mes_ini
    ), '[]'::jsonb),
    'tasa_recaudo_global', (
      SELECT CASE WHEN SUM(vm.valor_con_iva) > 0
                  THEN round(100.0 * COALESCE((SELECT SUM(honorario_recaudado) FROM recaudo_por_mes), 0)
                       / SUM(vm.valor_con_iva), 1)
                  ELSE NULL END
      FROM ventas_por_mes vm
    )
  );
$function$;

revoke execute on function public.get_comercial_serie_mensual_soena(uuid, integer) from public, anon;
grant  execute on function public.get_comercial_serie_mensual_soena(uuid, integer) to authenticated;
