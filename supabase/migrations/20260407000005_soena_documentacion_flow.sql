-- ============================================================
-- SOENA: Reconfigurar bloques etapa 3 (Documentación) y etapa 4 (Inclusión)
-- - Etapa 3: verificar documentos gate, agregar checklist "Documentos en Drive",
--            verificar bloque datos verificacion_upme es gate
-- - Etapa 4: agregar checklist "Documentos de inclusión"
-- ============================================================

DO $$
DECLARE
  v_workspace_id   UUID := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  v_linea_id       UUID;
  v_etapa3_id      UUID;
  v_etapa4_id      UUID;
  v_bd_checklist   UUID := '4bf806a2-ba90-4d1e-acf2-4022b35a921a';
  v_bd_documentos  UUID := '94596801-3b27-42bb-80e6-86f67b9a625b';
  v_bd_datos       UUID := 'eb7f4ab1-889b-43e9-ae11-3b18e6da2485';
  v_max_orden      INT;
BEGIN

  -- ── 1. Buscar línea VE ──────────────────────────────────────────────────────
  SELECT id INTO v_linea_id
  FROM lineas_negocio
  WHERE tipo = 'clarity' AND nombre ILIKE '%VE%'
  LIMIT 1;

  IF v_linea_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró línea VE';
  END IF;

  -- ── 2. Buscar etapas 3 y 4 ─────────────────────────────────────────────────
  SELECT id INTO v_etapa3_id
  FROM etapas_negocio
  WHERE linea_id = v_linea_id AND orden = 3;

  SELECT id INTO v_etapa4_id
  FROM etapas_negocio
  WHERE linea_id = v_linea_id AND orden = 4;

  IF v_etapa3_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró etapa 3 (Documentación)';
  END IF;

  IF v_etapa4_id IS NULL THEN
    RAISE EXCEPTION 'No se encontró etapa 4 (Inclusión)';
  END IF;

  -- ── 3. ETAPA 3: Verificar que bloque documentos sigue como gate ─────────────
  UPDATE bloque_configs
  SET es_gate = true
  WHERE etapa_id = v_etapa3_id
    AND workspace_id = v_workspace_id
    AND bloque_definition_id = v_bd_documentos
    AND es_gate = false;

  -- ── 4. ETAPA 3: Verificar que bloque datos (verificación UPME) es gate ──────
  UPDATE bloque_configs
  SET es_gate = true
  WHERE etapa_id = v_etapa3_id
    AND workspace_id = v_workspace_id
    AND bloque_definition_id = v_bd_datos
    AND es_gate = false;

  -- ── 5. ETAPA 3: Agregar checklist "Documentos en Drive" ─────────────────────
  -- Insertar después del último bloque existente en etapa 3
  SELECT COALESCE(MAX(orden), 0) INTO v_max_orden
  FROM bloque_configs
  WHERE etapa_id = v_etapa3_id AND workspace_id = v_workspace_id;

  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra)
  VALUES (
    v_etapa3_id, v_workspace_id, v_bd_checklist,
    'Documentos en Drive',
    'editable',
    v_max_orden + 1,
    true,
    jsonb_build_object(
      'items', jsonb_build_array(
        jsonb_build_object('label', 'Factura', 'slug', 'factura'),
        jsonb_build_object('label', 'Cédula', 'slug', 'cedula'),
        jsonb_build_object('label', 'RUT', 'slug', 'rut'),
        jsonb_build_object('label', 'Soporte de pago UPME', 'slug', 'soporte_upme')
      ),
      'withSupport', true
    )
  );

  -- ── 6. ETAPA 4: Agregar checklist "Documentos de inclusión" ─────────────────
  SELECT COALESCE(MAX(orden), 0) INTO v_max_orden
  FROM bloque_configs
  WHERE etapa_id = v_etapa4_id AND workspace_id = v_workspace_id;

  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra)
  VALUES (
    v_etapa4_id, v_workspace_id, v_bd_checklist,
    'Documentos de inclusión',
    'editable',
    v_max_orden + 1,
    true,
    jsonb_build_object(
      'items', jsonb_build_array(
        jsonb_build_object('label', 'Ficha técnica', 'slug', 'ficha_tecnica'),
        jsonb_build_object('label', 'Certificado de emisiones', 'slug', 'certificado_emisiones')
      ),
      'withSupport', true
    )
  );

END $$;
