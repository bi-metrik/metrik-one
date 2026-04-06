-- ============================================================
-- SOENA: Responsables separados como gates por stage
--
-- Reemplaza el bloque "Equipo" genérico por 3 bloques individuales:
-- - Resp. Comercial: gate en etapa 1 (venta)
-- - Resp. Ejecución: gate en primera etapa de ejecución
-- - Resp. Financiero: gate en primera etapa de cobro
--
-- Usa el mismo tipo 'equipo' con config_extra.rol para indicar
-- qué responsable maneja cada bloque.
-- ============================================================

-- ── Variables para referenciar ──────────────────────────────────────────────

DO $$
DECLARE
  v_linea_id       UUID;
  v_equipo_def_id  UUID;
  v_ws_id          UUID;
  v_etapa          RECORD;
  v_stage_first    RECORD;
BEGIN
  -- Encontrar la línea VE de SOENA (tipo clarity)
  SELECT ln.id, bc_any.workspace_id
  INTO v_linea_id, v_ws_id
  FROM lineas_negocio ln
  JOIN etapas_negocio en ON en.linea_id = ln.id
  JOIN bloque_configs bc_any ON bc_any.etapa_id = en.id
  WHERE ln.tipo = 'clarity'
    AND ln.nombre ILIKE '%VE%'
  LIMIT 1;

  IF v_linea_id IS NULL THEN
    RAISE NOTICE 'Línea VE no encontrada — skip';
    RETURN;
  END IF;

  -- Obtener el bloque_definition_id de 'equipo'
  SELECT id INTO v_equipo_def_id FROM bloque_definitions WHERE tipo = 'equipo';

  IF v_equipo_def_id IS NULL THEN
    RAISE NOTICE 'bloque_definition equipo no encontrada — skip';
    RETURN;
  END IF;

  -- ── 1. Eliminar bloques de equipo genéricos existentes en TODAS las etapas SOENA ──
  DELETE FROM bloque_configs
  WHERE bloque_definition_id = v_equipo_def_id
    AND workspace_id = v_ws_id
    AND etapa_id IN (SELECT id FROM etapas_negocio WHERE linea_id = v_linea_id)
    AND (config_extra IS NULL OR config_extra->>'rol' IS NULL);

  -- ── 2. Para CADA etapa, insertar los bloques de responsable que correspondan ──

  FOR v_etapa IN
    SELECT id, orden, stage, nombre
    FROM etapas_negocio
    WHERE linea_id = v_linea_id
    ORDER BY orden ASC
  LOOP
    -- Resp. Comercial: en TODAS las etapas
    -- Gate + editable solo en etapa 1, visible en el resto
    INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, config_extra)
    VALUES (
      v_etapa.id, v_ws_id, v_equipo_def_id,
      CASE WHEN v_etapa.orden = 1 THEN 'editable' ELSE 'visible' END,
      0,  -- orden 0 = primero
      v_etapa.orden = 1,  -- gate solo en etapa 1
      'Responsable Comercial',
      '{"rol": "comercial"}'::JSONB
    );

    -- Resp. Ejecución: desde la primera etapa de ejecución en adelante
    IF v_etapa.stage IN ('ejecucion', 'cobro') THEN
      -- Determinar si es la primera etapa de ejecución
      SELECT id INTO v_stage_first
      FROM etapas_negocio
      WHERE linea_id = v_linea_id AND stage = 'ejecucion'
      ORDER BY orden ASC
      LIMIT 1;

      INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, config_extra)
      VALUES (
        v_etapa.id, v_ws_id, v_equipo_def_id,
        CASE WHEN v_etapa.id = v_stage_first.id THEN 'editable' ELSE 'visible' END,
        1,  -- orden 1 = segundo
        v_etapa.id = v_stage_first.id,  -- gate solo en primera etapa ejecución
        'Responsable Ejecución',
        '{"rol": "ejecucion"}'::JSONB
      );
    END IF;

    -- Resp. Financiero: solo en stage cobro
    IF v_etapa.stage = 'cobro' THEN
      -- Determinar si es la primera etapa de cobro
      SELECT id INTO v_stage_first
      FROM etapas_negocio
      WHERE linea_id = v_linea_id AND stage = 'cobro'
      ORDER BY orden ASC
      LIMIT 1;

      INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, config_extra)
      VALUES (
        v_etapa.id, v_ws_id, v_equipo_def_id,
        CASE WHEN v_etapa.id = v_stage_first.id THEN 'editable' ELSE 'visible' END,
        2,  -- orden 2 = tercero
        v_etapa.id = v_stage_first.id,  -- gate solo en primera etapa cobro
        'Responsable Financiero',
        '{"rol": "financiero"}'::JSONB
      );
    END IF;
  END LOOP;

  RAISE NOTICE 'Responsables separados configurados para SOENA VE';
END;
$$;
