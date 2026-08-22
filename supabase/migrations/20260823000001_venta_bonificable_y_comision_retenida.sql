-- Una sola definicion de VENTA BONIFICABLE, y la comision no se liquida sobre un
-- origen en disputa.  (Puntos #13, #31 y #46 del inventario de SOENA.)
--
-- ── El problema: tres definiciones de lo mismo ───────────────────────────────────
--
-- El tablero, el ranking y el bono contaban "ventas" con criterios distintos:
--
--   1. VENTA (#12, acordada 16-jul y confirmada 29-jul) = entro dinero. Es
--      `v_venta_mes_comercial`: negocio con al menos un cobro con fecha.
--   2. CASO COMPLETO = el honorario recaudado cubre el aprobado. Es recaudo, no venta.
--   3. VENTA BONIFICABLE (#13, acordada 08-ago) = paso Documentacion. NO EXISTIA.
--
-- Mauricio cerro el 2026-08-22: la #12 NO cambia (venta sigue siendo "entro dinero")
-- y la BONIFICABLE es una sola, la #3. Las tres conviven como columnas distintas
-- porque miden cosas distintas; lo que no puede haber es dos candidatas a bonificable.
--
-- ── Medido en produccion ANTES de escribir nada (2026-08-22, workspace SOENA) ────
--
--   mes       venta (#12)   honorario cubierto   bonificable (#13)
--   2026-07        45              44                  45
--   2026-08        38              33                  35
--
--   Las tres cifras son distintas y hoy la pantalla llama "ventas" a la primera y
--   "casos completos" a la segunda, sin nombrar la tercera.
--
--   ⚠️ En agosto la bonificable (35) es MENOR que la venta (38) y MAYOR que el
--   honorario cubierto (33): no es un punto intermedio por casualidad, son tres
--   conjuntos que no se contienen. Julio lo muestra al reves: 45 bonificables sobre
--   45 ventas y 44 con honorario cubierto.
--
-- ── Como se prueba que un caso "paso Documentacion" ─────────────────────────────
--
-- Por EVIDENCIA de haber visitado una etapa posterior, no por donde esta hoy. Es el
-- mismo criterio que ya usa `sembrar_casillas_bloque` ("negocios que YA visitaron la
-- etapa": tienen alguna casilla suya) y el que usa `reversa-ruta.ts`.
--
-- Se descarto el criterio por POSICION ACTUAL (`etapa_actual.orden > umbral`, que es
-- el que usa la cola de facturacion). Medido: en julio hay 2 casos que visitaron una
-- etapa posterior y hoy estan antes de ella —volvieron—, y por posicion habrian
-- dejado de ser bonificables. El trabajo se hizo; un bono que se retira porque el
-- caso retrocedio castiga al comercial por algo que no depende de el.
--
--   julio:  por posicion 43 · por evidencia 45  (2 casos de diferencia)
--   agosto: por posicion 35 · por evidencia 35  (ninguna)
--
-- ── Opt-in por LINEA, y sin dato NO es "no bonificable" ─────────────────────────
--
-- El umbral se declara en `lineas_negocio.config_extra.venta_bonificable.pasada_etapa_numero`
-- (el `numero` visible de la etapa que hay que dejar atras). Sin esa clave,
-- `bonificable` vale **NULL**, no `false`: una linea que no declaro su umbral no
-- esta diciendo que ninguna venta bonifica, esta diciendo que no lo sabe. La
-- pantalla pinta raya y el puntaje se marca incompleto, que es la regla que gobierna
-- estos tableros. Ninguna linea de ningun otro workspace cambia.
--
-- ── #46: la comision NO se liquida sobre un origen en disputa ───────────────────
--
-- `v_negocio_atribucion` ya marca `atribucion_en_conflicto`, pero ese flag mezcla
-- dos cosas de gravedad muy distinta. Medido en SOENA (289 negocios de la linea):
--
--   promotor  + rastro de Meta : 14   <- decide PLATA: 20% a un tercero contra 16%
--   otro      + rastro de Meta :  4      de marketing. Nadie de fuera cobra por las
--   sin declarar + rastro      :  3      otras 33.
--   meta      SIN rastro       : 26
--   ------------------------------------
--   total marcado en conflicto : 47
--
-- Por eso nace `comision_retenida`, que marca **solo** el caso en que un tercero
-- cobraria por un lead que entro por Meta. De los 14: 12 abiertos, 2 perdidos, y
-- **9 todavia sin honorario aprobado** (siguen en Propuesta), asi que la plata viva
-- hoy son 4 casos por $2.321.428 sin IVA — $464.286 si paga promotor contra
-- $371.429 si paga marketing, $92.857 de diferencia. Los 14 tienen campana.
--
-- No se elige ganador: se marca y se retiene. Lo decide una persona, caso por caso
-- (decision de Mauricio, 2026-08-22).
--
-- ── Un defecto que aparecio al medir, y que decide el ranking ───────────────────
--
-- `get_comercial_resumen_soena` calcula `honorario_recaudado` como `SUM(cobros.monto)`
-- crudo, filtrando `tipo_cobro <> 'pasante'` — un filtro que **no filtra nada**,
-- porque en toda la base hay CERO cobros con ese tipo. Resultado: la tarifa que el
-- cliente paga para la UPME, que es plata de un tercero (punto #20 del inventario,
-- acordado el 24-jul), viaja dentro del "honorario recaudado" de cada comercial, que
-- es la SEGUNDA metrica comparativa del leaderboard.
--
--   Agosto 2026, cobros del mes           mostrado      honorario real     tarifa
--   Jessica Tejada                      $24.121.142      $10.980.500   $13.018.611
--   Esperanza Verdugo                    $9.163.684       $4.250.000    $4.912.684
--   Jenny Cepeda                         $7.715.930       $3.336.250    $4.378.992
--   Liant Chirinos                       $4.304.936       $1.466.250    $2.838.566
--   ------------------------------------------------------------------------------
--   TOTAL                               $45.305.692      $20.033.000   $25.272.853
--
-- El honorario real suma exactamente los $20.033.000 que el panel de KPIs ya muestra
-- para agosto: la cifra corregida cuadra con el tablero y la de hoy no. **El orden
-- del ranking no cambia** (la tarifa es proporcional al honorario), pero los numeros
-- se parten a la mitad y sobre ellos se van a montar las comisiones (#28, #30).
--
-- Esta migracion NO escribe datos. Reemplaza una vista, dos vistas derivadas y tres
-- funciones. El umbral de SOENA se declara aparte, en
-- `proyectos/soena/ve/migrations/20260823_venta_bonificable_git_ev.sql`.


-- ============================================================
-- 1. Que negocios pasaron su umbral de bonificacion
-- ============================================================
-- Vive en su propia vista y no dentro de `v_venta_mes_comercial` para que el bono,
-- el ranking y cualquier consumidor futuro no puedan reimplementarla. Es la leccion
-- de la formula de saldo escrita en siete sitios.

CREATE OR REPLACE VIEW v_negocio_bonificable
WITH (security_invoker = on) AS
WITH umbral AS (
  -- El umbral se declara por linea, con el `numero` VISIBLE de la etapa (el mismo
  -- vocabulario que usa `facturacion.desde_etapa_numero`). `orden` es interno y se
  -- reordena; `numero` no cambia nunca.
  SELECT
    l.id AS linea_id,
    (l.config_extra -> 'venta_bonificable' ->> 'pasada_etapa_numero')::int AS etapa_numero
  FROM lineas_negocio l
),
umbral_orden AS (
  SELECT u.linea_id, e.orden AS orden_umbral
  FROM umbral u
  JOIN etapas_negocio e ON e.linea_id = u.linea_id AND e.numero = u.etapa_numero
  WHERE u.etapa_numero IS NOT NULL
),
visito_posterior AS (
  -- La prueba de haber estado en una etapa es tener alguna casilla suya: las
  -- instancias nacen al ENTRAR. Mismo criterio que `sembrar_casillas_bloque`.
  SELECT DISTINCT nb.negocio_id
  FROM negocio_bloques nb
  JOIN bloque_configs bc  ON bc.id = nb.bloque_config_id
  JOIN etapas_negocio e   ON e.id = bc.etapa_id
  JOIN umbral_orden uo    ON uo.linea_id = e.linea_id
  WHERE e.orden > uo.orden_umbral
)
SELECT
  n.workspace_id,
  n.id AS negocio_id,
  n.linea_id,
  uo.orden_umbral,
  -- NULL cuando la linea no declaro umbral: no se sabe, no es "no bonificable".
  CASE WHEN uo.orden_umbral IS NULL THEN NULL
       ELSE (vp.negocio_id IS NOT NULL) END AS bonificable
FROM negocios n
LEFT JOIN umbral_orden uo     ON uo.linea_id = n.linea_id
LEFT JOIN visito_posterior vp ON vp.negocio_id = n.id;

COMMENT ON VIEW v_negocio_bonificable IS
  'Si un negocio paso el umbral de bonificacion que declara su linea en '
  'config_extra.venta_bonificable.pasada_etapa_numero (punto #13 de SOENA: "venta '
  'bonificable = paso Documentacion"). Se prueba por EVIDENCIA de haber visitado una '
  'etapa posterior (tener casillas suyas), no por donde esta hoy: un caso que '
  'retrocede no deja de haber pasado. bonificable = NULL cuando la linea no declaro '
  'umbral; NULL no es false. server-only.';

REVOKE ALL ON v_negocio_bonificable FROM anon, authenticated;


-- ============================================================
-- 2. Atribucion: separar el conflicto que decide plata
-- ============================================================
-- Se recrea entera porque `create or replace view` solo admite AGREGAR columnas al
-- final, y la nueva va al final. El resto es identico a 20260822000002.

CREATE OR REPLACE VIEW v_negocio_atribucion
WITH (security_invoker = on) AS
SELECT
  n.workspace_id,
  n.id                                        AS negocio_id,
  n.contacto_id,
  n.origen                                    AS origen_declarado,
  (i.n_meta > 0)                              AS tiene_rastro_meta,
  i.campana,
  i.primera_conversion,
  i.ultima_conversion,
  COALESCE(i.n_conversiones, 0)               AS n_conversiones,
  (
    (i.n_meta > 0 AND n.origen IS DISTINCT FROM 'meta')
    OR (n.origen = 'meta' AND COALESCE(i.n_meta, 0) = 0)
  )                                           AS atribucion_en_conflicto,
  -- ⚠️ El subconjunto del conflicto que mueve dinero HACIA AFUERA: se declaro
  -- promotor (20% a un tercero) y el lead entro por Meta (16% de marketing). Los
  -- otros conflictos son un problema de atribucion interna; este es un pago.
  -- Mientras este en true la comision NO se liquida: se decide caso por caso.
  (COALESCE(i.n_meta, 0) > 0 AND n.origen = 'promotor') AS comision_retenida
FROM negocios n
LEFT JOIN LATERAL (
  SELECT
    COUNT(*)                                                      AS n_conversiones,
    COUNT(*) FILTER (WHERE ci.fuente = 'meta')                    AS n_meta,
    MIN(ci.ocurrida_at)                                           AS primera_conversion,
    MAX(ci.ocurrida_at)                                           AS ultima_conversion,
    (
      SELECT ci2.payload->>'campaign_name'
      FROM contacto_interacciones ci2
      WHERE ci2.contacto_id = n.contacto_id
        AND ci2.fuente = 'meta'
        AND NULLIF(ci2.payload->>'campaign_name', '') IS NOT NULL
      ORDER BY ci2.ocurrida_at DESC
      LIMIT 1
    )                                                             AS campana
  FROM contacto_interacciones ci
  WHERE ci.contacto_id = n.contacto_id
) i ON true;

COMMENT ON VIEW v_negocio_atribucion IS
  'De donde vino cada negocio: el origen DECLARADO junto al RASTRO verificable de Meta '
  'y su campana. atribucion_en_conflicto marca cualquier desacuerdo (47 casos en SOENA); '
  'comision_retenida marca solo el que decide un pago a un tercero —promotor declarado '
  'con rastro de Meta— (14 casos). Se muestran, no se corrigen: elige una persona.';

REVOKE ALL ON v_negocio_atribucion FROM anon, authenticated;


-- ============================================================
-- 3. La vista de venta expone la tercera definicion
-- ============================================================
-- Recreada entera con `bonificable` al final (create or replace no reordena).

CREATE OR REPLACE VIEW v_venta_mes_comercial
WITH (security_invoker = on) AS
WITH cobros_neg AS (
  SELECT
    cv.negocio_id,
    cv.workspace_id,
    min(cv.fecha)                                        AS fecha_venta,
    sum(cv.a_tramo1 + cv.a_tramo2)                       AS honorario_recaudado,
    sum(cv.a_tramo1)                                     AS primer_pago,
    sum(cv.a_tramo2)                                     AS segundo_pago,
    sum(cv.a_tarifa)                                     AS tarifa,
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
  -- La tercera definicion, al lado de las otras dos y sin reemplazarlas.
  vb.bonificable                                         as bonificable
from negocios n
join cobros_neg cn      on cn.negocio_id = n.id and cn.fecha_venta is not null
join v_negocio_valor vv on vv.negocio_id = n.id
left join v_negocio_comercial vc on vc.negocio_id = n.id
left join v_negocio_bonificable vb on vb.negocio_id = n.id;

COMMENT ON VIEW v_venta_mes_comercial IS
  'Definicion unica de "venta" del tablero comercial: negocio con al menos un cobro con fecha. '
  'Trae las TRES medidas que el negocio distingue y que antes se confundian: la venta (existe la '
  'fila), caso_completo (el honorario recaudado cubre el aprobado) y bonificable (paso el umbral '
  'que declara la linea). La consumen get_comercial_kpis_mes_soena, get_comercial_ventas_mes_soena '
  'y get_comercial_origen_mes_soena. server-only.';

REVOKE ALL ON v_venta_mes_comercial FROM anon, authenticated;


-- ============================================================
-- 4. El panel del mes cuenta las tres, y dice cual mira
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_comercial_kpis_mes_soena(p_workspace_id uuid, p_anio integer, p_mes integer)
 returns jsonb
 language sql
 stable security definer
 set search_path to 'public'
as $function$
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
      -- Bonificables. `bonificable IS NULL` (linea sin umbral) NO suma ni resta:
      -- se cuenta aparte para que la pantalla pueda decir "de N ventas, M sin medir".
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
      -- ── Venta bonificable (#13) ──
      -- `bonificables` es NULL, no 0, cuando NINGUNA venta del mes se pudo medir:
      -- un cero ahi se leeria como "nadie bonifico", que es una afirmacion.
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

COMMENT ON FUNCTION public.get_comercial_kpis_mes_soena(uuid, integer, integer) IS
  'KPIs del mes del tablero comercial. Distingue las TRES medidas que el negocio no '
  'puede confundir: num_ventas (entro dinero), casos_completos (el honorario quedo '
  'cubierto) y bonificables (paso el umbral de la linea, punto #13). bonificables '
  'llega NULL cuando ninguna venta del mes se pudo medir: no es cero.';

revoke execute on function public.get_comercial_kpis_mes_soena(uuid, integer, integer) from public, anon;
grant  execute on function public.get_comercial_kpis_mes_soena(uuid, integer, integer) to authenticated;


-- ============================================================
-- 5. El ranking premia la venta completa, y deja de contar plata ajena
-- ============================================================
-- Dos cambios en la misma funcion:
--   (a) `num_bonificables` nuevo, la metrica que el ranking debe premiar (#31);
--   (b) `honorario_recaudado` deja de sumar `cobros.monto` crudo y se imputa con
--       `v_cobro_valor`, la misma fuente que el panel. La tarifa de la UPME sale a
--       su propia columna. Ver la medicion en la cabecera.

DROP FUNCTION IF EXISTS public.get_comercial_resumen_soena(uuid, integer, integer);

CREATE FUNCTION public.get_comercial_resumen_soena(
  p_workspace_id uuid,
  p_anio integer DEFAULT NULL,
  p_mes integer DEFAULT NULL
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  -- Recaudo del periodo YA IMPUTADO. `v_cobro_valor` separa lo que es honorario
  -- (tramo 1 + tramo 2) de lo que es tarifa de un tercero. Sumar `cobros.monto` a
  -- secas metia la tarifa dentro del honorario del comercial.
  cobros_neg AS (
    SELECT
      cv.negocio_id,
      MIN(cv.fecha)                                                    AS fecha_venta,
      SUM(cv.a_tramo1 + cv.a_tramo2) FILTER (
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
$$;

COMMENT ON FUNCTION public.get_comercial_resumen_soena(uuid, integer, integer) IS
  'Resumen comercial por persona. num_ventas cuenta la venta (#12, entro dinero) y '
  'num_bonificables la venta completa (#13, paso el umbral de la linea), que es la que '
  'el ranking premia. honorario_recaudado sale de v_cobro_valor YA IMPUTADO: la tarifa '
  'de la UPME es plata de un tercero y viaja en tarifa_recaudada, aparte.';

REVOKE EXECUTE ON FUNCTION public.get_comercial_resumen_soena(uuid, integer, integer) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.get_comercial_resumen_soena(uuid, integer, integer) TO authenticated;


-- ============================================================
-- 6. El drill dice si la venta bonifica y si la comision esta retenida
-- ============================================================

DROP FUNCTION IF EXISTS public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean, date, text);

CREATE FUNCTION public.get_comercial_ventas_mes_soena(
  p_workspace_id uuid,
  p_anio integer,
  p_mes integer,
  p_responsable_id uuid default null,
  p_solo_completos boolean default null,
  p_sin_responsable boolean default false,
  p_dia date default null,
  p_campana text default null,
  -- true = solo las bonificables; false = solo las que NO bonifican; null = todas.
  -- Las que no se pudieron medir (bonificable NULL) NO caen en ninguno de los dos
  -- filtros: no se sabe de que lado van.
  p_solo_bonificables boolean default null
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
    -- Se declaro promotor y el lead entro por Meta: no se liquida hasta decidir.
    'comision_retenida', COALESCE(v.comision_retenida, false),
    'valor_sin_iva',    v.honorario_sin_iva,
    'valor_con_iva',    v.honorario_con_iva,
    'recaudado',        v.honorario_recaudado,
    'primer_pago',      v.primer_pago,
    'segundo_pago',     v.segundo_pago,
    'caso_completo',    v.caso_completo,
    -- null = la linea no declaro umbral, no "no bonifica".
    'bonificable',      v.bonificable,
    'sin_honorario_aprobado', (v.honorario_con_iva = 0)
  ) ORDER BY v.fecha_venta DESC, v.codigo), '[]'::jsonb)
  FROM ventas v
  LEFT JOIN staff s ON s.id = v.responsable_id;
$function$;

COMMENT ON FUNCTION public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean, date, text, boolean) IS
  'Drill del tablero comercial. Consume las MISMAS vistas que la cifra en la que se hizo '
  'clic, e informa por separado las tres medidas (venta, caso completo, bonificable) mas '
  'el estado de la atribucion, incluida comision_retenida.';

revoke execute on function public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean, date, text, boolean) from public, anon;
grant  execute on function public.get_comercial_ventas_mes_soena(uuid, integer, integer, uuid, boolean, boolean, date, text, boolean) to authenticated;


-- ============================================================
-- 7. El desglose por origen cuenta la comision retenida aparte
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_comercial_origen_mes_soena(
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
    SELECT v.negocio_id, v.honorario_sin_iva, v.honorario_recaudado,
           COALESCE(a.tiene_rastro_meta, false) AS tiene_rastro_meta,
           a.campana,
           v.origen_declarado,
           COALESCE(a.atribucion_en_conflicto, false) AS en_conflicto,
           COALESCE(a.comision_retenida, false)       AS comision_retenida
    FROM v_venta_mes_comercial v
    JOIN guard g ON v.workspace_id = g.id
    LEFT JOIN v_negocio_atribucion a ON a.negocio_id = v.negocio_id
    WHERE EXTRACT(YEAR  FROM v.fecha_venta) = p_anio
      AND EXTRACT(MONTH FROM v.fecha_venta) = p_mes
  )
  SELECT jsonb_build_object(
    'total', (SELECT COUNT(*) FROM ventas),
    'con_rastro_meta',  (SELECT COUNT(*) FROM ventas WHERE tiene_rastro_meta),
    'sin_rastro',       (SELECT COUNT(*) FROM ventas WHERE NOT tiene_rastro_meta),
    'meta_sin_campana', (SELECT COUNT(*) FROM ventas WHERE tiene_rastro_meta AND campana IS NULL),
    'en_conflicto',     (SELECT COUNT(*) FROM ventas WHERE en_conflicto),
    -- El subconjunto que decide un pago a un tercero, con la plata que representa.
    'comision_retenida',            (SELECT COUNT(*) FROM ventas WHERE comision_retenida),
    'comision_retenida_valor',      (SELECT COALESCE(SUM(honorario_sin_iva),0) FROM ventas WHERE comision_retenida),
    'por_origen', COALESCE((
      SELECT jsonb_agg(x ORDER BY x->>'origen')
      FROM (
        SELECT jsonb_build_object(
          'origen',       origen_declarado,
          'ventas',       COUNT(*),
          'valor_sin_iva', COALESCE(SUM(honorario_sin_iva), 0),
          'recaudado',    COALESCE(SUM(honorario_recaudado), 0),
          'con_rastro_meta', COUNT(*) FILTER (WHERE tiene_rastro_meta),
          'comision_retenida', COUNT(*) FILTER (WHERE comision_retenida)
        ) AS x
        FROM ventas
        GROUP BY origen_declarado
      ) t
    ), '[]'::jsonb),
    'por_campana', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'ventas')::int DESC, x->>'campana')
      FROM (
        SELECT jsonb_build_object(
          'campana',      campana,
          'ventas',       COUNT(*),
          'valor_sin_iva', COALESCE(SUM(honorario_sin_iva), 0),
          'recaudado',    COALESCE(SUM(honorario_recaudado), 0)
        ) AS x
        FROM ventas
        WHERE tiene_rastro_meta
        GROUP BY campana
      ) t
    ), '[]'::jsonb)
  );
$function$;

COMMENT ON FUNCTION public.get_comercial_origen_mes_soena(uuid, integer, integer) IS
  'Desglose de las ventas del mes por origen declarado y por campana de Meta. Separa el '
  'conflicto de atribucion (interno) de la comision retenida (un tercero cobraria por un '
  'lead de Meta): son problemas de gravedad distinta y la pantalla no puede mezclarlos.';

revoke execute on function public.get_comercial_origen_mes_soena(uuid, integer, integer) from public, anon;
grant  execute on function public.get_comercial_origen_mes_soena(uuid, integer, integer) to authenticated;
