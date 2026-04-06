-- ============================================================
-- Fix: Documentos de radicación SOENA
-- 1. Título "Documentos del vehículo" → "Documentos de radicación"
-- 2. Documentos correctos: factura, rut, cedula, soporte_upme
-- ============================================================

DO $$
DECLARE
  v_workspace_id UUID := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  v_linea_id     UUID;
  v_etapa3       UUID;
BEGIN

  SELECT id INTO v_linea_id
  FROM lineas_negocio
  WHERE workspace_id = v_workspace_id
    AND nombre = 'Proceso VE/HEV/PHEV'
  LIMIT 1;

  IF v_linea_id IS NULL THEN
    RAISE NOTICE 'Línea SOENA no encontrada, saltando';
    RETURN;
  END IF;

  SELECT id INTO v_etapa3
  FROM etapas_negocio
  WHERE linea_id = v_linea_id AND orden = 3;

  -- Corregir nombre y documentos del bloque de radicación (etapa 3, orden 3)
  UPDATE bloque_configs
  SET
    nombre = 'Documentos de radicación',
    config_extra = jsonb_build_object(
      'documentos', jsonb_build_array(
        jsonb_build_object('slug', 'factura',      'label', 'Factura',                'required', true),
        jsonb_build_object('slug', 'rut',          'label', 'RUT',                    'required', true),
        jsonb_build_object('slug', 'cedula',       'label', 'Cédula',                 'required', true),
        jsonb_build_object('slug', 'soporte_upme', 'label', 'Comprobante pago UPME',  'required', true)
      )
    )
  WHERE etapa_id = v_etapa3
    AND workspace_id = v_workspace_id
    AND orden = 3;

END $$;
