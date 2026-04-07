-- ============================================================
-- Cobros: visible en etapas 2-6, multi-pago etapa 7, external_ref, tipo 'pago'
-- ============================================================

DO $$
DECLARE
  v_ws_id UUID := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  v_linea_id UUID := '34a0fa6b-9ed3-4652-a419-42601132d1a8';
  v_bd_cobros UUID;
  v_etapa_id UUID;
  v_max_orden INT;
BEGIN
  SELECT id INTO v_bd_cobros FROM bloque_definitions WHERE tipo = 'cobros';

  -- Agregar BloqueCobros VISIBLE a etapas 2-6 (donde no exista)
  FOR v_etapa_id IN
    SELECT id FROM etapas_negocio
    WHERE linea_id = v_linea_id AND orden BETWEEN 2 AND 6
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM bloque_configs
      WHERE etapa_id = v_etapa_id AND workspace_id = v_ws_id AND bloque_definition_id = v_bd_cobros
    ) THEN
      SELECT COALESCE(MAX(orden), -1) + 1 INTO v_max_orden
      FROM bloque_configs WHERE etapa_id = v_etapa_id AND workspace_id = v_ws_id;

      INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, nombre, estado, orden, es_gate, config_extra)
      VALUES (v_etapa_id, v_ws_id, v_bd_cobros, 'Cobros', 'visible', v_max_orden, false, '{}'::jsonb);
    END IF;
  END LOOP;

  -- Actualizar config del bloque datos de etapa 7 para multi-pago con trigger auto_cobros_multi
  UPDATE bloque_configs
  SET config_extra = jsonb_build_object(
    'fields', jsonb_build_array(
      jsonb_build_object('slug','referencia_epayco','label','Referencia ePayco','tipo','texto','required',true),
      jsonb_build_object('slug','valor_pago','label','Valor del pago','tipo','numero','required',true)
    ),
    'es_multi_pago', true,
    'triggers', jsonb_build_array(
      jsonb_build_object(
        'event', 'on_complete',
        'action', 'auto_cobros_multi',
        'params', jsonb_build_object('tipo', 'pago')
      )
    )
  ),
  es_gate = true,
  nombre = 'Pagos ePayco'
  WHERE etapa_id = (SELECT id FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 7)
    AND workspace_id = v_ws_id
    AND bloque_definition_id = (SELECT id FROM bloque_definitions WHERE tipo = 'datos')
    AND orden = 1;

  -- Eliminar cobros tipo 'saldo' pre-creados que aun estan PENDIENTE
  DELETE FROM cobros
  WHERE workspace_id = v_ws_id
    AND tipo_cobro = 'saldo'
    AND estado_causacion = 'PENDIENTE'
    AND negocio_id IS NOT NULL;

  RAISE NOTICE 'BloqueCobros visible agregado a etapas 2-6, etapa 7 actualizada para multi-pago';
END $$;

-- Agregar columna external_ref a cobros (referencia de pago externa)
ALTER TABLE cobros ADD COLUMN IF NOT EXISTS external_ref TEXT;

-- Actualizar CHECK constraint de tipo_cobro para incluir 'pago'
ALTER TABLE cobros DROP CONSTRAINT IF EXISTS cobros_tipo_cobro_check;
ALTER TABLE cobros ADD CONSTRAINT cobros_tipo_cobro_check
  CHECK (tipo_cobro IN ('regular', 'anticipo', 'saldo', 'pago'));
