-- Los negocios en cero cuentan como cierre, pero no pagan bono ni comision
--
-- Decision de Mauricio (2026-09-03), textual: "los negocios en cero deben contar para
-- los cierres, asi sean en cero hacen parte de procesos que se ejecutaron y que por
-- convenios se ejecutan en cero" y, sobre el variable: "solo cuenta como cierre, no
-- paga bono ni comision".
--
-- Hoy no cuentan porque `v_venta_mes_comercial` hace JOIN cerrado contra los cobros:
-- sin pago no hay fila, y ademas no hay fecha con la cual clasificar el caso en un mes
-- (`fecha_venta` es `min(cobro.fecha)`).
--
-- En produccion son 3 casos, los tres reales y los tres con el flujo completo recorrido:
-- V0022 (BIOCIRCULO), V0066 (Edwin Garcia) y V0429 (Angela Rodriguez). Los tres cruzaron
-- la etapa Cobro sin pagar: el gate `saldo_cero` los dejo pasar porque 0 >= 0. O sea que
-- el flujo ya los trataba como legitimos y el que no los veia era el tablero.
--
-- ── Como entra un negocio en cero, y por que asi ──
--
-- La puerta reusa `v_negocio_bonificable`, que ya sabe contestar si el negocio paso el
-- umbral de etapa declarado por la linea. Tres cosas se ganan con eso:
--
--   1. Es opt-in por linea sin inventar configuracion nueva: si la linea no declara
--      `venta_bonificable.pasada_etapa_numero`, la vista devuelve NULL y ningun negocio
--      en cero entra. Los demas workspaces no se enteran de este cambio.
--   2. Prueba el paso por EVIDENCIA (los bloques de una etapa posterior existen), no por
--      donde esta el caso hoy. Un cierre no se retira porque el caso retrocedio, que es
--      la misma regla que ya se acordo para el bono.
--   3. No duplica logica que ya esta probada.
--
-- ⚠️ Solo cuenta el cero ESCRITO (`precio_aprobado = 0`), nunca el NULL. Sin esa
-- condicion, cada negocio al que nadie le puso tarifa se vuelve una venta fantasma: ONE
-- no tiene hoy como distinguir "vale cero por convenio" de "falta el dato". Medido antes
-- de escribir: en etapa 5 o superior hay 0 negocios con `precio_aprobado` en NULL y 3 con
-- cero escrito, asi que la distincion es enforceable sin limpieza previa.
--
-- ── La fecha ──
--
-- Primera entrada a la etapa umbral, leida de `activity_log` (`tipo = 'cambio_etapa'`),
-- en hora de Bogota. Da julio para V0022 y V0066 y agosto para V0429, que es exactamente
-- el mes que SOENA les asigna en su Sheet.
--
-- ⚠️ `activity_log.valor_nuevo` guarda el NOMBRE de la etapa, no su id, asi que el cruce
-- es por nombre y un renombre de etapa parte el historial. Por eso hay COALESCE a
-- `created_at`: ante un renombre el caso puede quedar con una fecha aproximada, pero
-- nunca desaparece del conteo, que es lo que Mauricio pidio evitar.
--
-- ── El variable ──
--
-- `bonificable` sale en FALSE, no en NULL, para los que entran por esta puerta. NULL
-- significa "no se pudo medir" y la pantalla pinta raya, lo que se leeria como un hueco
-- de datos; aqui el caso si se midio y la respuesta es que no aplica.
--
-- La exclusion va aqui y NO en `v_negocio_bonificable`, que se queda pura contestando lo
-- unico que sabe: si el negocio paso el umbral. Verificado contra pg_views y pg_proc: su
-- unico consumidor es esta vista, y las seis RPC comerciales que hablan de `bonificable`
-- lo leen a traves de ella.
--
-- `caso_completo` SI se queda en verdadero: el honorario esta cubierto (0 >= 0 - 1) y eso
-- es precisamente el cierre que se quiere contar.
--
-- ⚠️ Efecto visible: `tasa_bonificables` BAJA, porque los casos en cero suman al
-- denominador (`num_ventas`) y nunca al numerador. Es correcto, pero hay que avisarlo o
-- se lee como un retroceso del equipo.
--
-- ── Medido contra produccion antes de aplicar ──
--
--   filas hoy 326 -> 329 (exactamente +3)
--   filas que cambian de `fecha_venta` o `bonificable`: 0
--   filas que desaparecen: 0
--
-- El cambio es puramente aditivo: ningun negocio pagado cambia de mes ni de cifra.
-- Julio pasa de 45 a 47 ventas y agosto de 62 a 63, con lo que julio queda identico a lo
-- que reporta SOENA (47 ventas, $27.204.750 con IVA, $25.929.750 de primer pago).

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
),
venta_cero AS (
  SELECT n.id AS negocio_id,
         COALESCE(
           (SELECT min(a.created_at AT TIME ZONE 'America/Bogota')::date
              FROM activity_log a
              JOIN etapas_negocio eu ON eu.linea_id = n.linea_id AND eu.orden = vb.orden_umbral
             WHERE a.entidad_id = n.id
               AND a.tipo = 'cambio_etapa'
               AND a.campo_modificado = 'etapa'
               AND a.valor_nuevo = eu.nombre),
           (n.created_at AT TIME ZONE 'America/Bogota')::date
         ) AS fecha_venta
  FROM negocios n
  JOIN v_negocio_bonificable vb ON vb.negocio_id = n.id
  WHERE vb.bonificable IS TRUE
    AND n.precio_aprobado = 0
    AND NOT EXISTS (SELECT 1 FROM cobros c WHERE c.negocio_id = n.id)
)
SELECT n.workspace_id, n.id AS negocio_id, n.codigo, n.nombre, n.estado, n.created_at,
       vc.comercial_staff_id AS responsable_id,
       COALESCE(cn.fecha_venta, vz.fecha_venta) AS fecha_venta,
       cn.fecha_honorario_cubierto,
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
       CASE WHEN cn.negocio_id IS NULL THEN false ELSE vb.bonificable END AS bonificable,
       vv.plan_pago
FROM negocios n
JOIN v_negocio_valor vv ON vv.negocio_id = n.id
LEFT JOIN cobros_neg cn ON cn.negocio_id = n.id AND cn.fecha_venta IS NOT NULL
LEFT JOIN venta_cero vz ON vz.negocio_id = n.id
LEFT JOIN v_negocio_comercial vc ON vc.negocio_id = n.id
LEFT JOIN v_negocio_bonificable vb ON vb.negocio_id = n.id
WHERE cn.negocio_id IS NOT NULL OR vz.negocio_id IS NOT NULL;

COMMENT ON VIEW public.v_venta_mes_comercial IS
  'Una fila por negocio vendido. TODAS las cifras de honorario van NETAS de IVA '
  '(honorario_sin_iva, honorario_recaudado, primer_pago, segundo_pago) porque es lo '
  'que miden los tableros: ingreso, no caja. `tarifa` va integra porque la tarifa UPME '
  'no causa IVA. `honorario_con_iva` se conserva como cifra de CARTERA (lo que el '
  'cliente paga), no como cifra de ingreso. '
  'Un negocio entra por una de dos puertas: tiene cobros, o es una VENTA EN CERO '
  '(convenio ejecutado sin cobro). La segunda exige `precio_aprobado = 0` ESCRITO '
  '(nunca NULL, que significa dato faltante), cero cobros y `bonificable` verdadero en '
  'v_negocio_bonificable, que prueba por evidencia el paso del umbral declarado por la '
  'linea; su `fecha_venta` es la primera entrada a esa etapa umbral. Las ventas en cero '
  'salen con `bonificable = false` por decision de Mauricio: cuentan como cierre y no '
  'pagan bono ni comision. Ojo: eso BAJA `tasa_bonificables`, porque suman al '
  'denominador y nunca al numerador.';
