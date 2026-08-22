-- ============================================================================
-- El plan de pago deja de suponerse, y "sin declarar" deja de contarse como plan 2.
--
-- El honorario se cobra de dos formas, y el negocio lo declara al aprobar la propuesta
-- (`negocio_bloques.data.aprobado_plan`):
--
--   Plan 1 = 50/50            -> mitad por adelantado, mitad al exito. TIENE tramo 2.
--   Plan 2 = 100% anticipado  -> todo por adelantado. NO tiene tramo 2, y eso es un dato.
--
-- ── El defecto: un ELSE que afirma lo que no sabe ───────────────────────────
--
-- `v_negocio_valor` decidia los techos con `when plan_pago = 1 then ... else ...`. Un
-- negocio SIN plan declarado caia en el ELSE y quedaba tratado como plan 2 en silencio:
-- `techo_tramo2 = 0`, o sea "este negocio no tiene segundo pago". Eso no es lo que se
-- sabe de el. Lo que se sabe es que NADIE lo declaro.
--
-- La consecuencia concreta: a un negocio sin plan JAMAS puede aparecerle un segundo
-- pago, aunque el dinero entre. Con techo_tramo2 = 0 el segundo giro cae en
-- `excedente`, que el P&L cuenta como recaudo de TERCEROS y no como ingreso propio.
--
-- ── Medido en produccion ANTES de escribir nada (2026-08-22, workspace SOENA) ─
--
-- Ventas historicas (negocio con >=1 cobro con fecha), linea GIT EV/HEV:
--
--   plan 1        8 ventas    segundo pago recaudado: $850.000
--   plan 2       77 ventas    segundo pago recaudado: $0  (correcto: no existe el tramo)
--   sin declarar  8 ventas    segundo pago recaudado: $0  (imposible por construccion)
--   ---------------------------------------------------------------------------
--                93 ventas
--
-- Del plan 1, solo DOS han pagado su segundo 50%: V0025 y V0099 ($425.000 cada una).
-- Las otras seis pagaron exactamente `techo_tramo1 + tarifa UPME`, al peso.
--
-- Las 8 sin plan son de febrero a junio, todas con precio aprobado, todas con tarifa
-- confirmada ($701.812) que ONE nunca recibio, y todas con el honorario pagado al 100%
-- (ratio pagado/precio = 1.00 en las ocho). Hoy ninguna excede `precio + tarifa`, asi
-- que **el defecto todavia no ha movido un peso**. Se corrige antes de que lo mueva.
--
-- ── Por que NO se toca `techo_tramo1` ───────────────────────────────────────
--
-- La tentacion es volver NULL los dos techos ("sin plan, nada es medible"). Seria peor:
-- `v_cobro_valor` trata `fin_tramo1 IS NULL` como **sin techo** y manda TODO a tramo 1,
-- asi que la tarifa UPME —plata de terceros— pasaria a contarse como ingreso propio, y
-- sin tope. Hoy, con `techo_tramo1 = precio completo`, un pago de `precio + tarifa` se
-- reparte bien sin necesidad de conocer el plan: el honorario total es el precio bajo
-- CUALQUIERA de los dos planes, y lo que sobra es la tarifa. Ese techo se queda.
--
-- Lo que cambia es solo `techo_tramo2`: pasa de `0` (una afirmacion) a `NULL` (la
-- ausencia). Y **no mueve un solo peso**: `v_cobro_valor` ya calcula
-- `fin_tramo2 = techo_tramo1 + coalesce(techo_tarifa,0) + coalesce(techo_tramo2,0)`,
-- asi que NULL y 0 producen la misma imputacion. Lo unico que cambia es que la
-- ausencia queda declarada y las pantallas pueden dibujarla como raya en vez de cero.
--
-- ⚠️ PENDIENTE DE MAURICIO, y por eso NO se toca aqui: si un negocio sin plan que en
-- realidad es 50/50 llegara a pagar su segunda mitad, esa plata sigue cayendo en
-- `excedente`. La solucion de eso no es SQL, es declarar el plan en los 8 negocios.
-- Esta migracion hace que se vean; no adivina cual es.
--
-- ⚠️ El ORDEN DE IMPUTACION (tramo 1 -> tarifa -> tramo 2) tampoco se toca. Sigue
-- marcado "pendiente de confirmacion" en la cabecera de 20260811120000, y la evidencia
-- lo sostiene: en las 5 ventas de plan 1 de agosto el total pagado cuadra al peso con
-- `techo_tramo1 + tarifa`.
-- ============================================================================


-- ── 1. `sin plan` deja de ser `plan 2` en los techos ────────────────────────
-- Recreada desde la definicion VIGENTE volcada de produccion. El unico cambio es la
-- rama `plan_pago IS NULL` de `techo_tramo2`; el resto es identico, incluido el ORDEN
-- de las columnas, que `create or replace view` no permite alterar.

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

comment on view v_negocio_valor is
  'Fuente unica del valor de un negocio: total (con IVA), base (sin IVA), IVA, y —solo si '
  'el workspace o la linea declaran `recaudo.topar_por_valor`— los tres techos de recaudo '
  '(tramo 1 y 2 del honorario segun el plan, mas la tarifa confirmada). Sin esa '
  'declaracion los techos son NULL y todo el recaudo es ingreso propio. `techo_tramo2` '
  'distingue las TRES respuestas: el valor del segundo tramo (plan 1), cero cuando el plan '
  'declara que no existe (plan 2), y NULL cuando nadie declaro plan — que no es lo mismo.';

alter view v_negocio_valor set (security_invoker = on);
revoke all on v_negocio_valor from anon;
grant select on v_negocio_valor to authenticated;


-- ── 2. La venta del mes expone el plan con el que se cobra ──────────────────
-- `plan_pago` va AL FINAL: `create or replace view` agrega columnas, no reordena.

create or replace view v_venta_mes_comercial
with (security_invoker = on) as
with cobros_neg as (
  select
    cv.negocio_id,
    cv.workspace_id,
    min(cv.fecha)                                        as fecha_venta,
    sum(cv.a_tramo1 + cv.a_tramo2)                       as honorario_recaudado,
    sum(cv.a_tramo1)                                     as primer_pago,
    sum(cv.a_tramo2)                                     as segundo_pago,
    sum(cv.a_tarifa)                                     as tarifa,
    max(cv.fecha) filter (where cv.completa_tramo1 or cv.completa_tramo2) as fecha_honorario_cubierto
  from v_cobro_valor cv
  group by cv.negocio_id, cv.workspace_id
)
select
  n.workspace_id,
  n.id                                                   as negocio_id,
  n.codigo,
  n.nombre,
  n.estado,
  n.created_at,
  vc.comercial_staff_id                                  as responsable_id,
  cn.fecha_venta,
  cn.fecha_honorario_cubierto,
  coalesce(vv.valor_aprobado_total, 0)                   as honorario_con_iva,
  coalesce(vv.valor_aprobado_base, 0)                    as honorario_sin_iva,
  coalesce(cn.honorario_recaudado, 0)                    as honorario_recaudado,
  coalesce(cn.primer_pago, 0)                            as primer_pago,
  coalesce(cn.segundo_pago, 0)                           as segundo_pago,
  coalesce(cn.tarifa, 0)                                 as tarifa,
  (coalesce(cn.honorario_recaudado, 0) >= coalesce(vv.valor_aprobado_total, 0) - 1) as caso_completo,
  n.contacto_id,
  n.origen                                               as origen_declarado,
  vb.bonificable                                         as bonificable,
  -- Con que plan se cobra este honorario. NULL = nadie lo declaro al aprobar la
  -- propuesta; NO se pliega a plan 2. Es lo que decide si "segundo pago" siquiera
  -- existe para esta venta, y sin el la casilla vale cero por construccion.
  vv.plan_pago                                           as plan_pago
from negocios n
join cobros_neg cn      on cn.negocio_id = n.id and cn.fecha_venta is not null
join v_negocio_valor vv on vv.negocio_id = n.id
left join v_negocio_comercial vc on vc.negocio_id = n.id
left join v_negocio_bonificable vb on vb.negocio_id = n.id;

comment on view v_venta_mes_comercial is
  'Definicion unica de "venta" del tablero comercial: negocio con al menos un cobro con fecha. '
  'Trae las TRES medidas que el negocio distingue y que antes se confundian: la venta (existe la '
  'fila), caso_completo (el honorario recaudado cubre el aprobado) y bonificable (paso el umbral '
  'que declara la linea), mas el plan de pago con el que se cobra. La consumen '
  'get_comercial_kpis_mes_soena, get_comercial_ventas_mes_soena, get_comercial_origen_mes_soena, '
  'get_comercial_seccional_mes_soena y get_comercial_plan_pago_mes_soena. server-only.';

revoke all on v_venta_mes_comercial from anon, authenticated;


-- ── 3. Las cifras del mes, abiertas por plan de pago ────────────────────────
-- Hermana de `get_comercial_seccional_mes_soena` y con su mismo contrato: consume la
-- MISMA vista que produce el total, y devuelve los `negocio_ids` de cada grupo para que
-- el drill abra exactamente el conjunto que sumo la cifra, sin recalcular el criterio.
--
-- `segundo_pago` viene NULL fuera del plan 1 a proposito. En plan 2 el tramo no existe
-- y en "sin declarar" no se sabe si existe: en ninguno de los dos casos un $0 seria una
-- medicion. Quien pinta la fila ya sabe el plan y elige las palabras.

create or replace function public.get_comercial_plan_pago_mes_soena(
  p_workspace_id uuid,
  p_anio integer,
  p_mes integer
)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  ventas AS (
    SELECT
      v.negocio_id, v.plan_pago,
      v.honorario_sin_iva, v.honorario_con_iva,
      v.primer_pago, v.segundo_pago, v.honorario_recaudado,
      v.caso_completo, v.bonificable
    FROM v_venta_mes_comercial v
    JOIN guard g ON v.workspace_id = g.id
    WHERE EXTRACT(YEAR  FROM v.fecha_venta) = p_anio
      AND EXTRACT(MONTH FROM v.fecha_venta) = p_mes
  )
  SELECT jsonb_build_object(
    'total_ventas', (SELECT COUNT(*) FROM ventas),
    'filas', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'plan_pago')::int NULLS LAST)
      FROM (
        SELECT jsonb_build_object(
          'plan_pago',        plan_pago,
          'ventas',           COUNT(*),
          'valor_sin_iva',    COALESCE(SUM(honorario_sin_iva), 0),
          'valor_con_iva',    COALESCE(SUM(honorario_con_iva), 0),
          'primer_pago',      COALESCE(SUM(primer_pago), 0),
          'segundo_pago',     CASE WHEN plan_pago = 1 THEN COALESCE(SUM(segundo_pago), 0) END,
          'recaudado',        COALESCE(SUM(honorario_recaudado), 0),
          'casos_completos',  COUNT(*) FILTER (WHERE caso_completo),
          'bonificables',     CASE WHEN COUNT(*) = COUNT(*) FILTER (WHERE bonificable IS NULL)
                                   THEN NULL ELSE COUNT(*) FILTER (WHERE bonificable) END,
          'negocio_ids',      jsonb_agg(negocio_id)
        ) AS x
        FROM ventas
        GROUP BY plan_pago
      ) t
    ), '[]'::jsonb)
  );
$function$;

comment on function public.get_comercial_plan_pago_mes_soena(uuid, integer, integer) is
  'Las ventas del mes cortadas por plan de pago: 1 (50/50), 2 (100% anticipado) y el '
  'grupo SIN plan declarado, que va aparte y nunca plegado a plan 2. Consume '
  'v_venta_mes_comercial, la MISMA vista que el total. `segundo_pago` es NULL fuera del '
  'plan 1: donde el tramo no existe o no se sabe si existe, un cero seria una medicion '
  'inventada. Devuelve los negocio_ids de cada grupo para que el drill abra ese conjunto.';

-- ejecutable-por-cliente: la invoca el navegador via server action; filtra por
-- current_user_workspace_id() en su guard, igual que sus hermanas del tablero.
revoke execute on function public.get_comercial_plan_pago_mes_soena(uuid, integer, integer) from public, anon;
grant  execute on function public.get_comercial_plan_pago_mes_soena(uuid, integer, integer) to authenticated;


-- ── 4. El drill dice con que plan se cobra cada caso ────────────────────────
-- Misma firma de 10 argumentos: se agrega una clave al jsonb, no un parametro. Editada
-- sobre la definicion vigente (20260823000002), con `create or replace` para no dejar
-- una sobrecarga conviviendo con la anterior.

create or replace function public.get_comercial_ventas_mes_soena(
  p_workspace_id uuid,
  p_anio integer,
  p_mes integer,
  p_responsable_id uuid default null,
  p_solo_completos boolean default null,
  p_sin_responsable boolean default false,
  p_dia date default null,
  p_campana text default null,
  p_solo_bonificables boolean default null,
  p_negocio_ids uuid[] default null
)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  ventas AS (
    SELECT v.*, a.tiene_rastro_meta, a.campana, a.ultima_conversion,
           a.n_conversiones, a.atribucion_en_conflicto, a.comision_retenida
    FROM v_venta_mes_comercial v
    JOIN guard g ON v.workspace_id = g.id
    LEFT JOIN v_negocio_atribucion a ON a.negocio_id = v.negocio_id
    WHERE EXTRACT(YEAR  FROM v.fecha_venta) = p_anio
      AND EXTRACT(MONTH FROM v.fecha_venta) = p_mes
      AND (p_dia IS NULL OR v.fecha_venta = p_dia)
      AND (CASE WHEN p_sin_responsable THEN v.responsable_id IS NULL
                WHEN p_responsable_id IS NOT NULL THEN v.responsable_id = p_responsable_id
                ELSE true END)
      AND (p_solo_completos IS NULL OR v.caso_completo = p_solo_completos)
      AND (p_solo_bonificables IS NULL OR v.bonificable = p_solo_bonificables)
      AND (p_negocio_ids IS NULL OR v.negocio_id = ANY(p_negocio_ids))
      AND (p_campana IS NULL
           OR (p_campana = '' AND a.campana IS NULL)
           OR a.campana = p_campana)
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'negocio_id',       v.negocio_id,
    'codigo',           v.codigo,
    'nombre',           v.nombre,
    'estado',           v.estado,
    'responsable',      COALESCE(s.full_name, NULL),
    'fecha_venta',      to_char(v.fecha_venta, 'YYYY-MM-DD'),
    'fecha_completado', CASE WHEN v.caso_completo
                             THEN to_char(v.fecha_honorario_cubierto, 'YYYY-MM-DD') END,
    'fecha_creacion',   to_char(v.created_at, 'YYYY-MM-DD'),
    'ultima_conversion', to_char(v.ultima_conversion, 'YYYY-MM-DD'),
    'n_conversiones',   COALESCE(v.n_conversiones, 0),
    'origen_declarado', v.origen_declarado,
    'tiene_rastro_meta', COALESCE(v.tiene_rastro_meta, false),
    'campana',          v.campana,
    'atribucion_en_conflicto', COALESCE(v.atribucion_en_conflicto, false),
    'comision_retenida', COALESCE(v.comision_retenida, false),
    'valor_sin_iva',    v.honorario_sin_iva,
    'valor_con_iva',    v.honorario_con_iva,
    'recaudado',        v.honorario_recaudado,
    'primer_pago',      v.primer_pago,
    'segundo_pago',     v.segundo_pago,
    'caso_completo',    v.caso_completo,
    'bonificable',      v.bonificable,
    -- Con que plan se cobra. NULL = sin declarar, y la lista lo dice con una raya:
    -- sin este dato, "segundo pago: $0" se lee como "no ha pagado" cuando puede
    -- significar "no tiene que pagar" o "no sabemos si tiene que pagar".
    'plan_pago',        v.plan_pago,
    'sin_honorario_aprobado', (v.honorario_con_iva = 0)
  ) ORDER BY v.fecha_venta DESC, v.codigo), '[]'::jsonb)
  FROM ventas v
  LEFT JOIN staff s ON s.id = v.responsable_id;
$function$;

comment on function public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean, date, text, boolean, uuid[]) is
  'Drill del tablero comercial. Consume las MISMAS vistas que la cifra en la que se hizo '
  'clic. p_negocio_ids acota a un conjunto explicito, que es como el corte por seccional '
  '(#22) y el corte por plan de pago abren exactamente los casos que sumaron, sin '
  'recalcular el criterio en el servidor. Cada caso declara su plan_pago, o NULL si nadie '
  'lo declaro.';

revoke execute on function public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean, date, text, boolean, uuid[]) from public, anon;
grant  execute on function public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean, date, text, boolean, uuid[]) to authenticated;
