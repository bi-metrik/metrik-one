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
