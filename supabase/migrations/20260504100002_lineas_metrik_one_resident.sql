-- ============================================================
-- 20260504100002 — Lineas MeTRIK ONE + MeTRIK Resident
-- Decision producto 2026-05-04: bautizar la linea de servicios profesionales
-- recurrentes como "Resident" (Mateo + Santiago + Mauricio). Crear las 2
-- lineas en workspace MeTRIK con sus workflows.
-- ============================================================

-- 1. Actualizar checks que limitan los nuevos valores
ALTER TABLE bloque_definitions DROP CONSTRAINT bloque_definitions_tipo_check;
ALTER TABLE bloque_definitions ADD CONSTRAINT bloque_definitions_tipo_check
  CHECK (tipo IN (
    'datos','documentos','documento','cotizacion','cobros','checklist','checklist_soporte',
    'equipo','aprobacion','cronograma','resumen_financiero','ejecucion','historial','formulario',
    'plan_recurrente'
  ));

ALTER TABLE lineas_negocio DROP CONSTRAINT lineas_negocio_tipo_check;
ALTER TABLE lineas_negocio ADD CONSTRAINT lineas_negocio_tipo_check
  CHECK (tipo IN ('plantilla','clarity','recurrente'));

-- 2. Catalogo: registrar tipo plan_recurrente
INSERT INTO bloque_definitions (tipo, nombre, descripcion, can_be_gate, supports_array_items, default_estado, icon_name, codigo)
VALUES (
  'plan_recurrente',
  'Plan recurrente',
  'Suscripcion / financiacion: monto + frecuencia + duracion. Genera cobros programados automaticamente.',
  true,
  false,
  'editable',
  'RefreshCw',
  'plan_recurrente'
)
ON CONFLICT (tipo) DO UPDATE SET
  nombre = EXCLUDED.nombre,
  descripcion = EXCLUDED.descripcion,
  can_be_gate = EXCLUDED.can_be_gate,
  icon_name = EXCLUDED.icon_name;

-- 2. Crear lineas + etapas + bloque_configs en un solo DO block
DO $$
DECLARE
  v_workspace_id UUID := 'a21bfc88-1a60-48c3-afcd-144226aa2392';

  -- Bloque definitions (lookup)
  v_def_datos UUID;
  v_def_documento UUID;
  v_def_cotizacion UUID;
  v_def_aprobacion UUID;
  v_def_checklist UUID;
  v_def_cobros UUID;
  v_def_resumen UUID;
  v_def_historial UUID;
  v_def_plan_rec UUID;

  -- Lineas
  v_linea_one UUID;
  v_linea_res UUID;

  -- Etapas ONE
  v_e_one_1 UUID;
  v_e_one_2 UUID;
  v_e_one_3 UUID;
  v_e_one_4 UUID;

  -- Etapas Resident
  v_e_res_1 UUID;
  v_e_res_2 UUID;
  v_e_res_3 UUID;
  v_e_res_4 UUID;
  v_e_res_5 UUID;
  v_e_res_6 UUID;
BEGIN
  -- Lookup defs
  SELECT id INTO v_def_datos      FROM bloque_definitions WHERE tipo='datos';
  SELECT id INTO v_def_documento  FROM bloque_definitions WHERE tipo='documento';
  SELECT id INTO v_def_cotizacion FROM bloque_definitions WHERE tipo='cotizacion';
  SELECT id INTO v_def_aprobacion FROM bloque_definitions WHERE tipo='aprobacion';
  SELECT id INTO v_def_checklist  FROM bloque_definitions WHERE tipo='checklist';
  SELECT id INTO v_def_cobros     FROM bloque_definitions WHERE tipo='cobros';
  SELECT id INTO v_def_resumen    FROM bloque_definitions WHERE tipo='resumen_financiero';
  SELECT id INTO v_def_historial  FROM bloque_definitions WHERE tipo='historial';
  SELECT id INTO v_def_plan_rec   FROM bloque_definitions WHERE tipo='plan_recurrente';

  -- ════════════════════════════════════════════════════════════
  -- LINEA: MeTRIK ONE (suscripcion SaaS post-Clarity)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO lineas_negocio (workspace_id, nombre, descripcion, tipo, is_active)
  VALUES (
    v_workspace_id,
    'MeTRIK ONE',
    'Suscripcion al SaaS MeTRIK ONE — recurrente mensual post-Clarity',
    'recurrente',
    true
  )
  RETURNING id INTO v_linea_one;

  -- Etapas ONE: Prospecto (venta) → Contrato (venta) → Plan activo (ejecucion) → Cierre (cobro)
  INSERT INTO etapas_negocio (linea_id, stage, nombre, orden, is_active)
  VALUES (v_linea_one, 'venta',     'Prospecto',   1, true) RETURNING id INTO v_e_one_1;
  INSERT INTO etapas_negocio (linea_id, stage, nombre, orden, is_active)
  VALUES (v_linea_one, 'venta',     'Contrato',    2, true) RETURNING id INTO v_e_one_2;
  INSERT INTO etapas_negocio (linea_id, stage, nombre, orden, is_active)
  VALUES (v_linea_one, 'ejecucion', 'Plan activo', 3, true) RETURNING id INTO v_e_one_3;
  INSERT INTO etapas_negocio (linea_id, stage, nombre, orden, is_active)
  VALUES (v_linea_one, 'cobro',     'Cierre',      4, true) RETURNING id INTO v_e_one_4;

  -- Bloques etapa 1: Prospecto
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, descripcion, config_extra)
  VALUES (v_e_one_1, v_workspace_id, v_def_datos, 'editable', 1, false,
          'Datos del prospecto',
          'Empresa, contacto, plan deseado, presupuesto estimado',
          '{"fields":[
              {"slug":"plan_deseado","label":"Plan deseado","tipo":"select","opciones":["Basico","Profesional","Enterprise"]},
              {"slug":"usuarios_estimados","label":"Usuarios estimados","tipo":"numero"},
              {"slug":"interes_principal","label":"Interes principal","tipo":"texto_largo"}
          ]}'::jsonb);

  -- Bloques etapa 2: Contrato
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, descripcion, config_extra)
  VALUES (v_e_one_2, v_workspace_id, v_def_documento, 'editable', 1, true,
          'Contrato firmado',
          'Contrato de licencia ONE firmado por ambas partes',
          '{"label":"Contrato firmado","tipos_permitidos":["application/pdf"]}'::jsonb);
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, descripcion, config_extra)
  VALUES (v_e_one_2, v_workspace_id, v_def_datos, 'editable', 2, false,
          'Datos de facturacion',
          'NIT, razon social, direccion, contacto financiero',
          '{"fields":[
              {"slug":"nit","label":"NIT","tipo":"texto"},
              {"slug":"razon_social","label":"Razon social","tipo":"texto"},
              {"slug":"contacto_facturacion","label":"Contacto facturacion","tipo":"texto"},
              {"slug":"email_facturacion","label":"Email facturacion","tipo":"email"}
          ]}'::jsonb);

  -- Bloques etapa 3: Plan activo
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, descripcion, config_extra)
  VALUES (v_e_one_3, v_workspace_id, v_def_plan_rec, 'editable', 1, true,
          'Plan de suscripcion',
          'Define monto mensual, duracion del contrato y auto-renovacion',
          '{"label":"Plan ONE","frecuencia_default":"mensual","pasarela_default":"manual","permite_auto_renovar":true}'::jsonb);
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, descripcion, config_extra)
  VALUES (v_e_one_3, v_workspace_id, v_def_cobros, 'editable', 2, false,
          'Cobros',
          'Cobros confirmados y programados pendientes', '{}'::jsonb);
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, descripcion, config_extra)
  VALUES (v_e_one_3, v_workspace_id, v_def_resumen, 'visible', 3, false,
          'Resumen financiero',
          'Cobrado vs por cobrar', '{}'::jsonb);

  -- Bloques etapa 4: Cierre
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, descripcion, config_extra)
  VALUES (v_e_one_4, v_workspace_id, v_def_aprobacion, 'editable', 1, true,
          'Decision cierre',
          'Confirmar cierre o renovacion del contrato',
          '{"label":"Decision","opciones":["Renovar","Cerrar"]}'::jsonb);

  -- ════════════════════════════════════════════════════════════
  -- LINEA: MeTRIK Resident (servicio profesional recurrente)
  -- ════════════════════════════════════════════════════════════
  INSERT INTO lineas_negocio (workspace_id, nombre, descripcion, tipo, is_active)
  VALUES (
    v_workspace_id,
    'MeTRIK Resident',
    'Servicio profesional recurrente — especialista MeTRIK que se queda con el cliente (compliance, BI, finanzas, etc.) bajo contrato de vigencia',
    'recurrente',
    true
  )
  RETURNING id INTO v_linea_res;

  -- Etapas Resident: Discovery (venta) → Propuesta (venta) → Contrato (venta) → Onboarding (ejecucion) → Vigente (ejecucion) → Cierre (cobro)
  INSERT INTO etapas_negocio (linea_id, stage, nombre, orden, is_active)
  VALUES (v_linea_res, 'venta',     'Discovery',  1, true) RETURNING id INTO v_e_res_1;
  INSERT INTO etapas_negocio (linea_id, stage, nombre, orden, is_active)
  VALUES (v_linea_res, 'venta',     'Propuesta',  2, true) RETURNING id INTO v_e_res_2;
  INSERT INTO etapas_negocio (linea_id, stage, nombre, orden, is_active)
  VALUES (v_linea_res, 'venta',     'Contrato',   3, true) RETURNING id INTO v_e_res_3;
  INSERT INTO etapas_negocio (linea_id, stage, nombre, orden, is_active)
  VALUES (v_linea_res, 'ejecucion', 'Onboarding', 4, true) RETURNING id INTO v_e_res_4;
  INSERT INTO etapas_negocio (linea_id, stage, nombre, orden, is_active)
  VALUES (v_linea_res, 'ejecucion', 'Vigente',    5, true) RETURNING id INTO v_e_res_5;
  INSERT INTO etapas_negocio (linea_id, stage, nombre, orden, is_active)
  VALUES (v_linea_res, 'cobro',     'Cierre',     6, true) RETURNING id INTO v_e_res_6;

  -- Bloques etapa 1: Discovery
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, descripcion, config_extra)
  VALUES (v_e_res_1, v_workspace_id, v_def_datos, 'editable', 1, false,
          'Necesidad del cliente',
          'Especialista requerido, alcance, dolor que resuelve',
          '{"fields":[
              {"slug":"especialista_tipo","label":"Tipo de especialista","tipo":"select","opciones":["Oficial de Cumplimiento","Analista BI","Asesor financiero","Analista de datos","Otro"]},
              {"slug":"alcance","label":"Alcance del servicio","tipo":"texto_largo"},
              {"slug":"dolor_principal","label":"Dolor principal del cliente","tipo":"texto_largo"},
              {"slug":"horas_estimadas_mes","label":"Horas estimadas/mes","tipo":"numero"}
          ]}'::jsonb);

  -- Bloques etapa 2: Propuesta
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, descripcion, config_extra)
  VALUES (v_e_res_2, v_workspace_id, v_def_cotizacion, 'editable', 1, true,
          'Propuesta economica',
          'Cotizacion del servicio Resident con monto mensual y vigencia propuesta',
          '{}'::jsonb);

  -- Bloques etapa 3: Contrato
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, descripcion, config_extra)
  VALUES (v_e_res_3, v_workspace_id, v_def_documento, 'editable', 1, true,
          'Contrato firmado',
          'Contrato Resident firmado por ambas partes',
          '{"label":"Contrato firmado","tipos_permitidos":["application/pdf"]}'::jsonb);
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, descripcion, config_extra)
  VALUES (v_e_res_3, v_workspace_id, v_def_plan_rec, 'editable', 2, true,
          'Plan recurrente',
          'Monto mensual + duracion del contrato + auto-renovacion opcional',
          '{"label":"Plan Resident","frecuencia_default":"mensual","pasarela_default":"manual","permite_auto_renovar":true}'::jsonb);

  -- Bloques etapa 4: Onboarding
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, descripcion, config_extra)
  VALUES (v_e_res_4, v_workspace_id, v_def_checklist, 'editable', 1, true,
          'Onboarding del especialista',
          'Kickoff, accesos, baseline del cliente',
          '{"items":[
              {"label":"Kickoff agendado y realizado"},
              {"label":"Accesos a sistemas del cliente entregados"},
              {"label":"Baseline / diagnostico inicial documentado"},
              {"label":"Cadencia de reuniones definida"}
          ]}'::jsonb);

  -- Bloques etapa 5: Vigente
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, descripcion, config_extra)
  VALUES (v_e_res_5, v_workspace_id, v_def_cobros, 'editable', 1, false,
          'Cobros',
          'Cobros confirmados y programados pendientes', '{}'::jsonb);
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, descripcion, config_extra)
  VALUES (v_e_res_5, v_workspace_id, v_def_resumen, 'visible', 2, false,
          'Resumen financiero',
          'Cobrado vs por cobrar del contrato', '{}'::jsonb);
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, descripcion, config_extra)
  VALUES (v_e_res_5, v_workspace_id, v_def_historial, 'visible', 3, false,
          'Historial',
          'Gastos, horas y cobros del servicio Resident', '{}'::jsonb);

  -- Bloques etapa 6: Cierre
  INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate, nombre, descripcion, config_extra)
  VALUES (v_e_res_6, v_workspace_id, v_def_aprobacion, 'editable', 1, true,
          'Decision cierre',
          'Confirmar cierre del contrato o renovacion',
          '{"label":"Decision","opciones":["Renovar","Cerrar"]}'::jsonb);

END $$;
