-- ============================================================================
-- Topar el recaudo contra el valor del negocio es el modelo de SOENA, no del producto.
--
-- La migracion anterior (20260811120000) aplico a TODOS los workspaces el criterio
-- "lo que excede el valor del negocio no es ingreso". Ese criterio pertenece al modelo
-- de dinero de SOENA —honorario mas una tarifa que se recauda y se gira a la UPME— y
-- NO es universal: en un workspace sin ese modelo, un cobro mayor al precio suele
-- significar que el precio esta desactualizado, no que entro plata ajena.
--
-- Medido el 2026-08-11 con la migracion ya aplicada: **ana-demo perdio $900.000 de
-- ingreso** (36.700.000 -> 35.800.000) por un excedente que en su modelo no significa
-- nada. Cada workspace tendra su propia configuracion (Mauricio, 2026-08-11).
--
-- Se declara donde ya vive la configuracion de dinero, igual que la tarifa de IVA:
--
--     lineas_negocio.config_extra.recaudo.topar_por_valor   (gana)
--     workspaces.config_extra.recaudo.topar_por_valor
--
-- **Sin declaracion -> false -> sin techo:** todo el recaudo es ingreso propio, que es
-- exactamente el comportamiento previo a este frente. El default es no aplicar el
-- modelo, no aplicarlo: un workspace que no declara nada recibe lo que ya tenia.
--
-- El espejo en TypeScript es `techosDelNegocio(..., toparPorValor)` en
-- `src/lib/upme/imputacion.ts`, con sus 17 pruebas.
-- ============================================================================

-- ── 1. SOENA declara su modelo ──────────────────────────────────────────────
-- Es el unico workspace con honorario + tarifa de tercero. Los demas NO se declaran:
-- suponerles el modelo es justo el error que esta migracion corrige.

update workspaces
set config_extra = jsonb_set(
      coalesce(config_extra, '{}'::jsonb),
      '{recaudo}',
      coalesce(config_extra->'recaudo', '{}'::jsonb) || jsonb_build_object('topar_por_valor', true),
      true)
where slug = 'soena';

-- ── 2. El negocio dice si su recaudo se topa ────────────────────────────────

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
    -- Modelo de recaudo: linea gana sobre workspace; sin declaracion, NO se topa.
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

  -- Los techos SOLO existen si el workspace/linea declara el modelo topado. NULL = sin
  -- techo: todo el recaudo es ingreso propio.
  --
  -- El ORDEN de estas columnas no se puede tocar: `create or replace view` no renombra
  -- ni reordena, y esta vista ya esta en produccion. Lo nuevo va al final.
  case
    when not r.topar_por_valor then null
    when r.precio_aprobado is null and r.precio_estimado is null then null
    else coalesce(r.precio_aprobado, r.precio_estimado)
  end                                                                                     as valor_techo,
  r.plan_pago,
  case when r.topar_por_valor then r.tarifa_confirmada else 0 end                          as techo_tarifa,
  case
    when not r.topar_por_valor then null
    when r.precio_aprobado is null and r.precio_estimado is null then null
    when r.plan_pago = 1 then coalesce(r.precio_aprobado, r.precio_estimado) / 2
    else coalesce(r.precio_aprobado, r.precio_estimado)
  end                                                                                     as techo_tramo1,
  case
    when not r.topar_por_valor then null
    when r.precio_aprobado is null and r.precio_estimado is null then null
    when r.plan_pago = 1 then coalesce(r.precio_aprobado, r.precio_estimado)
                              - coalesce(r.precio_aprobado, r.precio_estimado) / 2
    else 0
  end                                                                                     as techo_tramo2,
  r.topar_por_valor
from resuelto r;

comment on view v_negocio_valor is
  'Fuente unica del valor de un negocio: total (con IVA), base (sin IVA), IVA, y —solo si '
  'el workspace o la linea declaran `recaudo.topar_por_valor`— los tres techos de recaudo '
  '(tramo 1 y 2 del honorario segun el plan, mas la tarifa confirmada). Sin esa '
  'declaracion los techos son NULL y todo el recaudo es ingreso propio.';

alter view v_negocio_valor set (security_invoker = on);
revoke all on v_negocio_valor from anon;
grant select on v_negocio_valor to authenticated;

-- `v_cobro_valor` NO se toca: ya trata `fin_tramo1 IS NULL` como "sin techo" y manda
-- todo a tramo 1. Apagar el modelo en la configuracion apaga la imputacion por cuentas
-- sin tocar una linea de la imputacion misma — que es lo que hace que esto sea opt-in
-- de verdad y no un `if` regado por la vista.
