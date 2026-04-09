-- ============================================================
-- Bloques de venta: cotizacion + cronograma en etapas de venta
-- Aprobacion solo para "Ejecuto proyectos" en etapa Contrato
-- ============================================================

-- 1. Actualizar apply_plantilla_to_workspace para incluir nuevos bloques en venta
-- Logica por etapa:
--   Venta orden 1 (Contacto/Solicitud): solo equipo
--   Venta orden 2 (Propuesta): cotizacion (gate) + cronograma + equipo
--   Venta orden 3 (Contrato, solo Ejecuto proyectos): aprobacion (gate) + equipo
--   Atiendo clientes (1 sola etapa venta): cotizacion + cronograma + equipo (sin gates)
CREATE OR REPLACE FUNCTION apply_plantilla_to_workspace(
  p_workspace_id UUID,
  p_linea_id     UUID
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_etapa RECORD;
  v_bloque RECORD;
  v_orden INTEGER;
  v_linea_nombre TEXT;
  v_es_gate BOOLEAN;
BEGIN
  SELECT nombre INTO v_linea_nombre FROM lineas_negocio WHERE id = p_linea_id;

  FOR v_etapa IN
    SELECT id, stage, nombre, orden FROM etapas_negocio WHERE linea_id = p_linea_id ORDER BY orden
  LOOP
    v_orden := 0;
    FOR v_bloque IN
      SELECT bd.id, bd.default_estado, bd.tipo
      FROM bloque_definitions bd
      WHERE (
        -- Venta etapa 1 (Contacto/Solicitud): solo equipo
        (v_etapa.stage = 'venta' AND v_etapa.orden = 1 AND bd.tipo = 'equipo')
        -- Venta etapa 2 (Propuesta): cotizacion + cronograma + equipo
        OR (v_etapa.stage = 'venta' AND v_etapa.orden = 2 AND bd.tipo IN ('cotizacion', 'cronograma', 'equipo'))
        -- Venta etapa 3 (Contrato, solo Ejecuto proyectos): aprobacion + equipo
        OR (v_etapa.stage = 'venta' AND v_etapa.orden = 3 AND v_linea_nombre = 'Ejecuto proyectos' AND bd.tipo IN ('aprobacion', 'equipo'))
        -- Atiendo clientes: solo 1 etapa de venta, agregar cotizacion + cronograma + equipo sin gate
        OR (v_etapa.stage = 'venta' AND v_linea_nombre = 'Atiendo clientes' AND bd.tipo IN ('cotizacion', 'cronograma', 'equipo'))
        -- Ejecucion
        OR (v_etapa.stage = 'ejecucion' AND bd.tipo IN ('equipo', 'datos', 'checklist', 'cobros', 'resumen_financiero', 'ejecucion', 'historial'))
        -- Cobro
        OR (v_etapa.stage = 'cobro' AND bd.tipo IN ('cobros', 'resumen_financiero', 'ejecucion', 'historial'))
      )
      ORDER BY
        CASE bd.tipo
          WHEN 'cotizacion' THEN 0
          WHEN 'aprobacion' THEN 0
          WHEN 'cronograma' THEN 1
          WHEN 'equipo' THEN 2
          ELSE 3
        END,
        bd.tipo
    LOOP
      -- Determinar es_gate
      v_es_gate := false;
      IF v_etapa.stage = 'venta' AND v_etapa.orden = 2 AND v_bloque.tipo = 'cotizacion' THEN
        v_es_gate := true;
      END IF;
      IF v_etapa.stage = 'venta' AND v_etapa.orden = 3 AND v_bloque.tipo = 'aprobacion' THEN
        v_es_gate := true;
      END IF;

      INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate)
      VALUES (v_etapa.id, p_workspace_id, v_bloque.id, v_bloque.default_estado, v_orden, v_es_gate)
      ON CONFLICT (etapa_id, workspace_id, bloque_definition_id, orden) DO NOTHING;
      v_orden := v_orden + 1;
    END LOOP;
  END LOOP;
END;
$$;

-- 2. Agregar bloques a etapas de venta de workspaces existentes
-- Nota: Este DO block opera sobre workspaces que YA tenian bloque_configs.
-- Workspaces sin configs (como metrik tras limpieza) requieren re-aplicar apply_plantilla_to_workspace.
DO $$
DECLARE
  v_bd_cotizacion UUID;
  v_bd_cronograma UUID;
  v_bd_aprobacion UUID;
  v_etapa RECORD;
  v_max_orden INT;
  v_linea_nombre TEXT;
BEGIN
  SELECT id INTO v_bd_cotizacion FROM bloque_definitions WHERE tipo = 'cotizacion';
  SELECT id INTO v_bd_cronograma FROM bloque_definitions WHERE tipo = 'cronograma';
  SELECT id INTO v_bd_aprobacion FROM bloque_definitions WHERE tipo = 'aprobacion';

  IF v_bd_cotizacion IS NULL OR v_bd_cronograma IS NULL OR v_bd_aprobacion IS NULL THEN
    RAISE NOTICE 'Missing bloque_definitions for cotizacion, cronograma or aprobacion';
    RETURN;
  END IF;

  -- Para cada etapa de venta de workspaces existentes
  FOR v_etapa IN
    SELECT DISTINCT bc.etapa_id, bc.workspace_id, en.stage, en.nombre AS etapa_nombre, en.orden AS etapa_orden,
           ln.nombre AS linea_nombre, ln.tipo AS linea_tipo
    FROM bloque_configs bc
    JOIN etapas_negocio en ON en.id = bc.etapa_id
    JOIN lineas_negocio ln ON ln.id = en.linea_id
    WHERE en.stage = 'venta'
  LOOP
    -- Obtener max orden actual
    SELECT COALESCE(MAX(orden), -1) INTO v_max_orden
    FROM bloque_configs
    WHERE etapa_id = v_etapa.etapa_id
      AND workspace_id = v_etapa.workspace_id;

    -- === COTIZACION ===
    -- Para "Atiendo clientes" (solo 1 etapa de venta = "Solicitud recibida"): gate=false (flujo rapido)
    -- Para las demas plantillas: en etapa "Propuesta enviada" (orden=2): gate=true
    IF NOT EXISTS (
      SELECT 1 FROM bloque_configs
      WHERE etapa_id = v_etapa.etapa_id
        AND workspace_id = v_etapa.workspace_id
        AND bloque_definition_id = v_bd_cotizacion
    ) THEN
      -- Determinar si es gate
      IF v_etapa.linea_nombre = 'Atiendo clientes' THEN
        -- Flujo transaccional rapido: cotizacion no es gate
        INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra)
        VALUES (v_etapa.etapa_id, v_etapa.workspace_id, v_bd_cotizacion, 'Cotización', 'editable', v_max_orden + 1, false, '{}'::jsonb);
        v_max_orden := v_max_orden + 1;
      ELSIF v_etapa.etapa_orden = 2 THEN
        -- Propuesta enviada (orden=2): cotizacion como gate
        INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra)
        VALUES (v_etapa.etapa_id, v_etapa.workspace_id, v_bd_cotizacion, 'Cotización', 'editable', v_max_orden + 1, true, '{}'::jsonb);
        v_max_orden := v_max_orden + 1;
      END IF;
    END IF;

    -- === CRONOGRAMA ===
    -- Misma logica: en "Propuesta enviada" (orden=2) o "Solicitud recibida" para Atiendo clientes
    IF NOT EXISTS (
      SELECT 1 FROM bloque_configs
      WHERE etapa_id = v_etapa.etapa_id
        AND workspace_id = v_etapa.workspace_id
        AND bloque_definition_id = v_bd_cronograma
    ) THEN
      IF v_etapa.linea_nombre = 'Atiendo clientes' OR v_etapa.etapa_orden = 2 THEN
        INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra)
        VALUES (v_etapa.etapa_id, v_etapa.workspace_id, v_bd_cronograma, 'Cronograma', 'editable', v_max_orden + 1, false, '{}'::jsonb);
        v_max_orden := v_max_orden + 1;
      END IF;
    END IF;

    -- === APROBACION (solo "Ejecuto proyectos", etapa "Contrato" orden=3) ===
    IF v_etapa.linea_nombre = 'Ejecuto proyectos' AND v_etapa.etapa_nombre = 'Contrato' THEN
      IF NOT EXISTS (
        SELECT 1 FROM bloque_configs
        WHERE etapa_id = v_etapa.etapa_id
          AND workspace_id = v_etapa.workspace_id
          AND bloque_definition_id = v_bd_aprobacion
      ) THEN
        INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra)
        VALUES (v_etapa.etapa_id, v_etapa.workspace_id, v_bd_aprobacion, 'Aprobación', 'editable', v_max_orden + 1, true, '{}'::jsonb);
        v_max_orden := v_max_orden + 1;
      END IF;
    END IF;

  END LOOP;

  RAISE NOTICE 'Bloques de venta agregados a workspaces existentes';
END;
$$;

-- 3. Crear negocio_bloques para negocios en etapas de venta que ahora tienen los nuevos bloques
DO $$
DECLARE
  v_config RECORD;
  v_negocio RECORD;
BEGIN
  -- Para cada bloque_config nuevo en etapas de venta (cotizacion, cronograma, aprobacion)
  FOR v_config IN
    SELECT bc.id AS config_id, bc.etapa_id, bc.workspace_id
    FROM bloque_configs bc
    JOIN bloque_definitions bd ON bd.id = bc.bloque_definition_id
    JOIN etapas_negocio en ON en.id = bc.etapa_id
    WHERE en.stage = 'venta'
      AND bd.tipo IN ('cotizacion', 'cronograma', 'aprobacion')
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

  RAISE NOTICE 'negocio_bloques de venta creados para negocios existentes';
END;
$$;
