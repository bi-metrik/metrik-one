-- ============================================================
-- 20260427100002 — Simplificacion capa fiscal
-- Decision producto 2026-04-23: ONE no es software contable. Perimetro hasta EBITDA.
-- Eliminar columnas y tabla del flujo de causacion formal.
-- Mantener: deducible (D142), soporte_url, tercero_nit, retencion (NUMERIC simple).
-- Spec: docs/specs/2026-04-26_mc-ebitda-capa-fiscal-simplificada.md §3
-- AUTORIZACION DROP causaciones_log: Mauricio 2026-04-27 (no recuperable, sin data critica)
-- ============================================================

-- ── Drop vistas dependientes ──────────────────────────────
-- v_proyecto_financiero y v_proyecto_rubros_comparativo filtran por gastos.estado_causacion.
-- Las recreamos al final de esta migracion sin ese filtro (todos los gastos son reales).
DROP VIEW IF EXISTS v_proyecto_financiero;
DROP VIEW IF EXISTS v_proyecto_rubros_comparativo;

-- ── Drop indices ──────────────────────────────────────────
DROP INDEX IF EXISTS idx_gastos_estado_causacion;
DROP INDEX IF EXISTS idx_cobros_estado_causacion;
DROP INDEX IF EXISTS idx_gastos_causacion_bandeja;
DROP INDEX IF EXISTS idx_cobros_causacion_bandeja;
DROP INDEX IF EXISTS idx_causaciones_log_workspace;
DROP INDEX IF EXISTS idx_causaciones_log_registro;

-- ── DROP TABLE causaciones_log ────────────────────────────
-- Auditoria flujo causacion formal. Sin retencion (decision Mauricio 2026-04-27).
DROP TABLE IF EXISTS causaciones_log CASCADE;

-- ── gastos: drop columnas fiscales formales ───────────────
ALTER TABLE gastos
  DROP COLUMN IF EXISTS estado_causacion,
  DROP COLUMN IF EXISTS aprobado_por,
  DROP COLUMN IF EXISTS fecha_aprobacion,
  DROP COLUMN IF EXISTS causado_por,
  DROP COLUMN IF EXISTS fecha_causacion,
  DROP COLUMN IF EXISTS cuenta_contable,
  DROP COLUMN IF EXISTS centro_costo,
  DROP COLUMN IF EXISTS notas_causacion,
  DROP COLUMN IF EXISTS retencion_aplicada,
  DROP COLUMN IF EXISTS rechazo_motivo,
  DROP COLUMN IF EXISTS enviado_alegra,
  DROP COLUMN IF EXISTS alegra_id,
  DROP COLUMN IF EXISTS fecha_envio_alegra,
  DROP COLUMN IF EXISTS retenciones,
  DROP COLUMN IF EXISTS tercero_razon_social;

-- ── cobros: drop columnas fiscales formales ───────────────
ALTER TABLE cobros
  DROP COLUMN IF EXISTS estado_causacion,
  DROP COLUMN IF EXISTS aprobado_por,
  DROP COLUMN IF EXISTS fecha_aprobacion,
  DROP COLUMN IF EXISTS causado_por,
  DROP COLUMN IF EXISTS fecha_causacion,
  DROP COLUMN IF EXISTS cuenta_contable,
  DROP COLUMN IF EXISTS centro_costo,
  DROP COLUMN IF EXISTS notas_causacion,
  DROP COLUMN IF EXISTS retencion_aplicada,
  DROP COLUMN IF EXISTS rechazo_motivo,
  DROP COLUMN IF EXISTS enviado_alegra,
  DROP COLUMN IF EXISTS alegra_id,
  DROP COLUMN IF EXISTS fecha_envio_alegra,
  DROP COLUMN IF EXISTS retenciones,
  DROP COLUMN IF EXISTS tercero_razon_social;

-- ── Agregar campo retencion simple (patron DIMPRO) ────────
-- Reemplaza retenciones JSONB + retencion_aplicada por un solo numerico
ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS retencion NUMERIC(15,2) DEFAULT 0;

ALTER TABLE cobros
  ADD COLUMN IF NOT EXISTS retencion NUMERIC(15,2) DEFAULT 0;

COMMENT ON COLUMN gastos.retencion IS
  'Retencion total aplicada al gasto (suma plana). Patron DIMPRO. ONE no calcula retenciones — el contador del cliente las registra si las necesita para reportes.';
COMMENT ON COLUMN cobros.retencion IS
  'Retencion total aplicada al cobro (suma plana). Patron DIMPRO. ONE no calcula retenciones — el contador del cliente las registra si las necesita para reportes.';

-- ============================================================
-- Recrear vistas legacy sin filtro estado_causacion
-- En el nuevo modelo todos los gastos son reales (no hay RECHAZADO).
-- ============================================================

-- ── v_proyecto_financiero ─────────────────────────────────
CREATE VIEW v_proyecto_financiero AS
SELECT p.id AS proyecto_id,
    p.workspace_id,
    p.codigo,
    p.nombre,
    p.estado,
    p.tipo,
    p.presupuesto_total,
    p.horas_estimadas,
    p.avance_porcentaje,
    p.ganancia_estimada,
    p.retenciones_estimadas,
    p.carpeta_url,
    p.fecha_inicio,
    p.fecha_fin_estimada,
    p.fecha_entrega_estimada,
    p.fecha_cierre,
    p.oportunidad_id,
    p.cotizacion_id,
    p.canal_creacion,
    p.created_at,
    p.updated_at,
    p.estado_changed_at,
    e.id AS empresa_id,
    e.nombre AS empresa_nombre,
    ct.id AS contacto_id,
    ct.nombre AS contacto_nombre,
    o.codigo AS oportunidad_codigo,
    rs.full_name AS responsable_nombre,
    GREATEST(p.updated_at, COALESCE(al.ultima_ts, p.updated_at)) AS ultima_actividad,
    COALESCE(h.total_horas, (0)::numeric) AS horas_reales,
    COALESCE(h.costo_horas, (0)::numeric) AS costo_horas,
    COALESCE(g.total_gastos, (0)::numeric) AS gastos_directos,
    (COALESCE(h.costo_horas, (0)::numeric) + COALESCE(g.total_gastos, (0)::numeric)) AS costo_acumulado,
        CASE
            WHEN (p.presupuesto_total > (0)::numeric) THEN round((((COALESCE(h.costo_horas, (0)::numeric) + COALESCE(g.total_gastos, (0)::numeric)) / p.presupuesto_total) * (100)::numeric), 1)
            ELSE (0)::numeric
        END AS presupuesto_consumido_pct,
    COALESCE(f.total_facturado, (0)::numeric) AS facturado,
    (COALESCE(f.num_facturas, (0)::bigint))::integer AS num_facturas,
    COALESCE(c.total_cobrado, (0)::numeric) AS cobrado,
    (COALESCE(c.num_cobros, (0)::bigint))::integer AS num_cobros,
    (COALESCE(c.total_cobrado, (0)::numeric) - (COALESCE(h.costo_horas, (0)::numeric) + COALESCE(g.total_gastos, (0)::numeric))) AS ganancia_actual,
        CASE
            WHEN (p.estado = ANY (ARRAY['cerrado'::text, 'entregado'::text])) THEN
            CASE
                WHEN (p.estado = 'cerrado'::text) THEN 100.0
                ELSE LEAST(100.0, GREATEST(0.0,
                CASE
                    WHEN ((p.horas_estimadas > (0)::numeric) AND (p.presupuesto_total > (0)::numeric) AND (f.total_facturado > (0)::numeric)) THEN round((((LEAST((COALESCE(h.total_horas, (0)::numeric) / p.horas_estimadas), 1.0) * 40.0) + ((LEAST((COALESCE(h.costo_horas, (0)::numeric) + COALESCE(g.total_gastos, (0)::numeric)), p.presupuesto_total) / p.presupuesto_total) * 30.0)) + ((LEAST(COALESCE(c.total_cobrado, (0)::numeric), f.total_facturado) / f.total_facturado) * 30.0)), 1)
                    WHEN ((p.horas_estimadas IS NULL) OR (p.horas_estimadas = (0)::numeric)) THEN
                    CASE
                        WHEN ((p.presupuesto_total > (0)::numeric) AND (f.total_facturado > (0)::numeric)) THEN round((((LEAST((COALESCE(h.costo_horas, (0)::numeric) + COALESCE(g.total_gastos, (0)::numeric)), p.presupuesto_total) / p.presupuesto_total) * 50.0) + ((LEAST(COALESCE(c.total_cobrado, (0)::numeric), f.total_facturado) / f.total_facturado) * 50.0)), 1)
                        WHEN (p.presupuesto_total > (0)::numeric) THEN round((LEAST(((COALESCE(h.costo_horas, (0)::numeric) + COALESCE(g.total_gastos, (0)::numeric)) / p.presupuesto_total), 1.0) * 100.0), 1)
                        ELSE 0.0
                    END
                    WHEN ((f.total_facturado IS NULL) OR (f.total_facturado = (0)::numeric)) THEN
                    CASE
                        WHEN ((p.horas_estimadas > (0)::numeric) AND (p.presupuesto_total > (0)::numeric)) THEN round(((LEAST((COALESCE(h.total_horas, (0)::numeric) / p.horas_estimadas), 1.0) * 57.14) + ((LEAST((COALESCE(h.costo_horas, (0)::numeric) + COALESCE(g.total_gastos, (0)::numeric)), p.presupuesto_total) / p.presupuesto_total) * 42.86)), 1)
                        WHEN (p.horas_estimadas > (0)::numeric) THEN round((LEAST((COALESCE(h.total_horas, (0)::numeric) / p.horas_estimadas), 1.0) * 100.0), 1)
                        ELSE 0.0
                    END
                    WHEN ((p.presupuesto_total IS NULL) OR (p.presupuesto_total = (0)::numeric)) THEN
                    CASE
                        WHEN ((p.horas_estimadas > (0)::numeric) AND (f.total_facturado > (0)::numeric)) THEN round(((LEAST((COALESCE(h.total_horas, (0)::numeric) / p.horas_estimadas), 1.0) * 57.14) + ((LEAST(COALESCE(c.total_cobrado, (0)::numeric), f.total_facturado) / f.total_facturado) * 42.86)), 1)
                        WHEN (p.horas_estimadas > (0)::numeric) THEN round((LEAST((COALESCE(h.total_horas, (0)::numeric) / p.horas_estimadas), 1.0) * 100.0), 1)
                        ELSE 0.0
                    END
                    ELSE 0.0
                END))
            END
            ELSE LEAST(100.0, GREATEST(0.0,
            CASE
                WHEN ((p.horas_estimadas > (0)::numeric) AND (p.presupuesto_total > (0)::numeric) AND (COALESCE(f.total_facturado, (0)::numeric) > (0)::numeric)) THEN round((((LEAST((COALESCE(h.total_horas, (0)::numeric) / p.horas_estimadas), 1.0) * 40.0) + ((LEAST((COALESCE(h.costo_horas, (0)::numeric) + COALESCE(g.total_gastos, (0)::numeric)), p.presupuesto_total) / p.presupuesto_total) * 30.0)) + ((LEAST(COALESCE(c.total_cobrado, (0)::numeric), COALESCE(f.total_facturado, (0)::numeric)) / COALESCE(f.total_facturado, (1)::numeric)) * 30.0)), 1)
                WHEN (((p.horas_estimadas IS NULL) OR (p.horas_estimadas = (0)::numeric)) AND (p.presupuesto_total > (0)::numeric) AND (COALESCE(f.total_facturado, (0)::numeric) > (0)::numeric)) THEN round((((LEAST((COALESCE(h.costo_horas, (0)::numeric) + COALESCE(g.total_gastos, (0)::numeric)), p.presupuesto_total) / p.presupuesto_total) * 50.0) + ((LEAST(COALESCE(c.total_cobrado, (0)::numeric), COALESCE(f.total_facturado, (0)::numeric)) / COALESCE(f.total_facturado, (1)::numeric)) * 50.0)), 1)
                WHEN (((p.horas_estimadas IS NULL) OR (p.horas_estimadas = (0)::numeric)) AND (p.presupuesto_total > (0)::numeric)) THEN round((LEAST(((COALESCE(h.costo_horas, (0)::numeric) + COALESCE(g.total_gastos, (0)::numeric)) / p.presupuesto_total), 1.0) * 100.0), 1)
                WHEN ((p.horas_estimadas > (0)::numeric) AND (p.presupuesto_total > (0)::numeric)) THEN round(((LEAST((COALESCE(h.total_horas, (0)::numeric) / p.horas_estimadas), 1.0) * 57.14) + ((LEAST((COALESCE(h.costo_horas, (0)::numeric) + COALESCE(g.total_gastos, (0)::numeric)), p.presupuesto_total) / p.presupuesto_total) * 42.86)), 1)
                WHEN (p.horas_estimadas > (0)::numeric) THEN round((LEAST((COALESCE(h.total_horas, (0)::numeric) / p.horas_estimadas), 1.0) * 100.0), 1)
                ELSE 0.0
            END))
        END AS avance_calculado
   FROM (((((((((proyectos p
     LEFT JOIN empresas e ON ((e.id = p.empresa_id)))
     LEFT JOIN contactos ct ON ((ct.id = p.contacto_id)))
     LEFT JOIN oportunidades o ON ((o.id = p.oportunidad_id)))
     LEFT JOIN staff rs ON ((rs.id = p.responsable_id)))
     LEFT JOIN LATERAL ( SELECT max(activity_log.created_at) AS ultima_ts
           FROM activity_log
          WHERE (activity_log.entidad_id = p.id)) al ON (true))
     LEFT JOIN LATERAL ( SELECT sum(hr.horas) AS total_horas,
            sum((hr.horas * COALESCE((s.salary / NULLIF(s.horas_disponibles_mes, (0)::numeric)), (0)::numeric))) AS costo_horas
           FROM (horas hr
             LEFT JOIN staff s ON ((s.id = hr.staff_id)))
          WHERE (hr.proyecto_id = p.id)) h ON (true))
     LEFT JOIN LATERAL ( SELECT sum(gs.monto) AS total_gastos
           FROM gastos gs
          WHERE (gs.proyecto_id = p.id)) g ON (true))
     LEFT JOIN LATERAL ( SELECT sum(fa.monto) AS total_facturado,
            count(*) AS num_facturas
           FROM facturas fa
          WHERE (fa.proyecto_id = p.id)) f ON (true))
     LEFT JOIN LATERAL ( SELECT sum(cb.monto) AS total_cobrado,
            count(*) AS num_cobros
           FROM cobros cb
          WHERE (cb.proyecto_id = p.id)) c ON (true));

-- ── v_proyecto_rubros_comparativo ─────────────────────────
CREATE VIEW v_proyecto_rubros_comparativo AS
SELECT pr.id AS rubro_id,
    pr.proyecto_id,
    pr.nombre AS rubro_nombre,
    pr.tipo AS rubro_tipo,
    pr.cantidad,
    pr.unidad,
    pr.valor_unitario,
    pr.presupuestado,
        CASE
            WHEN (pr.tipo = ANY (ARRAY['mo_propia'::text, 'mo_terceros'::text])) THEN COALESCE(hc.costo_horas, (0)::numeric)
            ELSE COALESCE(g.total_gastos, (0)::numeric)
        END AS gastado_real,
    (pr.presupuestado -
        CASE
            WHEN (pr.tipo = ANY (ARRAY['mo_propia'::text, 'mo_terceros'::text])) THEN COALESCE(hc.costo_horas, (0)::numeric)
            ELSE COALESCE(g.total_gastos, (0)::numeric)
        END) AS diferencia,
        CASE
            WHEN (pr.presupuestado > (0)::numeric) THEN round(((
            CASE
                WHEN (pr.tipo = ANY (ARRAY['mo_propia'::text, 'mo_terceros'::text])) THEN COALESCE(hc.costo_horas, (0)::numeric)
                ELSE COALESCE(g.total_gastos, (0)::numeric)
            END / pr.presupuestado) * (100)::numeric), 1)
            ELSE (0)::numeric
        END AS consumido_pct
   FROM ((proyecto_rubros pr
     LEFT JOIN LATERAL ( SELECT sum(gs.monto) AS total_gastos
           FROM gastos gs
          WHERE (gs.rubro_id = pr.id)) g ON (true))
     LEFT JOIN LATERAL ( SELECT sum((h.horas * COALESCE((s.salary / NULLIF(s.horas_disponibles_mes, (0)::numeric)), (0)::numeric))) AS costo_horas
           FROM (horas h
             LEFT JOIN staff s ON ((s.id = h.staff_id)))
          WHERE ((h.proyecto_id = pr.proyecto_id) AND (h.estado_aprobacion = 'APROBADO'::text))) hc ON (true))
  GROUP BY pr.id, pr.proyecto_id, pr.nombre, pr.tipo, pr.cantidad, pr.unidad, pr.valor_unitario, pr.presupuestado, g.total_gastos, hc.costo_horas;

COMMENT ON VIEW v_proyecto_financiero IS
  'Resumen financiero por proyecto (modulo legacy). Recreada 2026-04-27 sin filtro gastos.estado_causacion (eliminado).';
COMMENT ON VIEW v_proyecto_rubros_comparativo IS
  'Comparativo presupuesto vs real por rubro de proyecto (legacy). Recreada 2026-04-27 sin filtro gastos.estado_causacion (eliminado).';
