-- ============================================================
-- Mover checklist "Documentos de inclusión" de etapa 4 a etapa 3
-- con condición: solo visible/gate si verificacion_upme = 'no'
-- + Actualizar puede_avanzar_etapa para ignorar gates condicionales
-- ============================================================

DO $$
DECLARE
  v_linea_id   UUID;
  v_etapa3_id  UUID;
  v_etapa4_id  UUID;
  v_max_orden  INT;
  v_ws_id      UUID;
BEGIN
  -- Buscar línea VE
  SELECT id INTO v_linea_id
  FROM lineas_negocio
  WHERE tipo = 'clarity' AND nombre ILIKE '%VE%'
  LIMIT 1;

  IF v_linea_id IS NULL THEN
    RAISE NOTICE 'Línea VE no encontrada — skip';
    RETURN;
  END IF;

  SELECT id INTO v_etapa3_id FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 3;
  SELECT id INTO v_etapa4_id FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 4;

  -- Obtener workspace_id
  SELECT workspace_id INTO v_ws_id
  FROM bloque_configs WHERE etapa_id = v_etapa3_id LIMIT 1;

  -- Borrar el checklist de inclusión de etapa 4
  DELETE FROM bloque_configs
  WHERE etapa_id = v_etapa4_id
    AND workspace_id = v_ws_id
    AND nombre = 'Documentos de inclusión';

  -- Insertar en etapa 3 con condición
  SELECT COALESCE(MAX(orden), 0) INTO v_max_orden
  FROM bloque_configs
  WHERE etapa_id = v_etapa3_id AND workspace_id = v_ws_id;

  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra)
  VALUES (
    v_etapa3_id, v_ws_id,
    (SELECT id FROM bloque_definitions WHERE tipo = 'checklist' LIMIT 1),
    'Documentos de inclusión',
    'editable',
    v_max_orden + 1,
    true,
    jsonb_build_object(
      'items', jsonb_build_array(
        jsonb_build_object('label', 'Ficha técnica', 'slug', 'ficha_tecnica'),
        jsonb_build_object('label', 'Certificado de emisiones', 'slug', 'certificado_emisiones')
      ),
      'withSupport', true,
      'condition', jsonb_build_object('field', 'verificacion_upme', 'value', 'no')
    )
  );

  RAISE NOTICE 'Checklist de inclusión movido a etapa 3 con condición UPME=no';
END;
$$;

-- ── Actualizar RPC puede_avanzar_etapa para ignorar gates condicionales ──
CREATE OR REPLACE FUNCTION puede_avanzar_etapa(
  p_negocio_id UUID,
  p_etapa_id   UUID
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_gates_pendientes INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_gates_pendientes
  FROM bloque_configs bc
  JOIN negocio_bloques nb ON nb.bloque_config_id = bc.id
                         AND nb.negocio_id = p_negocio_id
  WHERE bc.etapa_id = p_etapa_id
    AND bc.es_gate = true
    AND nb.estado = 'pendiente'
    -- Ignorar gates con condición que no se cumple
    AND (
      bc.config_extra->'condition' IS NULL
      OR EXISTS (
        SELECT 1 FROM negocio_bloques nb2
        JOIN bloque_configs bc2 ON bc2.id = nb2.bloque_config_id
        WHERE nb2.negocio_id = p_negocio_id
          AND bc2.etapa_id = p_etapa_id
          AND nb2.data->>((bc.config_extra->'condition'->>'field'))
              = (bc.config_extra->'condition'->>'value')
      )
    );

  RETURN v_gates_pendientes = 0;
END;
$$;
