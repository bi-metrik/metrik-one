-- ============================================================
-- 20261001160000_perf_fence_pagos_ventas_soena
-- ============================================================
-- Rendimiento de la pestaña Comercial de SOENA, segunda parte de
-- 20261001140000_perf_fence_venta_mes_soena (#978). Solo cambia el PLAN de ejecucion,
-- no el resultado: el JSON que devuelve cada RPC queda identico.
--
-- Diagnostico (el mismo de #978): las dos RPC leen `v_venta_mes_comercial`, cuya
-- `fecha_venta` es un min() calculado dentro de la vista. El planner estima mal las
-- filas, elige nested loop y re-ejecuta el subarbol pesado de la vista
-- (v_negocio_valor / v_negocio_bonificable) una vez por fila.
--
-- Arreglo: leer la vista desde una subconsulta con `OFFSET 0`, que Postgres no aplana,
-- acotada al workspace. La vista se calcula UNA vez para el workspace. El filtro/join
-- con `guard` (el control de acceso) queda intacto.
--
--   get_comercial_pagos_mes_soena    174 -> 105 ms (medido en #978)
--   get_comercial_ventas_mes_soena   sin medir aun
--
-- Cada cuerpo es el de su ultima migracion, copiado mecanicamente; sin sus lineas de
-- comentario su md5 coincide con el de produccion. Solo cambia la linea del FROM/JOIN
-- de la vista y se agrega un comentario. No cambian firma, defaults, volatilidad,
-- SECURITY DEFINER, search_path, comment ni grants (se reafirman los mismos).
--
-- Sobre la "deriva" que #978 dejo fuera: no era logica. Lo que corre en produccion es
-- el cuerpo del repo con sus comentarios `--` borrados al aplicar; la logica es
-- identica. Por eso estas dos entran ahora con su cuerpo del repo.
-- ============================================================


-- ── get_comercial_ventas_mes_soena ──
-- Base: 20260824000001_plan_de_pago_declarado.sql (md5 del cuerpo sin comentarios = produccion)
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
    -- OFFSET 0 = barrera de optimizacion A PROPOSITO (no limpiar): sin ella el planner subestima filas (fecha_venta es calculada) y re-ejecuta la vista una vez por fila.
    FROM (SELECT * FROM v_venta_mes_comercial WHERE workspace_id = p_workspace_id OFFSET 0) v
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


-- ── get_comercial_pagos_mes_soena ──
-- Base: 20260824000002_recaudo_del_historico_por_tramos.sql (md5 del cuerpo sin comentarios = produccion).
-- Aqui la vista entra por LEFT JOIN; la barrera va en el mismo sitio. Acotarla al workspace no
-- cambia el resultado: 0 cobros cuyo negocio este en otro workspace y 0 negocios duplicados
-- en la vista (verificado en produccion el 2026-10-01).
create or replace function public.get_comercial_pagos_mes_soena(
  p_workspace_id uuid,
  p_anio integer,
  p_mes integer
) returns jsonb
language sql stable security definer set search_path to 'public'
as $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  rango AS (
    SELECT make_date(p_anio, p_mes, 1) AS desde,
           (make_date(p_anio, p_mes, 1) + interval '1 month')::date AS hasta
  )
  SELECT COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'cobro_id',    cv.cobro_id,
      'fecha',       cv.fecha,
      'monto',       cv.monto,
      'honorario',   cv.a_tramo1 + cv.a_tramo2,
      'a_tramo1',    cv.a_tramo1,
      'a_tramo2',    cv.a_tramo2,
      'a_tarifa',    cv.a_tarifa,
      'excedente',   cv.excedente,
      'negocio_id',  cv.negocio_id,
      'codigo',      n.codigo,
      'nombre',      n.nombre,
      -- De que mes es la VENTA a la que se abona. Es la columna que explica por que la
      -- lista de ventas del mes no puede reconstruir esta barra.
      'fecha_venta', vm.fecha_venta
    ) ORDER BY cv.fecha DESC, cv.monto DESC)
    FROM v_cobro_valor cv
    JOIN guard g ON cv.workspace_id = g.id
    CROSS JOIN rango r
    LEFT JOIN negocios n                ON n.id = cv.negocio_id
    -- OFFSET 0 = barrera de optimizacion A PROPOSITO (no limpiar): sin ella el planner subestima filas (fecha_venta es calculada) y re-ejecuta la vista una vez por fila.
    LEFT JOIN (SELECT * FROM v_venta_mes_comercial WHERE workspace_id = p_workspace_id OFFSET 0) vm ON vm.negocio_id = cv.negocio_id
    WHERE cv.fecha >= r.desde AND cv.fecha < r.hasta
  ), '[]'::jsonb);
$function$;

comment on function public.get_comercial_pagos_mes_soena(uuid, integer, integer) is
  'Los cobros que entraron en un mes, con la imputacion de v_cobro_valor (tramo 1, '
  'tarifa, tramo 2, excedente) y el mes de la venta a la que se abonan. Alimenta el '
  'panel de las dos barras de recaudo del historico. server-only.';

revoke execute on function public.get_comercial_pagos_mes_soena(uuid, integer, integer) from public, anon;
grant  execute on function public.get_comercial_pagos_mes_soena(uuid, integer, integer) to authenticated;
