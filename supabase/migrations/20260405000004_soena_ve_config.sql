-- ============================================================
-- SOENA: Configuración proceso VE/HEV/PHEV
-- Línea Clarity + 7 etapas + bloque_configs por etapa
-- ============================================================

-- 0. Agregar config_extra a etapas_negocio (routing condicional)
ALTER TABLE etapas_negocio ADD COLUMN IF NOT EXISTS config_extra JSONB NOT NULL DEFAULT '{}'::jsonb;

-- 1. Eliminar UNIQUE constraint restrictivo en bloque_configs para
--    permitir múltiples bloques del mismo tipo por etapa
--    (necesario para etapa 5: dos bloques 'datos' con distinto orden)
ALTER TABLE bloque_configs DROP CONSTRAINT IF EXISTS bloque_configs_etapa_id_workspace_id_bloque_definition_id_key;
-- Reemplazar con índice único que incluya orden para permitir duplicados de tipo
CREATE UNIQUE INDEX IF NOT EXISTS bloque_configs_etapa_ws_defn_orden_key
  ON bloque_configs(etapa_id, workspace_id, bloque_definition_id, orden);

DO $$
DECLARE
  v_workspace_id   UUID := '7dea141d-d4da-483d-a78d-b14ef35500c5';
  v_linea_id       UUID;

  -- Etapa IDs
  v_etapa1  UUID;  -- Por Contactar
  v_etapa2  UUID;  -- Contactado
  v_etapa3  UUID;  -- Recolección de Documentos
  v_etapa4  UUID;  -- Por Inclusión (condicional)
  v_etapa5  UUID;  -- Por Radicación
  v_etapa6  UUID;  -- Por Certificación
  v_etapa7  UUID;  -- Por Cobrar

  -- bloque_definition IDs (precargados desde seed)
  v_bd_equipo            UUID := '7819f295-0606-433d-a51b-041b34ad50af';
  v_bd_datos             UUID := 'eb7f4ab1-889b-43e9-ae11-3b18e6da2485';
  v_bd_cotizacion        UUID := '5fa77fa2-d4c1-4d94-9b63-bec9ed67e7bd';
  v_bd_documentos        UUID := '94596801-3b27-42bb-80e6-86f67b9a625b';
  v_bd_checklist         UUID := '4bf806a2-ba90-4d1e-acf2-4022b35a921a';
  v_bd_cobros            UUID := '842f1787-f5c4-4b11-81f3-5f1b81753c9d';
  v_bd_resumen           UUID := 'ad7473d1-49a0-414e-a3e7-5df883c33d75';
  v_bd_ejecucion         UUID := '2eb69944-cc26-43cf-be09-51d087723ad7';

BEGIN

  -- ── 1. Línea de negocio Clarity SOENA ────────────────────────────────────
  INSERT INTO lineas_negocio (workspace_id, nombre, descripcion, tipo)
  VALUES (
    v_workspace_id,
    'Proceso VE/HEV/PHEV',
    'Certificación de vehículos eléctricos e híbridos',
    'clarity'
  )
  RETURNING id INTO v_linea_id;

  -- ── 2. Etapas del proceso VE ─────────────────────────────────────────────

  -- VENTA — Etapa 1
  INSERT INTO etapas_negocio (linea_id, stage, nombre, orden)
  VALUES (v_linea_id, 'venta', 'Por Contactar', 1)
  RETURNING id INTO v_etapa1;

  -- VENTA — Etapa 2
  INSERT INTO etapas_negocio (linea_id, stage, nombre, orden)
  VALUES (v_linea_id, 'venta', 'Contactado', 2)
  RETURNING id INTO v_etapa2;

  -- VENTA — Etapa 3 (con routing condicional en config_extra)
  INSERT INTO etapas_negocio (linea_id, stage, nombre, orden, config_extra)
  VALUES (
    v_linea_id, 'venta', 'Recolección de Documentos', 3,
    jsonb_build_object(
      'routing', jsonb_build_object(
        'default_etapa_orden', 5,
        'conditional', jsonb_build_array(
          jsonb_build_object(
            'condition', jsonb_build_object('field', 'verificacion_upme', 'value', 'no'),
            'etapa_orden', 4
          )
        )
      )
    )
  )
  RETURNING id INTO v_etapa3;

  -- EJECUCIÓN — Etapa 4 (condicional: solo si UPME=NO)
  INSERT INTO etapas_negocio (linea_id, stage, nombre, orden)
  VALUES (v_linea_id, 'ejecucion', 'Por Inclusión', 4)
  RETURNING id INTO v_etapa4;

  -- EJECUCIÓN — Etapa 5
  INSERT INTO etapas_negocio (linea_id, stage, nombre, orden)
  VALUES (v_linea_id, 'ejecucion', 'Por Radicación', 5)
  RETURNING id INTO v_etapa5;

  -- EJECUCIÓN — Etapa 6
  INSERT INTO etapas_negocio (linea_id, stage, nombre, orden)
  VALUES (v_linea_id, 'ejecucion', 'Por Certificación', 6)
  RETURNING id INTO v_etapa6;

  -- COBRO — Etapa 7
  INSERT INTO etapas_negocio (linea_id, stage, nombre, orden)
  VALUES (v_linea_id, 'cobro', 'Por Cobrar', 7)
  RETURNING id INTO v_etapa7;

  -- ── 3. Bloque configs por etapa ──────────────────────────────────────────

  -- ── ETAPA 1: Por Contactar ────────────────────────────────────────────────
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, config_extra)
  VALUES
    (v_etapa1, v_workspace_id, v_bd_equipo, 'editable', 0, false,
      '{"roles": ["comercial", "ejecucion", "financiero"]}'::jsonb),
    (v_etapa1, v_workspace_id, v_bd_cotizacion, 'visible', 1, false, '{}'::jsonb);

  -- ── ETAPA 2: Contactado ───────────────────────────────────────────────────
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, config_extra)
  VALUES
    (v_etapa2, v_workspace_id, v_bd_equipo, 'visible', 0, false, '{}'::jsonb),
    (v_etapa2, v_workspace_id, v_bd_cotizacion, 'visible', 1, false, '{}'::jsonb),
    (v_etapa2, v_workspace_id, v_bd_datos, 'editable', 2, true,
      jsonb_build_object(
        'fields', jsonb_build_array(
          jsonb_build_object('slug','referencia_anticipo','label','Referencia anticipo Epayco','tipo','texto','required',true),
          jsonb_build_object('slug','valor_anticipo','label','Valor anticipo','tipo','numero','required',true)
        ),
        'triggers', jsonb_build_array(
          jsonb_build_object(
            'event', 'on_complete',
            'action', 'auto_cobros',
            'params', jsonb_build_object('tipo1','anticipo','tipo2','saldo')
          )
        )
      )
    );

  -- ── ETAPA 3: Recolección de Documentos ───────────────────────────────────
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, config_extra)
  VALUES
    (v_etapa3, v_workspace_id, v_bd_equipo, 'visible', 0, false, '{}'::jsonb),
    (v_etapa3, v_workspace_id, v_bd_cotizacion, 'visible', 1, false, '{}'::jsonb),
    (v_etapa3, v_workspace_id, v_bd_datos, 'visible', 2, false, '{}'::jsonb),
    (v_etapa3, v_workspace_id, v_bd_documentos, 'editable', 3, true,
      jsonb_build_object(
        'documentos', jsonb_build_array(
          jsonb_build_object('slug','cedula','label','Cédula propietario','required',true),
          jsonb_build_object('slug','tarjeta_propiedad','label','Tarjeta de propiedad','required',true),
          jsonb_build_object('slug','homologacion','label','Documento de homologación','required',true),
          jsonb_build_object('slug','soat','label','SOAT vigente','required',true)
        )
      )
    ),
    (v_etapa3, v_workspace_id, v_bd_checklist, 'editable', 4, false,
      jsonb_build_object(
        'condition', jsonb_build_object('field','verificacion_upme','value','no'),
        'items', jsonb_build_array(
          jsonb_build_object('label','Verificar estado en UPME','tipo','checkbox'),
          jsonb_build_object('label','Confirmar documentos completos','tipo','checkbox')
        )
      )
    );

  -- ── ETAPA 4: Por Inclusión (condicional) ──────────────────────────────────
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, config_extra)
  VALUES
    (v_etapa4, v_workspace_id, v_bd_equipo, 'visible', 0, false, '{}'::jsonb),
    (v_etapa4, v_workspace_id, v_bd_datos, 'editable', 1, true,
      jsonb_build_object(
        'fields', jsonb_build_array(
          jsonb_build_object('slug','radicado_inclusion','label','Número de radicado (inclusión)','tipo','texto','required',true),
          jsonb_build_object('slug','pantallazo_inclusion','label','Pantallazo de evidencia','tipo','imagen_clipboard','required',false)
        )
      )
    );

  -- ── ETAPA 5: Por Radicación ───────────────────────────────────────────────
  -- Nota: 2 bloques de tipo 'datos' con distinto orden (1 visible + 2 editable)
  -- El UNIQUE index ahora incluye el orden, por lo que esto es válido
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, config_extra)
  VALUES
    (v_etapa5, v_workspace_id, v_bd_equipo, 'visible', 0, false, '{}'::jsonb),
    (v_etapa5, v_workspace_id, v_bd_datos, 'visible', 1, false,
      jsonb_build_object(
        'fields', jsonb_build_array(
          jsonb_build_object('slug','radicado_inclusion','label','Número de radicado (inclusión)','tipo','texto','required',false)
        )
      )
    ),
    (v_etapa5, v_workspace_id, v_bd_datos, 'editable', 2, true,
      jsonb_build_object(
        'fields', jsonb_build_array(
          jsonb_build_object('slug','radicado_certificacion','label','Número de radicado (certificación)','tipo','texto','required',true),
          jsonb_build_object('slug','pantallazo_radicacion','label','Pantallazo de evidencia','tipo','imagen_clipboard','required',false)
        )
      )
    );

  -- ── ETAPA 6: Por Certificación ────────────────────────────────────────────
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, config_extra)
  VALUES
    (v_etapa6, v_workspace_id, v_bd_equipo, 'visible', 0, false, '{}'::jsonb),
    (v_etapa6, v_workspace_id, v_bd_documentos, 'editable', 1, true,
      jsonb_build_object(
        'documentos', jsonb_build_array(
          jsonb_build_object('slug','concepto_certificacion','label','Concepto de certificación','required',true)
        )
      )
    ),
    (v_etapa6, v_workspace_id, v_bd_resumen, 'visible', 2, false, '{}'::jsonb),
    (v_etapa6, v_workspace_id, v_bd_ejecucion, 'visible', 3, false, '{}'::jsonb);

  -- ── ETAPA 7: Por Cobrar ───────────────────────────────────────────────────
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, config_extra)
  VALUES
    (v_etapa7, v_workspace_id, v_bd_cobros, 'editable', 0, false, '{}'::jsonb),
    (v_etapa7, v_workspace_id, v_bd_datos, 'editable', 1, false,
      jsonb_build_object(
        'fields', jsonb_build_array(
          jsonb_build_object('slug','ref_pago','label','Referencia de pago','tipo','texto','required',false),
          jsonb_build_object('slug','valor_pago','label','Valor recibido','tipo','numero','required',false)
        ),
        'es_multi_pago', true
      )
    ),
    (v_etapa7, v_workspace_id, v_bd_resumen, 'visible', 2, false, '{}'::jsonb),
    (v_etapa7, v_workspace_id, v_bd_ejecucion, 'visible', 3, false, '{}'::jsonb);

END $$;
