-- Filtro por vendedor para la pestaña Comercial de SOENA.
--
-- La tabla "Por vendedor" pasa a ser el mando del tablero: al elegir una fila, todo
-- lo que va debajo (origen, seccional, plan de pago, ventas por día e histórico) se
-- recorta a ese comercial. Hasta hoy ninguna de esas RPC sabía filtrar por persona,
-- así que el recorte era imposible de hacer en el navegador: los datos llegan ya
-- agregados y no traen de quién es cada venta.
--
-- Solo toca FUNCIONES. Ninguna fila de negocio se lee ni se escribe distinto.
--
-- `p_sin_responsable` va aparte de `p_responsable_id` por la misma razón de siempre:
-- NULL en el id significa "sin filtro", así que hace falta una segunda señal para
-- pedir el bucket de los negocios que no tienen comercial atribuido. Son tres
-- estados —todos / esta persona / nadie— y con un solo parámetro solo caben dos.

-- ── 1. Origen del lead ──────────────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_comercial_origen_mes_soena(uuid, integer, integer);

CREATE FUNCTION public.get_comercial_origen_mes_soena(
  p_workspace_id uuid,
  p_anio integer,
  p_mes integer,
  p_responsable_id uuid DEFAULT NULL,
  p_sin_responsable boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      AND (p_responsable_id IS NULL OR v.responsable_id = p_responsable_id)
      AND (NOT p_sin_responsable OR v.responsable_id IS NULL)
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

-- ── 2. Corte por seccional DIAN ─────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_comercial_seccional_mes_soena(uuid, integer, integer);

CREATE FUNCTION public.get_comercial_seccional_mes_soena(
  p_workspace_id uuid,
  p_anio integer,
  p_mes integer,
  p_responsable_id uuid DEFAULT NULL,
  p_sin_responsable boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  ventas AS (
    SELECT
      v.negocio_id,
      -- CRUDA a proposito: quien consume canoniza con el catalogo de TS. NULL y cadena
      -- vacia son la misma cosa (no se registro) y colapsan aqui para no producir dos
      -- buckets que en pantalla dirian lo mismo.
      NULLIF(TRIM(n.metadata->>'seccional'), '') AS seccional_cruda,
      v.honorario_sin_iva, v.honorario_con_iva,
      v.primer_pago, v.segundo_pago, v.honorario_recaudado,
      v.caso_completo, v.bonificable
    FROM v_venta_mes_comercial v
    JOIN guard g ON v.workspace_id = g.id
    JOIN negocios n ON n.id = v.negocio_id
    WHERE EXTRACT(YEAR  FROM v.fecha_venta) = p_anio
      AND EXTRACT(MONTH FROM v.fecha_venta) = p_mes
      AND (p_responsable_id IS NULL OR v.responsable_id = p_responsable_id)
      AND (NOT p_sin_responsable OR v.responsable_id IS NULL)
  )
  SELECT jsonb_build_object(
    'total_ventas', (SELECT COUNT(*) FROM ventas),
    'filas', COALESCE((
      SELECT jsonb_agg(x ORDER BY (x->>'ventas')::int DESC, x->>'seccional_cruda' NULLS LAST)
      FROM (
        SELECT jsonb_build_object(
          'seccional_cruda',  seccional_cruda,
          'ventas',           COUNT(*),
          'valor_sin_iva',    COALESCE(SUM(honorario_sin_iva), 0),
          'valor_con_iva',    COALESCE(SUM(honorario_con_iva), 0),
          'primer_pago',      COALESCE(SUM(primer_pago), 0),
          'segundo_pago',     COALESCE(SUM(segundo_pago), 0),
          'recaudado',        COALESCE(SUM(honorario_recaudado), 0),
          'casos_completos',  COUNT(*) FILTER (WHERE caso_completo),
          'bonificables',     CASE WHEN COUNT(*) = COUNT(*) FILTER (WHERE bonificable IS NULL)
                                   THEN NULL ELSE COUNT(*) FILTER (WHERE bonificable) END,
          -- Los casos exactos detras de la fila: el drill abre este conjunto y no
          -- una consulta paralela que podria dar otro.
          'negocio_ids',      jsonb_agg(negocio_id)
        ) AS x
        FROM ventas
        GROUP BY seccional_cruda
      ) t
    ), '[]'::jsonb)
  );
$function$;

-- ── 3. Corte por plan de pago ───────────────────────────────────────────────

DROP FUNCTION IF EXISTS public.get_comercial_plan_pago_mes_soena(uuid, integer, integer);

CREATE FUNCTION public.get_comercial_plan_pago_mes_soena(
  p_workspace_id uuid,
  p_anio integer,
  p_mes integer,
  p_responsable_id uuid DEFAULT NULL,
  p_sin_responsable boolean DEFAULT false
)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      AND (p_responsable_id IS NULL OR v.responsable_id = p_responsable_id)
      AND (NOT p_sin_responsable OR v.responsable_id IS NULL)
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

-- ── 4. Ventas por día, abiertas por vendedor ────────────────────────────────
--
-- La firma NO cambia y `porVendedor` sigue siendo del mes entero: esta RPC es la que
-- alimenta la tabla que hace de mando, así que filtrarla por vendedor la dejaría sin
-- las demás filas y el filtro no se podría quitar ni cambiar. Lo que se agrega es un
-- desglose paralelo, `porDiaVendedor`, para que la gráfica diaria se recorte en el
-- navegador sin una segunda consulta.

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
  -- El mismo conteo diario, pero sin colapsar la persona. Suma exactamente lo mismo
  -- que `por_dia`, asi que la grafica filtrada nunca puede pasarse de la sin filtrar.
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

-- ── 5. El histórico mensual, abierto por vendedor ───────────────────────────
--
-- Gemela de `get_comercial_serie_seccional_soena` y construida sobre las MISMAS
-- CTE que `get_comercial_serie_mensual_soena`: misma definición de fecha de venta
-- (el primer cobro que no sea de pasante) y mismo origen del valor. Es la única
-- forma de que la suma de los vendedores dé exactamente la serie total; calcularla
-- sobre `v_venta_mes_comercial` —que toma el primer cobro SIN excluir al pasante—
-- produciría meses donde el corte no cuadra con la barra que dice recortar.
--
-- La atribución NO se reinventa: sale de `v_negocio_comercial.comercial_staff_id`,
-- que es la misma regla que usa la tabla del mes. `responsable_id` NULL es el bucket
-- de los negocios sin comercial atribuido, y va aparte y visible.

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
      SUM(cv.a_tramo1 + cv.a_tramo2) AS honorario_recaudado,
      SUM(cv.a_tramo1)               AS primer_pago,
      SUM(cv.a_tramo2)               AS segundo_pago,
      SUM(cv.a_tarifa)               AS tarifa,
      array_agg(cv.cobro_id)         AS cobro_ids
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

-- ── Permisos ────────────────────────────────────────────────────────────────
--
-- El DROP de las tres versiones de 3 argumentos se llevo por delante sus grants, y
-- toda funcion nace ejecutable por PUBLIC —de donde `anon` la alcanza—. Sin esto, un
-- cliente sin sesion podria invocar los cortes del mes; el `guard` de cada una lo
-- devolveria vacio, pero la superficie no tiene por que estar abierta para empezar.
-- `get_comercial_kpis_mes_soena` conserva los suyos porque no cambio de firma; se
-- reafirman igual, para que el permiso de las cinco se lea en un solo sitio.

revoke execute on function public.get_comercial_origen_mes_soena(uuid, integer, integer, uuid, boolean) from public, anon;
grant  execute on function public.get_comercial_origen_mes_soena(uuid, integer, integer, uuid, boolean) to authenticated;

revoke execute on function public.get_comercial_seccional_mes_soena(uuid, integer, integer, uuid, boolean) from public, anon;
grant  execute on function public.get_comercial_seccional_mes_soena(uuid, integer, integer, uuid, boolean) to authenticated;

revoke execute on function public.get_comercial_plan_pago_mes_soena(uuid, integer, integer, uuid, boolean) from public, anon;
grant  execute on function public.get_comercial_plan_pago_mes_soena(uuid, integer, integer, uuid, boolean) to authenticated;

revoke execute on function public.get_comercial_kpis_mes_soena(uuid, integer, integer) from public, anon;
grant  execute on function public.get_comercial_kpis_mes_soena(uuid, integer, integer) to authenticated;

revoke execute on function public.get_comercial_serie_vendedor_soena(uuid, integer) from public, anon;
grant  execute on function public.get_comercial_serie_vendedor_soena(uuid, integer) to authenticated;
