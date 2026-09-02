-- Punto 80 SOENA: el cash de HONORARIO en tableros se presenta neto de IVA.
--
-- Decision de Mauricio (2026-09-02): el honorario que muestran los tableros es
-- ingreso, y el IVA no es ingreso: se recauda para la DIAN y se previsiona aparte.
-- Esto revierte la regla anterior, que dejaba el recaudo bruto para que la cartera
-- fuera comparable contra el extracto.
--
-- Medido antes de aplicar (ws SOENA 7dea141d-d4da-483d-a78d-b14ef35500c5):
--   Direccion, agosto: cumplimiento 69,0% -> 58,0% (la meta ya estaba declarada SIN IVA)
--   "Honorario recaudado" historico: $184.759.766, con $29.499.458 de IVA adentro
--
-- DOS COSAS QUE ESTA MIGRACION NO TOCA, A PROPOSITO:
--
-- 1. Los tramos brutos de `v_cobro_valor` (`a_tramo1`, `a_tramo2`, `a_tarifa`,
--    `excedente`, `monto`). Sus techos gobiernan operacion viva: el gate
--    `saldo_cero` de Cobro, el routing, la conciliacion contra ePayco y lo que se
--    le manda a Siigo. Ahi la pregunta es "cuanta plata entro a la cuenta", y la
--    respuesta lleva IVA. Solo se AGREGAN columnas base al lado.
--    Por eso `v_pyl_mes`, `v_mc_linea_mes` y `v_cartera_negocio`, que leen esta
--    vista, siguen viendo exactamente lo mismo que antes.
--
-- 2. La TARIFA UPME. No causa IVA: la UPME la cobra sin el y SOENA la consigna
--    integra. Descontarle 19% seria inventar un impuesto que nadie cobro.
--    No tiene columna base y no debe tenerla.

-- ── 1. v_cobro_valor: mismas columnas de siempre, mas el honorario en base ──
--
-- `iva_frac` llevaba aqui desde `20260810130000` sin un solo consumidor. Este es
-- su consumidor. Cuando el negocio no declara IVA (`iva_origen = 'sin_declarar'`)
-- vale 0 y la base queda igual al bruto: no se inventa una tasa que nadie declaro,
-- que es la misma regla que ya aplica `v_negocio_valor.valor_aprobado_base`.
CREATE OR REPLACE VIEW public.v_cobro_valor AS
WITH elegibles AS (
  SELECT c.id, c.workspace_id, c.negocio_id, c.fecha, c.monto, c.tipo_cobro,
         COALESCE(sum(GREATEST(c.monto, 0::numeric)) OVER (
           PARTITION BY c.negocio_id ORDER BY c.fecha, c.id
           ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0::numeric) AS consumido_antes
  FROM cobros c
  WHERE c.fecha IS NOT NULL AND COALESCE(c.tipo_cobro, ''::text) <> 'pasante'::text
),
franjas AS (
  SELECT e.id, e.workspace_id, e.negocio_id, e.fecha, e.monto, e.tipo_cobro,
         e.consumido_antes, v.linea_id,
         COALESCE(v.iva_frac, 0::numeric) AS iva_frac,
         COALESCE(v.iva_origen, 'sin_declarar'::text) AS iva_origen,
         v.techo_tramo1 AS fin_tramo1,
         v.techo_tramo1 + COALESCE(v.techo_tarifa, 0::numeric) AS fin_tarifa,
         v.techo_tramo1 + COALESCE(v.techo_tarifa, 0::numeric) + COALESCE(v.techo_tramo2, 0::numeric) AS fin_tramo2
  FROM elegibles e
  LEFT JOIN v_negocio_valor v ON v.negocio_id = e.negocio_id
),
imputado AS (
  SELECT f.*, f.consumido_antes AS desde, f.consumido_antes + f.monto AS hasta,
         f.negocio_id IS NULL OR f.fin_tramo1 IS NULL AS sin_techo
  FROM franjas f
),
repartido AS (
  SELECT id AS cobro_id, workspace_id, negocio_id, linea_id, fecha, tipo_cobro, monto,
         iva_frac, iva_origen,
         CASE WHEN monto <= 0::numeric THEN 0::numeric
              WHEN sin_techo THEN monto
              ELSE GREATEST(0::numeric, LEAST(hasta, fin_tramo1) - GREATEST(desde, 0::numeric))
         END AS a_tramo1,
         CASE WHEN monto <= 0::numeric OR sin_techo THEN 0::numeric
              ELSE GREATEST(0::numeric, LEAST(hasta, fin_tarifa) - GREATEST(desde, fin_tramo1))
         END AS a_tarifa,
         CASE WHEN monto <= 0::numeric OR sin_techo THEN 0::numeric
              ELSE GREATEST(0::numeric, LEAST(hasta, fin_tramo2) - GREATEST(desde, fin_tarifa))
         END AS a_tramo2,
         CASE WHEN monto <= 0::numeric THEN monto
              WHEN sin_techo THEN 0::numeric
              ELSE GREATEST(0::numeric, hasta - GREATEST(desde, fin_tramo2))
         END AS excedente,
         monto > 0::numeric AND NOT sin_techo AND desde < fin_tramo1 AND hasta >= fin_tramo1 AS completa_tramo1,
         monto > 0::numeric AND NOT sin_techo AND fin_tramo2 > fin_tarifa AND desde < fin_tramo2 AND hasta >= fin_tramo2 AS completa_tramo2
  FROM imputado i
)
SELECT r.*,
       round(r.a_tramo1 / (1::numeric + r.iva_frac), 2) AS a_tramo1_base,
       round(r.a_tramo2 / (1::numeric + r.iva_frac), 2) AS a_tramo2_base
FROM repartido r;

COMMENT ON VIEW public.v_cobro_valor IS
  'Reparte cada cobro en tramos contra los techos de v_negocio_valor. Los tramos '
  'BRUTOS (a_tramo1, a_tramo2, a_tarifa, excedente) llevan IVA y son los que usan el '
  'gate saldo_cero, el routing, la conciliacion ePayco, Siigo y las vistas de caja: '
  'responden "cuanta plata entro". Las columnas _base son el honorario neto de IVA y '
  'son las que usan los tableros: responden "cuanto ingreso hubo". '
  'a_tarifa NO tiene base porque la tarifa UPME no causa IVA: se consigna integra a la '
  'UPME. Nunca derivar base dividiendo `monto`, que mezcla honorario con tarifa.';

-- ── 2. v_venta_mes_comercial: el recaudo pasa a base ──
--
-- Se puede cambiar en sitio, sin columna paralela, porque sus unicos consumidores
-- son las RPC de tablero de SOENA (verificado contra pg_proc: kpis, origen, pagos,
-- plan_pago, seccional, ventas y directivo). Ninguna vista de caja la lee.
--
-- `caso_completo` cambia LOS DOS lados a la vez. Comparaba recaudo bruto contra
-- `valor_aprobado_total`, que tambien es bruto: bajar solo el numerador habria
-- dejado a TODOS los casos como no cubiertos. Alimenta "Hon. cubierto",
-- `casos_completos` y `tasa_casos_completos`.
CREATE OR REPLACE VIEW public.v_venta_mes_comercial AS
WITH cobros_neg AS (
  SELECT cv.negocio_id, cv.workspace_id,
         min(cv.fecha) AS fecha_venta,
         sum(cv.a_tramo1_base + cv.a_tramo2_base) AS honorario_recaudado,
         sum(cv.a_tramo1_base) AS primer_pago,
         sum(cv.a_tramo2_base) AS segundo_pago,
         sum(cv.a_tarifa)      AS tarifa,
         max(cv.fecha) FILTER (WHERE cv.completa_tramo1 OR cv.completa_tramo2) AS fecha_honorario_cubierto
  FROM v_cobro_valor cv
  GROUP BY cv.negocio_id, cv.workspace_id
)
SELECT n.workspace_id, n.id AS negocio_id, n.codigo, n.nombre, n.estado, n.created_at,
       vc.comercial_staff_id AS responsable_id,
       cn.fecha_venta, cn.fecha_honorario_cubierto,
       COALESCE(vv.valor_aprobado_total, 0::numeric) AS honorario_con_iva,
       COALESCE(vv.valor_aprobado_base,  0::numeric) AS honorario_sin_iva,
       COALESCE(cn.honorario_recaudado, 0::numeric)  AS honorario_recaudado,
       COALESCE(cn.primer_pago,   0::numeric) AS primer_pago,
       COALESCE(cn.segundo_pago,  0::numeric) AS segundo_pago,
       COALESCE(cn.tarifa,        0::numeric) AS tarifa,
       COALESCE(cn.honorario_recaudado, 0::numeric)
         >= (COALESCE(vv.valor_aprobado_base, 0::numeric) - 1::numeric) AS caso_completo,
       n.contacto_id,
       n.origen AS origen_declarado,
       vb.bonificable,
       vv.plan_pago
FROM negocios n
JOIN cobros_neg cn ON cn.negocio_id = n.id AND cn.fecha_venta IS NOT NULL
JOIN v_negocio_valor vv ON vv.negocio_id = n.id
LEFT JOIN v_negocio_comercial vc ON vc.negocio_id = n.id
LEFT JOIN v_negocio_bonificable vb ON vb.negocio_id = n.id;

COMMENT ON VIEW public.v_venta_mes_comercial IS
  'Una fila por negocio vendido. TODAS las cifras de honorario van NETAS de IVA '
  '(honorario_sin_iva, honorario_recaudado, primer_pago, segundo_pago) porque es lo '
  'que miden los tableros: ingreso, no caja. `tarifa` va integra porque la tarifa UPME '
  'no causa IVA. `honorario_con_iva` se conserva como cifra de CARTERA (lo que el '
  'cliente paga), no como cifra de ingreso: no mezclar las dos en la misma fila sin '
  'decirlo. `caso_completo` compara base contra base.';

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Las RPC de tablero
--
-- Se reescriben desde `pg_get_functiondef` de PRODUCCION, no desde los archivos
-- del repo. Cuatro de las siete divergian: hay migraciones aplicadas por MCP que
-- nunca quedaron como archivo (20260826141500, 20260831171338, 20260901192404,
-- entre otras). Tomarlas del repo habria revertido en silencio cambios vivos.
--
-- `get_comercial_pagos_mes_soena` NO esta aqui, a proposito: es el panel con el
-- que se concilia contra banco y ePayco, y ahi la cifra tiene que ser la que
-- entro a la cuenta. Se queda bruta y la pantalla lo dice.
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 3.1 KPIs del mes ──
--
-- Lee todo de `v_venta_mes_comercial`, que ya bajo a base: `honorario_recaudado`,
-- `primer_pago`, `segundo_pago`, `casos_completos` y `ticket_promedio` quedan
-- corregidos sin tocarlos.
--
-- Lo unico que hay que arreglar aqui es `tasa_recaudo`, que dividia recaudo
-- contra `valor_con_iva`. Con el numerador ya en base, ese denominador daba una
-- tasa artificialmente baja: comparaba lo cobrado sin IVA contra lo facturado con
-- IVA. Los dos lados van a base. `cumplimiento_valor` ya usaba `valor_sin_iva`.
CREATE OR REPLACE FUNCTION public.get_comercial_kpis_mes_soena(p_workspace_id uuid, p_anio integer, p_mes integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  ventas_mes AS (
    SELECT v.negocio_id, v.responsable_id, v.fecha_venta,
           v.honorario_con_iva, v.honorario_sin_iva, v.honorario_recaudado,
           v.primer_pago, v.segundo_pago, v.tarifa, v.caso_completo, v.bonificable
    FROM v_venta_mes_comercial v, guard g
    WHERE v.workspace_id = g.id
      AND EXTRACT(YEAR  FROM v.fecha_venta) = p_anio
      AND EXTRACT(MONTH FROM v.fecha_venta) = p_mes
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
      COUNT(*) FILTER (WHERE caso_completo)                AS casos_completos,
      COUNT(*) FILTER (WHERE bonificable)                  AS bonificables,
      COUNT(*) FILTER (WHERE bonificable IS NULL)          AS bonificable_sin_medir
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
  por_dia_vendedor AS (
    SELECT fecha_venta::date AS dia, responsable_id, COUNT(*) AS ventas_dia
    FROM ventas_mes GROUP BY fecha_venta::date, responsable_id
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
      'bonificables',         CASE WHEN (SELECT num_ventas FROM tot) > 0
                                    AND (SELECT bonificable_sin_medir FROM tot) = (SELECT num_ventas FROM tot)
                                   THEN NULL ELSE (SELECT bonificables FROM tot) END,
      'bonificable_sin_medir',(SELECT bonificable_sin_medir FROM tot),
      'tasa_bonificables',    CASE WHEN (SELECT num_ventas FROM tot) - (SELECT bonificable_sin_medir FROM tot) > 0
                                    THEN round(100.0 * (SELECT bonificables FROM tot)
                                         / ((SELECT num_ventas FROM tot) - (SELECT bonificable_sin_medir FROM tot)), 1)
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
      'tasa_recaudo',         CASE WHEN (SELECT valor_sin_iva FROM tot) > 0
                                    THEN round(100.0 * (SELECT honorario_recaudado FROM tot) / (SELECT valor_sin_iva FROM tot), 1)
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
    'porDiaVendedor', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'dia', to_char(dia,'YYYY-MM-DD'),
        'responsable_id', responsable_id,
        'ventas', ventas_dia
      ) ORDER BY dia, responsable_id NULLS LAST)
      FROM por_dia_vendedor
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
          'bonificables',         CASE WHEN COUNT(*) = COUNT(*) FILTER (WHERE vm.bonificable IS NULL)
                                       THEN NULL ELSE COUNT(*) FILTER (WHERE vm.bonificable) END,
          'participacion_pct',    CASE WHEN (SELECT num_ventas FROM tot) > 0
                                       THEN round(100.0 * COUNT(*) / (SELECT num_ventas FROM tot), 1)
                                       ELSE NULL END,
          'meta_num_ventas',      mv.meta_num_ventas,
          'meta_valor',           mv.meta_valor
        ) AS row,
        COUNT(*) AS nventas,
        COALESCE(s.full_name, '(sin responsable)') AS nombre
        FROM ventas_mes vm
        LEFT JOIN staff s     ON s.id = vm.responsable_id
        LEFT JOIN profiles pf ON pf.id = s.profile_id
        LEFT JOIN metas_comerciales mv ON mv.staff_id = vm.responsable_id
             AND mv.anio = p_anio AND mv.mes = p_mes
             AND mv.workspace_id = (SELECT id FROM guard)
        GROUP BY vm.responsable_id, s.full_name, mv.meta_num_ventas, mv.meta_valor
      ) t
    ), '[]'::jsonb)
  );
$function$;

-- ── 3.2 Serie mensual ──
--
-- `recaudo_por_mes` pasa a base. `tarifa` se queda como esta.
-- `tasa_recaudo_global` dividia contra `valor_con_iva`: mismo arreglo que en KPIs.
CREATE OR REPLACE FUNCTION public.get_comercial_serie_mensual_soena(p_workspace_id uuid, p_meses integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') AS fecha_venta,
      COALESCE(vv.valor_aprobado_base, 0)  AS honorario_sin_iva,
      COALESCE(vv.valor_aprobado_total, 0) AS honorario_con_iva
    FROM negocios n
    JOIN guard g            ON n.workspace_id = g.id
    JOIN cobros c           ON c.negocio_id = n.id AND c.workspace_id = g.id AND c.fecha IS NOT NULL
    JOIN v_negocio_valor vv ON vv.negocio_id = n.id
    GROUP BY n.id, vv.valor_aprobado_base, vv.valor_aprobado_total
    HAVING MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') IS NOT NULL
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
    SELECT
      date_trunc('month', cv.fecha) AS mes_ini,
      SUM(cv.a_tramo1_base + cv.a_tramo2_base) AS honorario_recaudado,
      SUM(cv.a_tramo1_base)                    AS primer_pago,
      SUM(cv.a_tramo2_base)                    AS segundo_pago,
      SUM(cv.a_tarifa)                         AS tarifa
    FROM v_cobro_valor cv, guard g
    WHERE cv.workspace_id = g.id AND cv.fecha IS NOT NULL
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
      SELECT CASE WHEN SUM(vm.valor_sin_iva) > 0
                  THEN round(100.0 * COALESCE((SELECT SUM(honorario_recaudado) FROM recaudo_por_mes), 0)
                       / SUM(vm.valor_sin_iva), 1)
                  ELSE NULL END
      FROM ventas_por_mes vm
    )
  );
$function$;

-- ── 3.3 Serie por seccional ──
--
-- Solo `recaudo_agr`. Las ventas ya venian de `valor_aprobado_base`.
CREATE OR REPLACE FUNCTION public.get_comercial_serie_seccional_soena(p_workspace_id uuid, p_meses integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  desde AS (
    SELECT date_trunc('month', current_date) - make_interval(months => GREATEST(p_meses, 1) - 1) AS ini
  ),
  ventas AS (
    SELECT
      n.id AS negocio_id,
      nullif(btrim(n.metadata ->> 'seccional'), '') AS seccional,
      MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') AS fecha_venta,
      COALESCE(vv.valor_aprobado_base, 0)  AS honorario_sin_iva,
      COALESCE(vv.valor_aprobado_total, 0) AS honorario_con_iva
    FROM negocios n
    JOIN guard g            ON n.workspace_id = g.id
    JOIN cobros c           ON c.negocio_id = n.id AND c.workspace_id = g.id AND c.fecha IS NOT NULL
    JOIN v_negocio_valor vv ON vv.negocio_id = n.id
    GROUP BY n.id, n.metadata, vv.valor_aprobado_base, vv.valor_aprobado_total
    HAVING MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') IS NOT NULL
  ),
  ventas_agr AS (
    SELECT
      date_trunc('month', v.fecha_venta) AS mes_ini,
      v.seccional,
      COUNT(*)                    AS num_ventas,
      SUM(v.honorario_sin_iva)    AS valor_sin_iva,
      SUM(v.honorario_con_iva)    AS valor_con_iva,
      array_agg(v.negocio_id)     AS negocio_ids
    FROM ventas v, desde d
    WHERE v.fecha_venta >= d.ini
    GROUP BY 1, 2
  ),
  recaudo_agr AS (
    SELECT
      date_trunc('month', cv.fecha) AS mes_ini,
      nullif(btrim(n.metadata ->> 'seccional'), '') AS seccional,
      SUM(cv.a_tramo1_base + cv.a_tramo2_base) AS honorario_recaudado,
      SUM(cv.a_tramo1_base)                    AS primer_pago,
      SUM(cv.a_tramo2_base)                    AS segundo_pago,
      SUM(cv.a_tarifa)                         AS tarifa,
      array_agg(cv.cobro_id)                   AS cobro_ids
    FROM v_cobro_valor cv
    JOIN guard g ON cv.workspace_id = g.id
    CROSS JOIN desde d
    LEFT JOIN negocios n ON n.id = cv.negocio_id
    WHERE cv.fecha IS NOT NULL AND cv.fecha >= d.ini
    GROUP BY 1, 2
  ),
  claves AS (
    SELECT mes_ini, seccional FROM ventas_agr
    UNION
    SELECT mes_ini, seccional FROM recaudo_agr
  )
  SELECT jsonb_build_object(
    'serie', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'anio',                EXTRACT(YEAR  FROM k.mes_ini)::int,
        'mes',                 EXTRACT(MONTH FROM k.mes_ini)::int,
        'seccional_cruda',     k.seccional,
        'num_ventas',          COALESCE(va.num_ventas, 0),
        'valor_sin_iva',       COALESCE(va.valor_sin_iva, 0),
        'valor_con_iva',       COALESCE(va.valor_con_iva, 0),
        'honorario_recaudado', COALESCE(ra.honorario_recaudado, 0),
        'primer_pago',         COALESCE(ra.primer_pago, 0),
        'segundo_pago',        COALESCE(ra.segundo_pago, 0),
        'tarifa_recaudada',    COALESCE(ra.tarifa, 0),
        'negocio_ids',         COALESCE(to_jsonb(va.negocio_ids), '[]'::jsonb),
        'cobro_ids',           COALESCE(to_jsonb(ra.cobro_ids), '[]'::jsonb)
      ) ORDER BY k.mes_ini, k.seccional NULLS LAST)
      FROM claves k
      LEFT JOIN ventas_agr  va ON va.mes_ini = k.mes_ini AND va.seccional IS NOT DISTINCT FROM k.seccional
      LEFT JOIN recaudo_agr ra ON ra.mes_ini = k.mes_ini AND ra.seccional IS NOT DISTINCT FROM k.seccional
    ), '[]'::jsonb)
  );
$function$;

-- ── 3.4 Serie por vendedor ──
--
-- Misma transformacion que seccional, cambiando la llave de agrupacion.
CREATE OR REPLACE FUNCTION public.get_comercial_serie_vendedor_soena(p_workspace_id uuid, p_meses integer DEFAULT 12)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  desde AS (
    SELECT date_trunc('month', current_date) - make_interval(months => GREATEST(p_meses, 1) - 1) AS ini
  ),
  ventas AS (
    SELECT
      n.id AS negocio_id,
      vc.comercial_staff_id AS responsable_id,
      MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') AS fecha_venta,
      COALESCE(vv.valor_aprobado_base, 0)  AS honorario_sin_iva,
      COALESCE(vv.valor_aprobado_total, 0) AS honorario_con_iva
    FROM negocios n
    JOIN guard g            ON n.workspace_id = g.id
    JOIN cobros c           ON c.negocio_id = n.id AND c.workspace_id = g.id AND c.fecha IS NOT NULL
    JOIN v_negocio_valor vv ON vv.negocio_id = n.id
    LEFT JOIN v_negocio_comercial vc ON vc.negocio_id = n.id
    GROUP BY n.id, vc.comercial_staff_id, vv.valor_aprobado_base, vv.valor_aprobado_total
    HAVING MIN(c.fecha) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') IS NOT NULL
  ),
  ventas_agr AS (
    SELECT
      date_trunc('month', v.fecha_venta) AS mes_ini,
      v.responsable_id,
      COUNT(*)                    AS num_ventas,
      SUM(v.honorario_sin_iva)    AS valor_sin_iva,
      SUM(v.honorario_con_iva)    AS valor_con_iva,
      array_agg(v.negocio_id)     AS negocio_ids
    FROM ventas v, desde d
    WHERE v.fecha_venta >= d.ini
    GROUP BY 1, 2
  ),
  recaudo_agr AS (
    SELECT
      date_trunc('month', cv.fecha) AS mes_ini,
      vc.comercial_staff_id AS responsable_id,
      SUM(cv.a_tramo1_base + cv.a_tramo2_base) AS honorario_recaudado,
      SUM(cv.a_tramo1_base)                    AS primer_pago,
      SUM(cv.a_tramo2_base)                    AS segundo_pago,
      SUM(cv.a_tarifa)                         AS tarifa,
      array_agg(cv.cobro_id)                   AS cobro_ids
    FROM v_cobro_valor cv
    JOIN guard g ON cv.workspace_id = g.id
    CROSS JOIN desde d
    LEFT JOIN v_negocio_comercial vc ON vc.negocio_id = cv.negocio_id
    WHERE cv.fecha IS NOT NULL AND cv.fecha >= d.ini
    GROUP BY 1, 2
  ),
  claves AS (
    SELECT mes_ini, responsable_id FROM ventas_agr
    UNION
    SELECT mes_ini, responsable_id FROM recaudo_agr
  )
  SELECT jsonb_build_object(
    'serie', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'anio',                EXTRACT(YEAR  FROM k.mes_ini)::int,
        'mes',                 EXTRACT(MONTH FROM k.mes_ini)::int,
        'responsable_id',      k.responsable_id,
        'nombre',              COALESCE(s.full_name, '(sin responsable)'),
        'num_ventas',          COALESCE(va.num_ventas, 0),
        'valor_sin_iva',       COALESCE(va.valor_sin_iva, 0),
        'valor_con_iva',       COALESCE(va.valor_con_iva, 0),
        'honorario_recaudado', COALESCE(ra.honorario_recaudado, 0),
        'primer_pago',         COALESCE(ra.primer_pago, 0),
        'segundo_pago',        COALESCE(ra.segundo_pago, 0),
        'tarifa_recaudada',    COALESCE(ra.tarifa, 0),
        'negocio_ids',         COALESCE(to_jsonb(va.negocio_ids), '[]'::jsonb),
        'cobro_ids',           COALESCE(to_jsonb(ra.cobro_ids), '[]'::jsonb)
      ) ORDER BY k.mes_ini, k.responsable_id NULLS LAST)
      FROM claves k
      LEFT JOIN ventas_agr  va ON va.mes_ini = k.mes_ini AND va.responsable_id IS NOT DISTINCT FROM k.responsable_id
      LEFT JOIN recaudo_agr ra ON ra.mes_ini = k.mes_ini AND ra.responsable_id IS NOT DISTINCT FROM k.responsable_id
      LEFT JOIN staff s ON s.id = k.responsable_id
    ), '[]'::jsonb)
  );
$function$;

-- ── 3.5 Resumen por comercial ──
--
-- Ya leia de `v_cobro_valor` (por eso su comentario advierte que sumar
-- `cobros.monto` a secas metia la tarifa dentro del honorario). Solo baja a base.
CREATE OR REPLACE FUNCTION public.get_comercial_resumen_soena(p_workspace_id uuid, p_anio integer DEFAULT NULL::integer, p_mes integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  -- Recaudo del periodo YA IMPUTADO. `v_cobro_valor` separa lo que es honorario
  -- (tramo 1 + tramo 2) de lo que es tarifa de un tercero. Sumar `cobros.monto` a
  -- secas metia la tarifa dentro del honorario del comercial.
  -- El honorario va NETO de IVA (columnas _base); la tarifa va integra porque la
  -- tarifa UPME no causa IVA.
  cobros_neg AS (
    SELECT
      cv.negocio_id,
      MIN(cv.fecha)                                                    AS fecha_venta,
      SUM(cv.a_tramo1_base + cv.a_tramo2_base) FILTER (
        WHERE (p_anio IS NULL OR (EXTRACT(YEAR FROM cv.fecha) = p_anio AND EXTRACT(MONTH FROM cv.fecha) = p_mes))
      )                                                                AS honorario,
      SUM(cv.a_tarifa) FILTER (
        WHERE (p_anio IS NULL OR (EXTRACT(YEAR FROM cv.fecha) = p_anio AND EXTRACT(MONTH FROM cv.fecha) = p_mes))
      )                                                                AS tarifa
    FROM v_cobro_valor cv, guard g
    WHERE cv.workspace_id = g.id AND cv.fecha IS NOT NULL
    GROUP BY cv.negocio_id
  ),
  base AS (
    SELECT
      vc.comercial_staff_id AS responsable_id,
      n.stage_actual,
      n.estado,
      COALESCE(vv.valor_aprobado_base, 0)  AS valor_sin_iva,
      COALESCE(vv.valor_aprobado_total, 0) AS valor_con_iva,
      cn.fecha_venta,
      (cn.fecha_venta IS NOT NULL
        AND (p_anio IS NULL
             OR (EXTRACT(YEAR FROM cn.fecha_venta) = p_anio AND EXTRACT(MONTH FROM cn.fecha_venta) = p_mes)))
                                          AS es_venta_periodo,
      vb.bonificable,
      COALESCE(cn.honorario, 0)           AS honorario_recaudado,
      COALESCE(cn.tarifa, 0)              AS tarifa_recaudada
    FROM negocios n
    CROSS JOIN guard g
    JOIN v_negocio_valor vv ON vv.negocio_id = n.id
    LEFT JOIN cobros_neg cn ON cn.negocio_id = n.id
    LEFT JOIN v_negocio_comercial vc ON vc.negocio_id = n.id
    LEFT JOIN v_negocio_bonificable vb ON vb.negocio_id = n.id
    WHERE n.workspace_id = g.id
  ),
  por_resp AS (
    SELECT
      b.responsable_id,
      COUNT(*)                                                      AS negocios_total,
      COUNT(*) FILTER (WHERE b.estado = 'abierto')                 AS negocios_abiertos,
      COUNT(*) FILTER (WHERE b.es_venta_periodo)                   AS num_ventas,
      -- Ventas del periodo que ademas pasaron el umbral. NULL cuando ninguna de sus
      -- ventas se pudo medir: sin dato no es cero, y un cero aqui borraria a esa
      -- persona del ranking.
      CASE WHEN COUNT(*) FILTER (WHERE b.es_venta_periodo) = 0 THEN 0
           WHEN COUNT(*) FILTER (WHERE b.es_venta_periodo AND b.bonificable IS NULL)
                = COUNT(*) FILTER (WHERE b.es_venta_periodo) THEN NULL
           ELSE COUNT(*) FILTER (WHERE b.es_venta_periodo AND b.bonificable)
      END                                                           AS num_bonificables,
      COUNT(*) FILTER (WHERE b.stage_actual = 'venta')             AS en_venta,
      COUNT(*) FILTER (WHERE b.stage_actual = 'ejecucion')         AS en_ejecucion,
      COUNT(*) FILTER (WHERE b.stage_actual = 'cobro')             AS en_cobro,
      COUNT(*) FILTER (WHERE b.stage_actual = 'cerrado'
                          OR b.estado = 'completado')              AS cerrados,
      COALESCE(SUM(b.valor_sin_iva), 0)                            AS valor_aprobado,
      COALESCE(SUM(b.valor_con_iva), 0)                            AS valor_aprobado_con_iva,
      COALESCE(SUM(b.honorario_recaudado), 0)                      AS honorario_recaudado,
      COALESCE(SUM(b.tarifa_recaudada), 0)                         AS tarifa_recaudada
    FROM base b
    GROUP BY b.responsable_id
  )
  SELECT COALESCE(
    (SELECT jsonb_agg(x ORDER BY val DESC, nombre)
     FROM (
       SELECT
         jsonb_build_object(
           'responsable_id',        pr.responsable_id,
           'nombre',                COALESCE(s.full_name, '(sin responsable)'),
           'position',              s.position,
           'es_lider',              COALESCE(pf.role IN ('owner','admin','supervisor'), false),
           'sin_responsable',       pr.responsable_id IS NULL,
           'negocios_total',        pr.negocios_total,
           'negocios_abiertos',     pr.negocios_abiertos,
           'num_ventas',            pr.num_ventas,
           'num_bonificables',      pr.num_bonificables,
           'en_venta',              pr.en_venta,
           'en_ejecucion',          pr.en_ejecucion,
           'en_cobro',              pr.en_cobro,
           'cerrados',              pr.cerrados,
           'valor_aprobado',        pr.valor_aprobado,
           'valor_aprobado_con_iva', pr.valor_aprobado_con_iva,
           'honorario_recaudado',   pr.honorario_recaudado,
           'tarifa_recaudada',      pr.tarifa_recaudada
         ) AS x,
         pr.num_ventas AS val,
         COALESCE(s.full_name, '(sin responsable)') AS nombre
       FROM por_resp pr
       LEFT JOIN staff s    ON s.id = pr.responsable_id
       LEFT JOIN profiles pf ON pf.id = s.profile_id
     ) t),
    '[]'::jsonb
  );
$function$;

-- ── 3.6 Perfil de un comercial ──
--
-- ESTA ES LA QUE MAS CAMBIA, y no solo por el IVA.
--
-- No leia `v_cobro_valor`: sumaba `cobros.monto` a secas y separaba honorario de
-- tarifa por `tipo_cobro`. Dos consecuencias medidas en SOENA el 2026-09-02:
--
--   `honorario_recaudado` historico   $238.045.501   <- lo que mostraba
--   honorario imputado (bruto)        $184.759.766
--   honorario imputado (base de IVA)  $155.260.308   <- lo correcto
--
--   La diferencia contra el bruto son $53.285.735, que es exactamente
--   tarifa ($52.076.380) + excedente ($1.209.355): el cobro entero se contaba
--   como honorario del comercial.
--
--   Y `tarifa_recaudada` mostraba CERO para todos, siempre: sumaba los cobros
--   con `tipo_cobro = 'pasante'` y SOENA no registra ninguno (0 de 0). La tarifa
--   viaja DENTRO del cobro del cliente y la separan los techos, no una etiqueta.
--
-- Se alinea con `get_comercial_resumen_soena`, que ya imputaba bien. Las dos
-- sirven la misma cifra para la misma persona y estaban dando numeros distintos.
CREATE OR REPLACE FUNCTION public.get_comercial_perfil_soena(p_responsable_id uuid, p_anio integer DEFAULT NULL::integer, p_mes integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH ws AS (SELECT current_user_workspace_id() AS id),
  cobros_neg AS (
    SELECT
      cv.negocio_id,
      MIN(cv.fecha) AS fecha_venta,
      SUM(cv.a_tramo1_base + cv.a_tramo2_base) FILTER (
        WHERE (p_anio IS NULL OR (EXTRACT(YEAR FROM cv.fecha) = p_anio AND EXTRACT(MONTH FROM cv.fecha) = p_mes))
      ) AS honorario,
      SUM(cv.a_tarifa) FILTER (
        WHERE (p_anio IS NULL OR (EXTRACT(YEAR FROM cv.fecha) = p_anio AND EXTRACT(MONTH FROM cv.fecha) = p_mes))
      ) AS tarifa
    FROM v_cobro_valor cv, ws
    WHERE cv.workspace_id = ws.id AND cv.fecha IS NOT NULL
    GROUP BY cv.negocio_id
  ),
  base AS (
    SELECT
      n.id,
      n.codigo,
      n.nombre,
      n.stage_actual,
      n.estado,
      n.etapa_cambiada_at,
      e.nombre                        AS etapa_nombre,
      e.numero                        AS etapa_numero,
      (e.config_extra->>'sla_horas')::integer AS sla_horas,
      -- Venta e ingreso van SIN IVA. `valor_con_iva` se conserva como cifra de
      -- CARTERA (lo que el cliente paga), no como cifra de ingreso.
      COALESCE(vv.valor_aprobado_base, 0)  AS valor_sin_iva,
      COALESCE(vv.valor_aprobado_total, 0) AS valor_con_iva,
      cn.fecha_venta,
      (cn.fecha_venta IS NOT NULL
        AND (p_anio IS NULL
             OR (EXTRACT(YEAR FROM cn.fecha_venta) = p_anio AND EXTRACT(MONTH FROM cn.fecha_venta) = p_mes)))
                                      AS es_venta_periodo,
      COALESCE(cn.honorario, 0)       AS honorario_recaudado,
      COALESCE(cn.tarifa, 0)          AS tarifa_recaudada,
      -- Los DOS lados en base. Antes comparaba el valor CON IVA contra un recaudo
      -- que ademas traia tarifa adentro: bajar un solo lado deja un pendiente falso.
      GREATEST(COALESCE(vv.valor_aprobado_base,0) - COALESCE(cn.honorario,0), 0) AS pendiente_honorario,
      CASE
        WHEN n.estado <> 'abierto' THEN 'sin_sla'
        WHEN (e.config_extra->>'sla_horas') IS NULL THEN 'sin_sla'
        WHEN horas_habiles_entre(n.etapa_cambiada_at, now()) > (e.config_extra->>'sla_horas')::numeric THEN 'vencido'
        ELSE 'a_tiempo'
      END AS sla_estado
    FROM negocios n
    CROSS JOIN ws
    JOIN v_negocio_valor vv    ON vv.negocio_id = n.id
    LEFT JOIN cobros_neg cn    ON cn.negocio_id = n.id
    LEFT JOIN etapas_negocio e ON e.id = n.etapa_actual_id
    LEFT JOIN v_negocio_comercial vc ON vc.negocio_id = n.id
    WHERE n.workspace_id = ws.id
      AND vc.comercial_staff_id IS NOT DISTINCT FROM p_responsable_id
  ),
  meses AS (
    SELECT date_trunc('month', CURRENT_DATE) - (n || ' month')::interval AS mes_ini
    FROM generate_series(0, 11) n
  ),
  ventas_mes AS (
    SELECT date_trunc('month', fecha_venta) AS mes_ini, COUNT(*) AS num_ventas,
           COALESCE(SUM(valor_sin_iva),0) AS valor
    FROM base WHERE fecha_venta IS NOT NULL
    GROUP BY 1
  ),
  recaudo_mes AS (
    SELECT date_trunc('month', cv.fecha) AS mes_ini,
           SUM(cv.a_tramo1_base + cv.a_tramo2_base) AS honorario
    FROM v_cobro_valor cv
    CROSS JOIN ws
    JOIN negocios n ON n.id = cv.negocio_id
    LEFT JOIN v_negocio_comercial vc ON vc.negocio_id = n.id
    WHERE cv.workspace_id = ws.id AND cv.fecha IS NOT NULL
      AND vc.comercial_staff_id IS NOT DISTINCT FROM p_responsable_id
    GROUP BY 1
  )
  SELECT jsonb_build_object(
    'responsable_id', p_responsable_id,
    'nombre',         COALESCE((SELECT full_name FROM staff WHERE id = p_responsable_id), '(sin responsable)'),
    'position',       (SELECT position FROM staff WHERE id = p_responsable_id),
    'sin_responsable', p_responsable_id IS NULL,
    'anio', p_anio,
    'mes', p_mes,
    'kpis', (
      SELECT jsonb_build_object(
        'negocios_total',       COUNT(*),
        'negocios_abiertos',    COUNT(*) FILTER (WHERE estado = 'abierto'),
        'num_ventas',           COUNT(*) FILTER (WHERE es_venta_periodo),
        'valor_aprobado',       COALESCE(SUM(valor_sin_iva), 0),
        'valor_aprobado_con_iva', COALESCE(SUM(valor_con_iva), 0),
        'honorario_recaudado',  COALESCE(SUM(honorario_recaudado), 0),
        'tarifa_recaudada',     COALESCE(SUM(tarifa_recaudada), 0),
        'pendiente_honorario',  COALESCE(SUM(pendiente_honorario), 0),
        'vencidos',             COUNT(*) FILTER (WHERE sla_estado = 'vencido')
      ) FROM base
    ),
    'porStage', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'stage', stage, 'negocios', cnt, 'valor_aprobado', val, 'pendiente_honorario', pend
      ) ORDER BY ord)
      FROM (
        SELECT COALESCE(stage_actual, '(sin stage)') AS stage, COUNT(*) AS cnt,
          COALESCE(SUM(valor_sin_iva), 0) AS val, COALESCE(SUM(pendiente_honorario), 0) AS pend,
          MIN(CASE stage_actual WHEN 'venta' THEN 1 WHEN 'ejecucion' THEN 2
                WHEN 'cobro' THEN 3 WHEN 'cerrado' THEN 4 ELSE 5 END) AS ord
        FROM base GROUP BY stage_actual
      ) s
    ), '[]'::jsonb),
    'porEtapa', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'etapa_numero', etapa_numero, 'etapa_nombre', COALESCE(etapa_nombre, '(sin etapa)'),
        'stage', stage_actual, 'negocios', cnt, 'valor_aprobado', val, 'pendiente_honorario', pend
      ) ORDER BY etapa_numero NULLS LAST)
      FROM (
        SELECT etapa_numero, etapa_nombre, stage_actual, COUNT(*) cnt,
          COALESCE(SUM(valor_sin_iva),0) val, COALESCE(SUM(pendiente_honorario),0) pend
        FROM base GROUP BY etapa_numero, etapa_nombre, stage_actual
      ) e
    ), '[]'::jsonb),
    'serie', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'anio', EXTRACT(YEAR FROM m.mes_ini)::int,
        'mes', EXTRACT(MONTH FROM m.mes_ini)::int,
        'label', to_char(m.mes_ini, 'Mon YY'),
        'num_ventas', COALESCE(vm.num_ventas, 0),
        'valor_aprobado', COALESCE(vm.valor, 0),
        'honorario_recaudado', COALESCE(rm.honorario, 0)
      ) ORDER BY m.mes_ini)
      FROM meses m
      LEFT JOIN ventas_mes vm ON vm.mes_ini = m.mes_ini
      LEFT JOIN recaudo_mes rm ON rm.mes_ini = m.mes_ini
    ), '[]'::jsonb),
    'negocios', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', id, 'codigo', codigo, 'nombre', nombre, 'stage', stage_actual, 'estado', estado,
        'etapa_nombre', etapa_nombre, 'etapa_numero', etapa_numero,
        'es_venta', es_venta_periodo, 'fecha_venta', fecha_venta,
        'ultimo_avance', etapa_cambiada_at, 'sla_horas', sla_horas, 'sla_estado', sla_estado,
        'valor_aprobado', valor_sin_iva, 'valor_aprobado_con_iva', valor_con_iva,
        'honorario_recaudado', honorario_recaudado,
        'tarifa_recaudada', tarifa_recaudada, 'pendiente_honorario', pendiente_honorario
      ) ORDER BY valor_sin_iva DESC, nombre)
      FROM base
    ), '[]'::jsonb)
  );
$function$;

-- ── 3.7 Tablero de Direccion ──
--
-- Es la superficie con el problema mas grave: `ventas_totales` es la unica cifra
-- de cash que se compara contra una META, y la meta que Direccion tiene declarada
-- esta SIN IVA. Medido en agosto: cumplimiento 69,0% contra un neto real de 58,0%.
--
-- Solo cambia el CTE `pagos`. `ventas_totales` se deriva de esos dos, asi que baja
-- con ellos.
CREATE OR REPLACE FUNCTION public.get_directivo_soena(p_workspace_id uuid, p_anio integer, p_mes integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
with guard as (
  select p_workspace_id as id
  where p_workspace_id = current_user_workspace_id()
),
rango as (
  select make_date(p_anio, p_mes, 1) as desde,
         (make_date(p_anio, p_mes, 1) + interval '1 month')::date as hasta
),
mapa(fila_orden, fila, etapa_orden) as (
  values
    (1,  'En presentación a UPME',                    array[7]),
    (2,  'A la espera de pago a la UPME',             array[8]),
    (3,  'En evaluación de UPME',                     array[20]),
    (4,  'Certificado UPME expedido',                 array[9]),
    (5,  'En agendamiento DIAN',                      array[17]),
    (6,  'Con cita agendada de la DIAN',              array[16]),
    (7,  'Certificado bancario y elaboración de documentos', array[18]),
    (8,  'Documentos enviados al cliente DIAN',       array[13, 14]),
    (9,  'Documentos aceptados por la DIAN',          array[19]),
    (10, 'Proceso terminado',                         array[15]),
    (11, 'Fuera del proceso operativo',               array[1, 2, 4, 5, 6, 10, 11, 12])
),
abiertos as (
  select n.id, n.metadata->>'seccional' as seccional, e.orden as etapa_orden
  from negocios n
  join guard g on n.workspace_id = g.id
  left join etapas_negocio e on e.id = n.etapa_actual_id
  where n.estado = 'abierto'
),
operaciones as (
  select m.fila_orden, m.fila,
         coalesce(a.seccional, '(sin seccional)') as seccional,
         count(a.id) as cantidad
  from mapa m
  left join abiertos a on a.etapa_orden = any(m.etapa_orden)
  group by m.fila_orden, m.fila, coalesce(a.seccional, '(sin seccional)')
  having count(a.id) > 0
),
terminados as (
  select coalesce(n.metadata->>'seccional', '(sin seccional)') as seccional, count(*) as cantidad
  from negocios n join guard g on n.workspace_id = g.id
  where n.estado = 'completado'
  group by 1
),
leads as (
  select count(*) as n
  from contactos c join guard g on c.workspace_id = g.id
  cross join rango r
  where c.created_at >= r.desde and c.created_at < r.hasta
),
calificados as (
  select count(distinct a.entidad_id) as n
  from activity_log a join guard g on a.workspace_id = g.id
  cross join rango r
  where a.tipo = 'cambio_etapa' and a.entidad_tipo = 'negocio'
    and a.valor_anterior ilike '%validaci%'
    and a.created_at >= r.desde and a.created_at < r.hasta
),
ventas as (
  select count(*) as n
  from v_venta_mes_comercial v join guard g on v.workspace_id = g.id
  cross join rango r
  where v.fecha_venta >= r.desde and v.fecha_venta < r.hasta
),
pagos as (
  select coalesce(sum(cv.a_tramo1_base), 0) as primer_pago,
         coalesce(sum(cv.a_tramo2_base), 0) as segundo_pago
  from v_cobro_valor cv join guard g on cv.workspace_id = g.id
  cross join rango r
  where cv.fecha >= r.desde and cv.fecha < r.hasta
),
citas as (
  select coalesce(n.metadata->>'seccional', '(sin seccional)') as seccional,
         count(*) as cantidad
  from negocio_bloques nb
  join bloque_configs bc on bc.id = nb.bloque_config_id and bc.slug = 'fecha_cita_dian'
  join negocios n on n.id = nb.negocio_id
  join guard g on n.workspace_id = g.id
  cross join rango r
  where nullif(nb.data->>'fecha_cita_dian', '') is not null
    and (nb.data->>'fecha_cita_dian')::date >= r.desde
    and (nb.data->>'fecha_cita_dian')::date <  r.hasta
  group by 1
),
metas as (
  select cm.meta_ventas_mensual, cm.meta_leads_mensual,
         cm.meta_leads_calificados_mensual, cm.meta_negocios_mensual
  from config_metas cm join guard g on cm.workspace_id = g.id
  cross join rango r
  where cm.mes = r.desde
)
select jsonb_build_object(
  'comercial', jsonb_build_object(
    'leads_generados',   (select n from leads),
    'leads_calificados', (select n from calificados),
    'negocios_cerrados', (select n from ventas),
    'primer_pago',       (select primer_pago from pagos),
    'segundo_pago',      (select segundo_pago from pagos),
    'ventas_totales',    (select primer_pago + segundo_pago from pagos)
  ),
  'metas', coalesce((select to_jsonb(m) from metas m), '{}'::jsonb),
  'operaciones', coalesce((
    select jsonb_agg(jsonb_build_object(
      'fila_orden', o.fila_orden, 'fila', o.fila,
      'seccional', o.seccional, 'cantidad', o.cantidad
    ) order by o.fila_orden, o.seccional)
    from operaciones o), '[]'::jsonb),
  'terminados', coalesce((
    select jsonb_agg(jsonb_build_object('seccional', t.seccional, 'cantidad', t.cantidad))
    from terminados t), '[]'::jsonb),
  'citas', coalesce((
    select jsonb_agg(jsonb_build_object('seccional', c.seccional, 'cantidad', c.cantidad))
    from citas c), '[]'::jsonb)
)
where exists (select 1 from guard);
$function$;
