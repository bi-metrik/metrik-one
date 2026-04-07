-- ============================================================
-- 1. Agregar bloques visibles de documentos en etapas 4 (Inclusión) y 5 (Radicación)
--    para que operaciones pueda ver los docs subidos y links Drive de etapa 3
-- 2. Limpiar negocio_bloques con herencia incorrecta: bloques editables
--    que heredaron estado/data de bloques del mismo tipo pero distinto propósito
-- ============================================================

DO $$
DECLARE
  v_ws_id          UUID := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  v_etapa4_id      UUID;
  v_etapa5_id      UUID;
  v_bd_documentos  UUID := '94596801-3b27-42bb-80e6-86f67b9a625b'; -- tipo documentos
  v_bd_checklist   UUID := '4bf806a2-ba90-4d1e-acf2-4022b35a921a'; -- tipo checklist
  v_max_orden      INT;
  v_count          INT;
BEGIN

  SELECT id INTO v_etapa4_id FROM etapas_negocio
  WHERE linea_id = '34a0fa6b-9ed3-4652-a419-42601132d1a8' AND orden = 4;

  SELECT id INTO v_etapa5_id FROM etapas_negocio
  WHERE linea_id = '34a0fa6b-9ed3-4652-a419-42601132d1a8' AND orden = 5;

  -- ── 1A. Etapa 4: Documentos de radicación (visible) ───────────────────────
  SELECT COALESCE(MAX(orden), -1) + 1 INTO v_max_orden
  FROM bloque_configs WHERE etapa_id = v_etapa4_id AND workspace_id = v_ws_id;

  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra)
  VALUES (
    v_etapa4_id, v_ws_id, v_bd_documentos,
    'Documentos de radicación',
    'visible', v_max_orden, false,
    jsonb_build_object('documentos', jsonb_build_array(
      jsonb_build_object('slug', 'factura',      'label', 'Factura',               'required', true),
      jsonb_build_object('slug', 'rut',          'label', 'RUT',                   'required', true),
      jsonb_build_object('slug', 'cedula',       'label', 'Cédula',                'required', true),
      jsonb_build_object('slug', 'soporte_upme', 'label', 'Comprobante pago UPME', 'required', true)
    ))
  )
  ON CONFLICT DO NOTHING;

  -- ── 1B. Etapa 4: Documentos en Drive (visible) ───────────────────────────
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra)
  VALUES (
    v_etapa4_id, v_ws_id, v_bd_checklist,
    'Documentos en Drive',
    'visible', v_max_orden + 1, false,
    jsonb_build_object(
      'items', jsonb_build_array(
        jsonb_build_object('label', 'Factura',             'slug', 'factura'),
        jsonb_build_object('label', 'Cédula',              'slug', 'cedula'),
        jsonb_build_object('label', 'RUT',                 'slug', 'rut'),
        jsonb_build_object('label', 'Soporte de pago UPME','slug', 'soporte_upme')
      ),
      'withSupport', true
    )
  )
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Etapa 4: bloques visibles de docs agregados';

  -- ── 2A. Etapa 5: Documentos de radicación (visible) ───────────────────────
  SELECT COALESCE(MAX(orden), -1) + 1 INTO v_max_orden
  FROM bloque_configs WHERE etapa_id = v_etapa5_id AND workspace_id = v_ws_id;

  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra)
  VALUES (
    v_etapa5_id, v_ws_id, v_bd_documentos,
    'Documentos de radicación',
    'visible', v_max_orden, false,
    jsonb_build_object('documentos', jsonb_build_array(
      jsonb_build_object('slug', 'factura',      'label', 'Factura',               'required', true),
      jsonb_build_object('slug', 'rut',          'label', 'RUT',                   'required', true),
      jsonb_build_object('slug', 'cedula',       'label', 'Cédula',                'required', true),
      jsonb_build_object('slug', 'soporte_upme', 'label', 'Comprobante pago UPME', 'required', true)
    ))
  )
  ON CONFLICT DO NOTHING;

  -- ── 2B. Etapa 5: Documentos en Drive (visible) ───────────────────────────
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra)
  VALUES (
    v_etapa5_id, v_ws_id, v_bd_checklist,
    'Documentos en Drive',
    'visible', v_max_orden + 1, false,
    jsonb_build_object(
      'items', jsonb_build_array(
        jsonb_build_object('label', 'Factura',             'slug', 'factura'),
        jsonb_build_object('label', 'Cédula',              'slug', 'cedula'),
        jsonb_build_object('label', 'RUT',                 'slug', 'rut'),
        jsonb_build_object('label', 'Soporte de pago UPME','slug', 'soporte_upme')
      ),
      'withSupport', true
    )
  )
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Etapa 5: bloques visibles de docs agregados';

  -- ── 3. Limpiar herencia incorrecta en negocio_bloques EDITABLES ───────────
  -- Bloques editables no deben heredar estado/data de etapas anteriores
  -- Solo resetear los que tengan data que claramente viene de otro bloque
  -- (ej: datos de anticipo en un bloque de radicado/certificación/validación)

  -- Reset: Radicado de certificación (editable, tiene valor_anticipo heredado)
  UPDATE negocio_bloques nb
  SET estado = 'pendiente', data = '{}'::jsonb, completado_at = NULL
  WHERE nb.bloque_config_id IN (
    SELECT bc.id FROM bloque_configs bc
    WHERE bc.estado = 'editable'
      AND bc.nombre IN ('Radicado de certificación', 'Radicado de inclusión')
      AND bc.workspace_id = v_ws_id
  )
  AND nb.estado = 'completo'
  AND nb.data ? 'valor_anticipo';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Radicados con herencia incorrecta reseteados: %', v_count;

  -- Reset: Validación UPME (editable, tiene valor_anticipo en vez de verificacion_upme)
  UPDATE negocio_bloques nb
  SET estado = 'pendiente', data = '{}'::jsonb, completado_at = NULL
  WHERE nb.bloque_config_id IN (
    SELECT bc.id FROM bloque_configs bc
    WHERE bc.estado = 'editable'
      AND bc.nombre = 'Validación UPME'
      AND bc.workspace_id = v_ws_id
  )
  AND nb.estado = 'completo'
  AND nb.data ? 'valor_anticipo'
  AND NOT nb.data ? 'verificacion_upme';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Validación UPME con herencia incorrecta reseteados: %', v_count;

  -- Reset: Responsable Ejecución (editable gate, heredó equipo comercial)
  -- Solo en etapas donde es editable (etapa 4 Inclusión)
  UPDATE negocio_bloques nb
  SET estado = 'pendiente', data = '{}'::jsonb, completado_at = NULL
  WHERE nb.bloque_config_id IN (
    SELECT bc.id FROM bloque_configs bc
    WHERE bc.estado = 'editable'
      AND bc.nombre = 'Responsable Ejecución'
      AND bc.workspace_id = v_ws_id
  )
  AND nb.estado = 'completo';

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Responsable Ejecución editables reseteados: %', v_count;

END $$;
