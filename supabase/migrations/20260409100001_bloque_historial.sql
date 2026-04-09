-- ============================================================
-- Nuevo bloque: historial
-- Muestra lista completa de gastos, horas y cobros del negocio
-- Visualización — solo lectura
-- ============================================================

-- 1. Expandir CHECK constraint para incluir 'historial'
ALTER TABLE bloque_definitions DROP CONSTRAINT IF EXISTS bloque_definitions_tipo_check;
ALTER TABLE bloque_definitions ADD CONSTRAINT bloque_definitions_tipo_check
  CHECK (tipo IN (
    'datos', 'documentos', 'cotizacion', 'cobros',
    'checklist', 'checklist_soporte', 'equipo',
    'aprobacion', 'cronograma',
    'resumen_financiero', 'ejecucion', 'historial'
  ));

-- 2. Agregar definición
INSERT INTO bloque_definitions (tipo, nombre, descripcion, is_visualization, can_be_gate, supports_array_items, default_estado, icon_name)
VALUES ('historial', 'Historial', 'Lista completa de gastos, horas y cobros del negocio. Solo lectura', true, false, false, 'visible', 'History')
ON CONFLICT (tipo) DO NOTHING;

-- 3. Actualizar apply_plantilla_to_workspace para incluir historial en ejecucion/cobro
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
        OR (v_etapa.stage = 'ejecucion' AND bd.tipo IN ('equipo', 'datos', 'checklist', 'cobros', 'resumen_financiero', 'ejecucion', 'historial'))
        OR (v_etapa.stage = 'cobro'    AND bd.tipo IN ('cobros', 'resumen_financiero', 'ejecucion', 'historial'))
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

-- 4. Agregar bloque_configs de historial a todas las etapas ejecucion/cobro
--    de TODOS los workspaces existentes
DO $$
DECLARE
  v_bd_historial UUID;
  v_etapa RECORD;
  v_max_orden INT;
BEGIN
  SELECT id INTO v_bd_historial FROM bloque_definitions WHERE tipo = 'historial';
  IF v_bd_historial IS NULL THEN
    RAISE NOTICE 'bloque_definitions historial not found';
    RETURN;
  END IF;

  -- Para cada combinación etapa+workspace que sea ejecucion o cobro
  FOR v_etapa IN
    SELECT DISTINCT bc.etapa_id, bc.workspace_id, en.stage
    FROM bloque_configs bc
    JOIN etapas_negocio en ON en.id = bc.etapa_id
    WHERE en.stage IN ('ejecucion', 'cobro')
  LOOP
    -- Verificar que no exista ya
    IF NOT EXISTS (
      SELECT 1 FROM bloque_configs
      WHERE etapa_id = v_etapa.etapa_id
        AND workspace_id = v_etapa.workspace_id
        AND bloque_definition_id = v_bd_historial
    ) THEN
      -- Obtener máximo orden actual
      SELECT COALESCE(MAX(orden), -1) INTO v_max_orden
      FROM bloque_configs
      WHERE etapa_id = v_etapa.etapa_id
        AND workspace_id = v_etapa.workspace_id;

      INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra)
      VALUES (v_etapa.etapa_id, v_etapa.workspace_id, v_bd_historial, 'Historial', 'visible', v_max_orden + 1, false, '{}'::jsonb);
    END IF;
  END LOOP;

  RAISE NOTICE 'Bloque historial agregado a etapas ejecucion/cobro existentes';
END;
$$;

-- 5. Crear negocio_bloques para negocios en etapas ejecucion/cobro que ahora tienen historial
DO $$
DECLARE
  v_config RECORD;
  v_negocio RECORD;
BEGIN
  -- Para cada bloque_config de historial recién creado
  FOR v_config IN
    SELECT bc.id AS config_id, bc.etapa_id, bc.workspace_id
    FROM bloque_configs bc
    JOIN bloque_definitions bd ON bd.id = bc.bloque_definition_id
    WHERE bd.tipo = 'historial'
  LOOP
    -- Para cada negocio en esa etapa
    FOR v_negocio IN
      SELECT n.id AS negocio_id
      FROM negocios n
      WHERE n.etapa_actual_id = v_config.etapa_id
        AND n.workspace_id = v_config.workspace_id
        AND n.estado = 'abierto'
        AND NOT EXISTS (
          SELECT 1 FROM negocio_bloques nb
          WHERE nb.negocio_id = n.id
            AND nb.bloque_config_id = v_config.config_id
        )
    LOOP
      INSERT INTO negocio_bloques (negocio_id, bloque_config_id, estado, data)
      VALUES (v_negocio.negocio_id, v_config.config_id, 'pendiente', '{}'::jsonb);
    END LOOP;
  END LOOP;

  RAISE NOTICE 'negocio_bloques de historial creados para negocios existentes';
END;
$$;
