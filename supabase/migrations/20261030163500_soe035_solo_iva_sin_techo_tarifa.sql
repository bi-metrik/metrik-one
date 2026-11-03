-- ============================================================================
-- SOE-035: un negocio `solo_iva` no lleva techo de tarifa UPME.
--
-- ── El defecto ──────────────────────────────────────────────────────────────
--
-- El servicio contratado `solo_iva` (bloque `servicio_contratado`, `data.servicio`) dice
-- que el cliente le paga la UPME él mismo: SOENA no cobra tarifa ni hay comprobante que
-- cargar. Pero `v_negocio_valor.techo_tarifa` salía de la tarifa CONFIRMADA sin mirar el
-- servicio, y el bloque de la tarifa puede quedar confirmado igual (medido en SOENA el
-- 2026-10-30: 35 de 41 negocios solo_iva con techo_tarifa > 0). Con ese techo,
-- `v_cobro_valor` mandaba el sobrepago del honorario a `a_tarifa`, y el panel de recibos
-- de caja los volvía candidatos a un RC-3 que nunca va a existir (V0475 $12.500, V0531
-- $65, V0610 $87), frenados pidiendo el comprobante UPME.
--
-- ── El arreglo ──────────────────────────────────────────────────────────────
--
-- Donde nace: con servicio `solo_iva`, la tarifa confirmada cuenta como 0 en la vista. Es
-- la regla que ya aplicaban `count_negocios_por_conciliar` (20260818000004) y
-- `niegaCertificacionUpme`. El sobrepago de esos negocios deja de imputarse como tarifa y
-- cae donde cae cualquier sobrepago sin tarifa (tramo 2 / excedente).
--
-- ⚠️ Mueve `a_tarifa` → `excedente`/`a_tramo2` en `v_cobro_valor` (y lo que la lee) para
-- los cobros de negocios `solo_iva` que pasaron el techo del honorario. Antes de aplicar,
-- medir cuáles de esos cobros tienen ya un RC-3 emitido (marca `componente = 'pasante'`):
-- esos documentos no se tocan, pero quedarían acusando una tarifa que la vista ya no ve.
--
-- ── Cómo se escribió ────────────────────────────────────────────────────────
--
-- Recreada desde la última definición del repo (20260824000001_plan_de_pago_declarado).
-- Los únicos cambios son la CTE `sin_certificacion`, su join y la expresión de
-- `tarifa_confirmada`. Mismas columnas y mismo ORDEN (`create or replace view` no permite
-- alterarlo).
--
-- ⚠️ ANTES DE APLICAR: comparar `pg_get_viewdef('public.v_negocio_valor')` de producción
-- contra la de 20260824000001; si prod tiene algo que el repo no, se integra aquí primero.
--
-- ⚠️ `create or replace view` borra `security_invoker` si no se repite: va en la propia
-- sentencia y otra vez con `alter view` abajo. Los grants se reponen igual que en
-- 20260824000001.
-- ============================================================================

create or replace view public.v_negocio_valor with (security_invoker = on) as
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
  select nb.negocio_id, max((nb.data->>'tarifa_upme_confirmada')::numeric) as tarifa
  from negocio_bloques nb
  join bloque_configs bc on bc.id = nb.bloque_config_id
  where bc.config_extra->'tarifa_confirmacion'->>'enabled' = 'true'
    and nb.data->>'tarifa_confirmada' = 'true'
    and nb.data->>'tarifa_upme_confirmada' ~ '^[0-9]+(\.[0-9]+)?$'
    and (nb.data->>'tarifa_upme_confirmada')::numeric > 0
  group by nb.negocio_id
),
-- SOE-035: el servicio contratado `solo_iva` declara que el cliente le paga la UPME él
-- mismo. Mismo criterio que `count_negocios_por_conciliar` (20260818000004) y
-- `niegaCertificacionUpme` (lib/upme/modelo-dinero.ts): se lee la fuente, no el derivado.
sin_certificacion as (
  select distinct nb.negocio_id
  from negocio_bloques nb
  join bloque_configs bc on bc.id = nb.bloque_config_id
  where bc.slug = 'servicio_contratado'
    and nb.data->>'servicio' = 'solo_iva'
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
    case when sc.negocio_id is not null then 0
         else coalesce(tf.tarifa, 0) end                        as tarifa_confirmada,
    coalesce(
      (l.config_extra->'recaudo'->>'topar_por_valor')::boolean,
      (w.config_extra->'recaudo'->>'topar_por_valor')::boolean,
      false)                                                    as topar_por_valor,
    ip.iva_pct                                                  as iva_propuesta,
    nullif(l.config_extra->'honorario'->>'iva_pct','')::numeric as iva_linea,
    sv.tarifa_iva                                               as iva_servicio,
    nullif(w.config_extra->'honorario'->>'iva_pct','')::numeric as iva_workspace
  from negocios n
  left join propuesta      p  on p.negocio_id  = n.id
  left join iva_propuesta  ip on ip.negocio_id = n.id
  left join tarifa         tf on tf.negocio_id = n.id
  left join sin_certificacion sc on sc.negocio_id = n.id
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
    when not r.topar_por_valor then null
    when r.precio_aprobado is null and r.precio_estimado is null then null
    else coalesce(r.precio_aprobado, r.precio_estimado)
  end                                                                                     as valor_techo,
  r.plan_pago,
  case when r.topar_por_valor then r.tarifa_confirmada else 0 end                          as techo_tarifa,

  -- Sin cambio, y a proposito: bajo CUALQUIER plan el honorario total es el precio, asi
  -- que topar el tramo 1 en el precio reparte bien un pago de `precio + tarifa` sin
  -- necesidad de conocer el plan. Volverlo NULL disparia el camino "sin techo" de
  -- `v_cobro_valor` y la tarifa de terceros pasaria a contarse como ingreso propio.
  case
    when not r.topar_por_valor then null
    when r.precio_aprobado is null and r.precio_estimado is null then null
    when r.plan_pago = 1 then coalesce(r.precio_aprobado, r.precio_estimado) / 2
    else coalesce(r.precio_aprobado, r.precio_estimado)
  end                                                                                     as techo_tramo1,

  -- EL CAMBIO. Tres respuestas distintas, que antes eran dos:
  --   plan 1        -> el resto del honorario (hay segundo tramo, y vale esto)
  --   plan 2        -> 0 (NO hay segundo tramo: es una afirmacion, y es correcta)
  --   sin declarar  -> NULL (no se sabe si lo hay; ausencia de dato no es cero)
  -- NULL y 0 imputan igual (`v_cobro_valor` hace coalesce), asi que esto no mueve plata:
  -- solo deja de afirmar lo que nadie declaro.
  case
    when not r.topar_por_valor then null
    when r.precio_aprobado is null and r.precio_estimado is null then null
    when r.plan_pago = 1 then coalesce(r.precio_aprobado, r.precio_estimado)
                              - coalesce(r.precio_aprobado, r.precio_estimado) / 2
    when r.plan_pago is null then null
    else 0
  end                                                                                     as techo_tramo2,
  r.topar_por_valor
from resuelto r;

comment on view public.v_negocio_valor is
  'Fuente unica del valor de un negocio: total (con IVA), base (sin IVA), IVA, y —solo si '
  'el workspace o la linea declaran `recaudo.topar_por_valor`— los tres techos de recaudo '
  '(tramo 1 y 2 del honorario segun el plan, mas la tarifa confirmada). Sin esa '
  'declaracion los techos son NULL y todo el recaudo es ingreso propio. `techo_tramo2` '
  'distingue las TRES respuestas: el valor del segundo tramo (plan 1), cero cuando el plan '
  'declara que no existe (plan 2), y NULL cuando nadie declaro plan — que no es lo mismo. '
  '`techo_tarifa` es 0 si el servicio contratado es `solo_iva` (SOE-035): el cliente paga '
  'la UPME directamente.';

alter view public.v_negocio_valor set (security_invoker = on);
revoke all on public.v_negocio_valor from anon;
grant select on public.v_negocio_valor to authenticated;
