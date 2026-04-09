-- ============================================================
-- Stages activables por workspace + linea activa
-- ============================================================

-- 1. Campos nuevos en workspaces
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS stages_activos JSONB NOT NULL DEFAULT '["venta","ejecucion","cobro"]'::jsonb;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS linea_activa_id UUID REFERENCES lineas_negocio(id) ON DELETE SET NULL;

-- 2. Corregir nombres plantillas nativas a UNA PALABRA
-- Plantilla 1: "Soy profesional"
UPDATE etapas_negocio SET nombre = 'Contacto' WHERE nombre = 'Por contactar' AND linea_id IN (SELECT id FROM lineas_negocio WHERE tipo = 'plantilla');
UPDATE etapas_negocio SET nombre = 'Propuesta' WHERE nombre = 'Propuesta enviada' AND linea_id IN (SELECT id FROM lineas_negocio WHERE tipo = 'plantilla');
UPDATE etapas_negocio SET nombre = 'Desarrollo' WHERE nombre = 'En desarrollo' AND linea_id IN (SELECT id FROM lineas_negocio WHERE tipo = 'plantilla');
UPDATE etapas_negocio SET nombre = 'Revision' WHERE nombre = 'En revisión' AND linea_id IN (SELECT id FROM lineas_negocio WHERE tipo = 'plantilla');
UPDATE etapas_negocio SET nombre = 'Cobro' WHERE nombre = 'Por cobrar' AND linea_id IN (SELECT id FROM lineas_negocio WHERE tipo = 'plantilla');

-- Plantilla 2: "Ejecuto proyectos"
UPDATE etapas_negocio SET nombre = 'Planeacion' WHERE nombre = 'Planeación' AND linea_id IN (SELECT id FROM lineas_negocio WHERE tipo = 'plantilla');
UPDATE etapas_negocio SET nombre = 'Ejecucion' WHERE nombre = 'En ejecución' AND linea_id IN (SELECT id FROM lineas_negocio WHERE tipo = 'plantilla');
UPDATE etapas_negocio SET nombre = 'Supervision' WHERE nombre = 'Supervisión' AND linea_id IN (SELECT id FROM lineas_negocio WHERE tipo = 'plantilla');
UPDATE etapas_negocio SET nombre = 'Entrega' WHERE nombre = 'Entrega' AND linea_id IN (SELECT id FROM lineas_negocio WHERE tipo = 'plantilla');
-- "Contrato" already one word, keep it

-- Plantilla 3: "Atiendo clientes"
UPDATE etapas_negocio SET nombre = 'Solicitud' WHERE nombre = 'Solicitud recibida' AND linea_id IN (SELECT id FROM lineas_negocio WHERE tipo = 'plantilla');
UPDATE etapas_negocio SET nombre = 'Atencion' WHERE nombre = 'En atención' AND linea_id IN (SELECT id FROM lineas_negocio WHERE tipo = 'plantilla');
-- "Por cobrar" already handled above (becomes "Cobro")

-- 3. Fix apply_plantilla_to_workspace — el UNIQUE constraint ahora incluye 'orden'
--    (cambiado en migración 20260405000004_soena_ve_config.sql)
CREATE OR REPLACE FUNCTION apply_plantilla_to_workspace(
  p_workspace_id UUID,
  p_linea_id     UUID
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_etapa RECORD;
  v_bloque RECORD;
  v_orden INTEGER;
BEGIN
  FOR v_etapa IN
    SELECT id, stage FROM etapas_negocio WHERE linea_id = p_linea_id ORDER BY orden
  LOOP
    v_orden := 0;
    FOR v_bloque IN
      SELECT bd.id, bd.default_estado
      FROM bloque_definitions bd
      WHERE (
        (v_etapa.stage = 'venta'      AND bd.tipo IN ('equipo', 'cotizacion'))
        OR (v_etapa.stage = 'ejecucion' AND bd.tipo IN ('equipo', 'datos', 'checklist', 'cobros', 'resumen_financiero', 'ejecucion'))
        OR (v_etapa.stage = 'cobro'    AND bd.tipo IN ('cobros', 'resumen_financiero', 'ejecucion'))
      )
      ORDER BY bd.tipo
    LOOP
      INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate)
      VALUES (v_etapa.id, p_workspace_id, v_bloque.id, v_bloque.default_estado, v_orden, false)
      ON CONFLICT (etapa_id, workspace_id, bloque_definition_id, orden) DO NOTHING;
      v_orden := v_orden + 1;
    END LOOP;
  END LOOP;
END;
$$;
