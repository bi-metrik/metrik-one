-- ============================================================
-- 20260720000001 — Tablero comercial sobre negocios + responsable_id
-- ------------------------------------------------------------
-- Seguimiento comercial por vendedor para workspaces cuyo pipeline vive en
-- `negocios` (NO en `ventas_hechos` — ese modelo es de manufactura/Siesa y no
-- aplica a Clarity/SOENA). Primer adopter: SOENA (linea VE).
--
-- Dos RPCs genericas, opt-in por `workspaces.modules.comercial_negocios`:
--   - get_comercial_resumen_soena(p_workspace_id)   -> una fila por responsable
--     (incluye bucket "(sin responsable)" para los negocios con responsable_id
--     NULL), con conteos por stage, valor aprobado y recaudo desglosado.
--   - get_comercial_perfil_soena(p_responsable_id)  -> detalle de un vendedor:
--     sus negocios + conversion por stage + recaudo desglosado.
--
-- METRICA DE RECAUDO (decision Mauricio 2026-07-20):
--   El headline por vendedor es el HONORARIO recaudado (ingreso real de SOENA),
--   NO el recaudo crudo. La TARIFA UPME (cobros tipo_cobro='pasante') es plata
--   de terceros: SOENA solo la recauda y la desembolsa a la UPME. Se reporta en
--   una linea SEPARADA y jamas se suma al desempeno comercial.
--
--   Reconciliacion con el EBITDA: se usa la MISMA regla que `v_pyl_mes`
--   (migracion 20260708000011) para contar ingreso:
--       honorario_recaudado = SUM(monto) WHERE fecha IS NOT NULL
--                                          AND tipo_cobro IS DISTINCT FROM 'pasante'
--       tarifa_recaudada    = SUM(monto) WHERE fecha IS NOT NULL
--                                          AND tipo_cobro = 'pasante'
--   `IS DISTINCT FROM` es null-safe (cobros legacy con tipo NULL cuentan como
--   honorario, igual que en el P&L). Asi el tablero NO diverge del EBITDA.
--
--   CAVEAT CONOCIDO (no es bug de estas RPCs): el "Grupo 3" de SOENA aun no esta
--   reclasificado a tipo_cobro='pasante', asi que HOY el honorario recaudado
--   arrastra algo de tarifa (no hay ningun cobro 'pasante' todavia -> la linea de
--   tarifa sale en 0). El numero se AUTO-CORRIGE cuando se aplique esa
--   reclasificacion pendiente; no hay que tocar estas RPCs.
--
-- BUCKET SIN RESPONSABLE: los negocios con responsable_id NULL (32 en SOENA al
-- 2026-07-20) NO se higienizan aqui. Aparecen agrupados bajo el bucket
-- "(sin responsable)" (id NULL) para que sigan visibles en el tablero.
--
-- Seguridad: SECURITY DEFINER + check de pertenencia — el llamante solo puede
-- consultar SU propio workspace (current_user_workspace_id() = p_workspace_id).
-- Se revoca anon.
--
-- Idempotente (DROP FUNCTION IF EXISTS + CREATE). Rollback: ver bloque al final.
-- ============================================================

-- ---------- RPC 1: resumen por responsable ----------
DROP FUNCTION IF EXISTS public.get_comercial_resumen_soena(uuid);

CREATE FUNCTION public.get_comercial_resumen_soena(p_workspace_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Barrera de pertenencia: solo el propio workspace del llamante.
  WITH guard AS (
    SELECT p_workspace_id AS id
    WHERE p_workspace_id = current_user_workspace_id()
  ),
  -- Recaudo por negocio, desglosado honorario vs tarifa (pasante), coherente
  -- con v_pyl_mes. Solo cobros pagados (fecha IS NOT NULL).
  recaudo AS (
    SELECT
      c.negocio_id,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') AS honorario,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro = 'pasante')                AS tarifa
    FROM cobros c, guard g
    WHERE c.workspace_id = g.id
      AND c.fecha IS NOT NULL
    GROUP BY c.negocio_id
  ),
  base AS (
    SELECT
      n.responsable_id,
      n.stage_actual,
      n.estado,
      COALESCE(n.precio_aprobado, 0)     AS precio_aprobado,
      COALESCE(r.honorario, 0)           AS honorario_recaudado,
      COALESCE(r.tarifa, 0)              AS tarifa_recaudada
    FROM negocios n
    CROSS JOIN guard g
    LEFT JOIN recaudo r ON r.negocio_id = n.id
    WHERE n.workspace_id = g.id
  ),
  por_resp AS (
    SELECT
      b.responsable_id,
      COUNT(*)                                                      AS negocios_total,
      COUNT(*) FILTER (WHERE b.estado = 'abierto')                 AS negocios_abiertos,
      COUNT(*) FILTER (WHERE b.stage_actual = 'venta')             AS en_venta,
      COUNT(*) FILTER (WHERE b.stage_actual = 'ejecucion')         AS en_ejecucion,
      COUNT(*) FILTER (WHERE b.stage_actual = 'cobro')             AS en_cobro,
      COUNT(*) FILTER (WHERE b.stage_actual = 'cerrado'
                          OR b.estado = 'completado')              AS cerrados,
      COALESCE(SUM(b.precio_aprobado), 0)                          AS valor_aprobado,
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
           'responsable_id',       pr.responsable_id,
           'nombre',               COALESCE(s.full_name, '(sin responsable)'),
           'position',             s.position,
           'sin_responsable',      pr.responsable_id IS NULL,
           'negocios_total',       pr.negocios_total,
           'negocios_abiertos',    pr.negocios_abiertos,
           'en_venta',             pr.en_venta,
           'en_ejecucion',         pr.en_ejecucion,
           'en_cobro',             pr.en_cobro,
           'cerrados',             pr.cerrados,
           'valor_aprobado',       pr.valor_aprobado,
           'honorario_recaudado',  pr.honorario_recaudado,
           'tarifa_recaudada',     pr.tarifa_recaudada
         ) AS x,
         pr.honorario_recaudado AS val,
         COALESCE(s.full_name, '(sin responsable)') AS nombre
       FROM por_resp pr
       LEFT JOIN staff s ON s.id = pr.responsable_id
     ) t),
    '[]'::jsonb
  );
$$;

-- Postgres otorga EXECUTE a PUBLIC por defecto (expone via anon). Revocar PUBLIC + anon
-- y dejar solo authenticated (la app la llama; el guard de pertenencia protege adentro).
REVOKE EXECUTE ON FUNCTION public.get_comercial_resumen_soena(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_comercial_resumen_soena(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_comercial_resumen_soena(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_comercial_resumen_soena(uuid) IS
  'Tablero comercial por responsable sobre negocios+responsable_id. Incluye bucket (sin responsable). honorario_recaudado = cobros pagados NO-pasante (mismo criterio que v_pyl_mes); tarifa_recaudada = cobros pasante (plata de terceros, aparte). SECURITY DEFINER con check de pertenencia.';


-- ---------- RPC 2: perfil de un responsable ----------
DROP FUNCTION IF EXISTS public.get_comercial_perfil_soena(uuid);

-- p_responsable_id NULL = bucket "(sin responsable)".
CREATE FUNCTION public.get_comercial_perfil_soena(p_responsable_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH ws AS (SELECT current_user_workspace_id() AS id),
  recaudo AS (
    SELECT
      c.negocio_id,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro IS DISTINCT FROM 'pasante') AS honorario,
      SUM(c.monto) FILTER (WHERE c.tipo_cobro = 'pasante')                AS tarifa
    FROM cobros c, ws
    WHERE c.workspace_id = ws.id
      AND c.fecha IS NOT NULL
    GROUP BY c.negocio_id
  ),
  base AS (
    SELECT
      n.id,
      n.codigo,
      n.nombre,
      n.stage_actual,
      n.estado,
      e.nombre                        AS etapa_nombre,
      e.numero                        AS etapa_numero,
      COALESCE(n.precio_aprobado, 0)  AS precio_aprobado,
      COALESCE(r.honorario, 0)        AS honorario_recaudado,
      COALESCE(r.tarifa, 0)           AS tarifa_recaudada
    FROM negocios n
    CROSS JOIN ws
    LEFT JOIN recaudo r        ON r.negocio_id = n.id
    LEFT JOIN etapas_negocio e ON e.id = n.etapa_actual_id
    WHERE n.workspace_id = ws.id
      AND n.responsable_id IS NOT DISTINCT FROM p_responsable_id
  )
  SELECT jsonb_build_object(
    'responsable_id', p_responsable_id,
    'nombre',         COALESCE((SELECT full_name FROM staff WHERE id = p_responsable_id), '(sin responsable)'),
    'position',       (SELECT position FROM staff WHERE id = p_responsable_id),
    'sin_responsable', p_responsable_id IS NULL,
    'kpis', (
      SELECT jsonb_build_object(
        'negocios_total',      COUNT(*),
        'negocios_abiertos',   COUNT(*) FILTER (WHERE estado = 'abierto'),
        'valor_aprobado',      COALESCE(SUM(precio_aprobado), 0),
        'honorario_recaudado', COALESCE(SUM(honorario_recaudado), 0),
        'tarifa_recaudada',    COALESCE(SUM(tarifa_recaudada), 0)
      ) FROM base
    ),
    'porStage', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'stage',   stage,
        'negocios', cnt,
        'valor_aprobado', val
      ) ORDER BY ord)
      FROM (
        SELECT
          COALESCE(stage_actual, '(sin stage)') AS stage,
          COUNT(*) AS cnt,
          COALESCE(SUM(precio_aprobado), 0) AS val,
          MIN(CASE stage_actual
                WHEN 'venta' THEN 1 WHEN 'ejecucion' THEN 2
                WHEN 'cobro' THEN 3 WHEN 'cerrado' THEN 4 ELSE 5 END) AS ord
        FROM base
        GROUP BY stage_actual
      ) s
    ), '[]'::jsonb),
    'negocios', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id',                  id,
        'codigo',              codigo,
        'nombre',              nombre,
        'stage',               stage_actual,
        'estado',              estado,
        'etapa_nombre',        etapa_nombre,
        'etapa_numero',        etapa_numero,
        'valor_aprobado',      precio_aprobado,
        'honorario_recaudado', honorario_recaudado,
        'tarifa_recaudada',    tarifa_recaudada
      ) ORDER BY precio_aprobado DESC, nombre)
      FROM base
    ), '[]'::jsonb)
  );
$$;

REVOKE EXECUTE ON FUNCTION public.get_comercial_perfil_soena(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_comercial_perfil_soena(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_comercial_perfil_soena(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_comercial_perfil_soena(uuid) IS
  'Perfil comercial de un responsable (NULL = bucket sin responsable) sobre negocios del workspace del llamante. Conversion por stage + recaudo honorario/tarifa desglosado. SECURITY DEFINER, scope al workspace del llamante.';

-- ============================================================
-- ROLLBACK (comentado):
--   DROP FUNCTION IF EXISTS public.get_comercial_resumen_soena(uuid);
--   DROP FUNCTION IF EXISTS public.get_comercial_perfil_soena(uuid);
-- ============================================================
