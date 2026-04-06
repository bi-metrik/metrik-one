-- ============================================================
-- Fix 2: Nombres de bloques alineados al vocabulario SOENA
-- Agrega columna nombre a bloque_configs para override
-- del nombre genérico de bloque_definitions
-- ============================================================

-- 1. Agregar columna nombre opcional a bloque_configs
ALTER TABLE bloque_configs
  ADD COLUMN IF NOT EXISTS nombre TEXT;

-- 2. UPDATEs para workspace SOENA
-- Identificamos cada bloque_config por su etapa + workspace + orden
-- para no afectar otras configuraciones

DO $$
DECLARE
  v_workspace_id UUID := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  v_linea_id     UUID;

  v_etapa1  UUID;
  v_etapa2  UUID;
  v_etapa3  UUID;
  v_etapa4  UUID;
  v_etapa5  UUID;
  v_etapa6  UUID;
  v_etapa7  UUID;

BEGIN

  -- Obtener línea SOENA
  SELECT id INTO v_linea_id
  FROM lineas_negocio
  WHERE workspace_id = v_workspace_id
    AND nombre = 'Proceso VE/HEV/PHEV'
  LIMIT 1;

  IF v_linea_id IS NULL THEN
    RAISE NOTICE 'Línea SOENA no encontrada, saltando migración de nombres';
    RETURN;
  END IF;

  -- Obtener etapas en orden
  SELECT id INTO v_etapa1 FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 1;
  SELECT id INTO v_etapa2 FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 2;
  SELECT id INTO v_etapa3 FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 3;
  SELECT id INTO v_etapa4 FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 4;
  SELECT id INTO v_etapa5 FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 5;
  SELECT id INTO v_etapa6 FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 6;
  SELECT id INTO v_etapa7 FROM etapas_negocio WHERE linea_id = v_linea_id AND orden = 7;

  -- ── ETAPA 1: Por Contactar ─────────────────────────────────
  -- Bloque equipo (orden 0) → "Equipo responsable"
  UPDATE bloque_configs SET nombre = 'Equipo responsable'
  WHERE etapa_id = v_etapa1 AND workspace_id = v_workspace_id AND orden = 0;

  -- ── ETAPA 2: Contactado ────────────────────────────────────
  -- Bloque equipo (orden 0) → "Equipo responsable"
  UPDATE bloque_configs SET nombre = 'Equipo responsable'
  WHERE etapa_id = v_etapa2 AND workspace_id = v_workspace_id AND orden = 0;
  -- Bloque datos (orden 2) → "Datos del anticipo"
  UPDATE bloque_configs SET nombre = 'Datos del anticipo'
  WHERE etapa_id = v_etapa2 AND workspace_id = v_workspace_id AND orden = 2;

  -- ── ETAPA 3: Recolección de Documentos ────────────────────
  -- Bloque equipo (orden 0) → "Equipo responsable"
  UPDATE bloque_configs SET nombre = 'Equipo responsable'
  WHERE etapa_id = v_etapa3 AND workspace_id = v_workspace_id AND orden = 0;
  -- Bloque documentos (orden 3) → "Documentos del vehículo"
  UPDATE bloque_configs SET nombre = 'Documentos del vehículo'
  WHERE etapa_id = v_etapa3 AND workspace_id = v_workspace_id AND orden = 3;
  -- Bloque checklist (orden 4) → "Verificación UPME"
  UPDATE bloque_configs SET nombre = 'Verificación UPME'
  WHERE etapa_id = v_etapa3 AND workspace_id = v_workspace_id AND orden = 4;

  -- ── ETAPA 4: Por Inclusión ─────────────────────────────────
  -- Bloque equipo (orden 0) → "Equipo responsable"
  UPDATE bloque_configs SET nombre = 'Equipo responsable'
  WHERE etapa_id = v_etapa4 AND workspace_id = v_workspace_id AND orden = 0;
  -- Bloque datos (orden 1) → "Radicado de inclusión"
  UPDATE bloque_configs SET nombre = 'Radicado de inclusión'
  WHERE etapa_id = v_etapa4 AND workspace_id = v_workspace_id AND orden = 1;

  -- ── ETAPA 5: Por Radicación ────────────────────────────────
  -- Bloque equipo (orden 0) → "Equipo responsable"
  UPDATE bloque_configs SET nombre = 'Equipo responsable'
  WHERE etapa_id = v_etapa5 AND workspace_id = v_workspace_id AND orden = 0;
  -- Bloque datos visible (orden 1) → "Radicado de inclusión (referencia)"
  UPDATE bloque_configs SET nombre = 'Radicado de inclusión (referencia)'
  WHERE etapa_id = v_etapa5 AND workspace_id = v_workspace_id AND orden = 1;
  -- Bloque datos editable (orden 2) → "Radicado de certificación"
  UPDATE bloque_configs SET nombre = 'Radicado de certificación'
  WHERE etapa_id = v_etapa5 AND workspace_id = v_workspace_id AND orden = 2;

  -- ── ETAPA 6: Por Certificación ─────────────────────────────
  -- Bloque equipo (orden 0) → "Equipo responsable"
  UPDATE bloque_configs SET nombre = 'Equipo responsable'
  WHERE etapa_id = v_etapa6 AND workspace_id = v_workspace_id AND orden = 0;
  -- Bloque documentos (orden 1) → "Concepto de certificación"
  UPDATE bloque_configs SET nombre = 'Concepto de certificación'
  WHERE etapa_id = v_etapa6 AND workspace_id = v_workspace_id AND orden = 1;
  -- Bloque resumen_financiero (orden 2) → "Resumen financiero"
  UPDATE bloque_configs SET nombre = 'Resumen financiero'
  WHERE etapa_id = v_etapa6 AND workspace_id = v_workspace_id AND orden = 2;

  -- ── ETAPA 7: Por Cobrar ────────────────────────────────────
  -- Bloque cobros (orden 0) → "Cobros"
  UPDATE bloque_configs SET nombre = 'Cobros'
  WHERE etapa_id = v_etapa7 AND workspace_id = v_workspace_id AND orden = 0;
  -- Bloque datos pago (orden 1) → "Datos del pago"
  UPDATE bloque_configs SET nombre = 'Datos del pago'
  WHERE etapa_id = v_etapa7 AND workspace_id = v_workspace_id AND orden = 1;
  -- Bloque resumen_financiero (orden 2) → "Resumen financiero"
  UPDATE bloque_configs SET nombre = 'Resumen financiero'
  WHERE etapa_id = v_etapa7 AND workspace_id = v_workspace_id AND orden = 2;

END $$;
