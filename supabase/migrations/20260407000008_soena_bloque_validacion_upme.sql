-- ============================================================
-- Agregar bloque de validación UPME en etapa 3 (Documentación)
-- Campo verificacion_upme (si/no) que activa routing condicional
-- ============================================================

DO $$
DECLARE
  v_linea_id   UUID;
  v_etapa3_id  UUID;
  v_ws_id      UUID;
  v_bd_datos   UUID;
  v_max_orden  INT;
  v_exists     BOOLEAN;
BEGIN
  SELECT id INTO v_linea_id
  FROM lineas_negocio
  WHERE tipo = 'clarity' AND nombre ILIKE '%VE%'
  LIMIT 1;

  IF v_linea_id IS NULL THEN
    RAISE NOTICE 'Línea VE no encontrada — skip';
    RETURN;
  END IF;

  SELECT id INTO v_etapa3_id
  FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 3;

  SELECT workspace_id INTO v_ws_id
  FROM bloque_configs WHERE etapa_id = v_etapa3_id LIMIT 1;

  SELECT id INTO v_bd_datos
  FROM bloque_definitions WHERE tipo = 'datos';

  -- Verificar si ya existe un bloque datos con campo verificacion_upme en etapa 3
  SELECT EXISTS(
    SELECT 1 FROM bloque_configs
    WHERE etapa_id = v_etapa3_id
      AND workspace_id = v_ws_id
      AND bloque_definition_id = v_bd_datos
      AND config_extra->'fields' @> '[{"slug":"verificacion_upme"}]'::jsonb
  ) INTO v_exists;

  IF v_exists THEN
    RAISE NOTICE 'Bloque validación UPME ya existe — skip';
    RETURN;
  END IF;

  -- Insertar después del checklist de Drive pero antes del checklist condicional
  SELECT COALESCE(MAX(orden), 0) INTO v_max_orden
  FROM bloque_configs
  WHERE etapa_id = v_etapa3_id AND workspace_id = v_ws_id;

  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra)
  VALUES (
    v_etapa3_id, v_ws_id, v_bd_datos,
    'Validación UPME',
    'editable',
    v_max_orden + 1,
    true,
    jsonb_build_object(
      'fields', jsonb_build_array(
        jsonb_build_object(
          'slug', 'verificacion_upme',
          'label', '¿Vehículo registrado en UPME?',
          'tipo', 'select',
          'required', true,
          'opciones', jsonb_build_array(
            jsonb_build_object('value', 'si', 'label', 'Sí, está registrado'),
            jsonb_build_object('value', 'no', 'label', 'No, necesita inclusión')
          )
        )
      )
    )
  );

  -- Asegurar que el checklist condicional de docs inclusión tenga orden mayor
  UPDATE bloque_configs
  SET orden = v_max_orden + 2
  WHERE etapa_id = v_etapa3_id
    AND workspace_id = v_ws_id
    AND nombre = 'Documentos de inclusión';

  RAISE NOTICE 'Bloque validación UPME creado en etapa 3';
END;
$$;
