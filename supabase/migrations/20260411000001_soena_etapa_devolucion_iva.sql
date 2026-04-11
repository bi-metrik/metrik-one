-- ============================================================
-- SOENA VE: Nueva etapa "Devolución" (IVA DIAN) + validador en etapa 2
-- - Inserta nueva etapa en stage 'ejecucion' con orden 7
-- - Desplaza "Cobro" de orden 7 a orden 8
-- - Agrega routing condicional en etapa 6 (Certificación)
--   con source_etapa_orden=2 para leer el flag desde la etapa 2
-- - Agrega bloque datos "Devolución de IVA" en etapa 2
--   con un toggle `requiere_devolucion_iva` (default TRUE, no es gate)
-- - El flag NO tiene nada que ver con verificacion_upme (son dos mundos)
-- ============================================================

DO $$
DECLARE
  v_workspace_id UUID := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  v_linea_id     UUID;
  v_etapa2       UUID;
  v_etapa6       UUID;
  v_etapa_cobro  UUID;
  v_etapa_devol  UUID;
  v_bd_datos     UUID;
  v_max_orden    INT;
  v_exists       BOOLEAN;
BEGIN
  -- Línea VE
  SELECT id INTO v_linea_id
  FROM lineas_negocio
  WHERE workspace_id = v_workspace_id AND tipo = 'clarity' AND nombre ILIKE '%VE%'
  LIMIT 1;

  IF v_linea_id IS NULL THEN
    RAISE NOTICE 'Línea VE no encontrada — skip';
    RETURN;
  END IF;

  SELECT id INTO v_bd_datos FROM bloque_definitions WHERE tipo = 'datos';

  -- Etapa 2 (Contactado) y 6 (Certificación)
  SELECT id INTO v_etapa2      FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 2;
  SELECT id INTO v_etapa6      FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 6;
  SELECT id INTO v_etapa_cobro FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 7;

  IF v_etapa2 IS NULL OR v_etapa6 IS NULL OR v_etapa_cobro IS NULL THEN
    RAISE NOTICE 'Etapas base no encontradas — skip';
    RETURN;
  END IF;

  -- ── 1. Desplazar "Cobro" de orden 7 a orden 8 ───────────────────────────
  UPDATE etapas_negocio SET orden = 8
  WHERE id = v_etapa_cobro AND orden = 7;

  -- ── 2. Insertar nueva etapa "Devolución" en orden 7 ─────────────────────
  -- Idempotencia: solo si no existe ya una etapa con nombre 'Devolución' en esta línea
  SELECT EXISTS(
    SELECT 1 FROM etapas_negocio
    WHERE linea_id = v_linea_id AND nombre = 'Devolución'
  ) INTO v_exists;

  IF v_exists THEN
    SELECT id INTO v_etapa_devol
    FROM etapas_negocio
    WHERE linea_id = v_linea_id AND nombre = 'Devolución';
    -- Asegurar orden correcto
    UPDATE etapas_negocio SET orden = 7, stage = 'ejecucion' WHERE id = v_etapa_devol;
  ELSE
    INSERT INTO etapas_negocio (linea_id, stage, nombre, orden)
    VALUES (v_linea_id, 'ejecucion', 'Devolución', 7)
    RETURNING id INTO v_etapa_devol;
  END IF;

  -- ── 3. Routing condicional en etapa 6 ───────────────────────────────────
  -- Default: avanzar a Devolución (7). Si requiere_devolucion_iva = 'false' → saltar a Cobro (8).
  -- source_etapa_orden=2 le dice al evaluador que lea el campo desde la etapa 2,
  -- no desde la etapa actual (que es 6 al momento del avance).
  UPDATE etapas_negocio
  SET config_extra = jsonb_set(
    COALESCE(config_extra, '{}'::jsonb),
    '{routing}',
    jsonb_build_object(
      'source_etapa_orden', 2,
      'default_etapa_orden', 7,
      'conditional', jsonb_build_array(
        jsonb_build_object(
          'condition', jsonb_build_object('field', 'requiere_devolucion_iva', 'value', 'false'),
          'etapa_orden', 8
        )
      )
    ),
    true
  )
  WHERE id = v_etapa6;

  -- ── 4. Bloque datos "Devolución de IVA" en etapa 2 ──────────────────────
  -- Toggle simple, no gate, default TRUE. Separado del bloque de anticipo
  -- para no mezclar el flujo de confirmación de pago con el flag fiscal.
  SELECT EXISTS(
    SELECT 1 FROM bloque_configs
    WHERE etapa_id = v_etapa2
      AND workspace_id = v_workspace_id
      AND bloque_definition_id = v_bd_datos
      AND config_extra->'fields' @> '[{"slug":"requiere_devolucion_iva"}]'::jsonb
  ) INTO v_exists;

  IF NOT v_exists THEN
    SELECT COALESCE(MAX(orden), 0) INTO v_max_orden
    FROM bloque_configs
    WHERE etapa_id = v_etapa2 AND workspace_id = v_workspace_id;

    INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra)
    VALUES (
      v_etapa2, v_workspace_id, v_bd_datos,
      'Devolución de IVA',
      'editable',
      v_max_orden + 1,
      false,
      jsonb_build_object(
        'fields', jsonb_build_array(
          jsonb_build_object(
            'slug', 'requiere_devolucion_iva',
            'label', '¿Requiere devolución de IVA ante la DIAN?',
            'tipo', 'toggle',
            'required', false,
            'default', true
          )
        )
      )
    );
  END IF;

  -- ── 5. Backfill: crear instancias negocio_bloques para negocios existentes ──
  -- Para que el campo aparezca en negocios abiertos. Default del toggle: true.
  INSERT INTO negocio_bloques (negocio_id, bloque_config_id, estado, data)
  SELECT n.id, bc.id, 'pendiente', jsonb_build_object('requiere_devolucion_iva', true)
  FROM negocios n
  CROSS JOIN bloque_configs bc
  WHERE n.workspace_id = v_workspace_id
    AND bc.etapa_id = v_etapa2
    AND bc.workspace_id = v_workspace_id
    AND bc.bloque_definition_id = v_bd_datos
    AND bc.config_extra->'fields' @> '[{"slug":"requiere_devolucion_iva"}]'::jsonb
  ON CONFLICT (negocio_id, bloque_config_id) DO NOTHING;

  RAISE NOTICE 'Etapa Devolución creada en orden 7, Cobro movido a 8, routing en etapa 6, validador en etapa 2';
END $$;
