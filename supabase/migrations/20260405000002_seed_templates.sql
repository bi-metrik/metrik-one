-- ============================================================
-- NEGOCIOS ARCHITECTURE — Migración 3/3: Seed data
-- Biblioteca de bloques + 3 plantillas ONE nativo
-- ============================================================

-- ------------------------------------------------------------
-- 1. BLOQUE DEFINITIONS — Los 11 tipos de bloque
-- ------------------------------------------------------------
INSERT INTO bloque_definitions (tipo, nombre, descripcion, is_visualization, can_be_gate, supports_array_items, default_estado, icon_name) VALUES
  ('datos',              'Datos',               'Captura campos del negocio (texto, número, fecha, toggle, select, imagen)',        false, true,  false, 'editable', 'FormInput'),
  ('documentos',         'Documentos',          'Links a archivos en nube. Descarga, previsualización y verificación AI',          false, true,  true,  'editable', 'FileText'),
  ('cotizacion',         'Cotización',          'Propuesta económica. Auto-generada o manual. Editable → readonly por etapa',      false, true,  false, 'editable', 'FileSpreadsheet'),
  ('cobros',             'Cobros',              'Cartera del negocio: cobrado, por cobrar, pendiente. Multi-pagos confirmables',   false, true,  false, 'editable', 'Banknote'),
  ('checklist',          'Checklist',           'Lista de tareas. Completar todos los ítems = firma del usuario. Sin archivos',    false, true,  true,  'editable', 'CheckSquare'),
  ('checklist_soporte',  'Checklist con soporte','Igual que checklist + link a archivo en nube por ítem. Desbloquea tareas',      false, true,  true,  'editable', 'ClipboardCheck'),
  ('equipo',             'Equipo',              '3 responsables tipados: comercial, ejecución, financiero. Cambio queda en actividad', false, true, false, 'editable', 'Users'),
  ('aprobacion',         'Aprobación',          'Aprobadores del workflow. Entregable en actividad. Genera notificación',         false, true,  false, 'editable', 'ShieldCheck'),
  ('cronograma',         'Cronograma',          'Fechas, plazos y responsables por actividad. Light PM sin ser gestor de proyectos', false, false, true, 'editable', 'CalendarDays'),
  ('resumen_financiero', 'Resumen financiero',  'Costos ejecutados, total cobrado, por pagar, pagado, por cobrar. Solo lectura',  true,  false, false, 'visible',  'BarChart3'),
  ('ejecucion',          'Ejecución',           'Gastos, horas y cobros ejecutados del negocio consolidados. Solo lectura',       true,  false, false, 'visible',  'Activity')
ON CONFLICT (tipo) DO NOTHING;

-- ------------------------------------------------------------
-- 2. PLANTILLA 1 — "Soy profesional"
-- Consultor, diseñador, abogado, contador, agente, coach
-- 5 etapas: Venta×2 + Ejecución×2 + Cobro×1
-- ------------------------------------------------------------
WITH linea AS (
  INSERT INTO lineas_negocio (workspace_id, nombre, descripcion, tipo)
  VALUES (NULL, 'Soy profesional', 'Para consultores, diseñadores, abogados, contadores y similares que venden conocimiento y tiempo', 'plantilla')
  RETURNING id
)
INSERT INTO etapas_negocio (linea_id, stage, nombre, orden) VALUES
  ((SELECT id FROM linea), 'venta',    'Por contactar',    1),
  ((SELECT id FROM linea), 'venta',    'Propuesta enviada', 2),
  ((SELECT id FROM linea), 'ejecucion','En desarrollo',    3),
  ((SELECT id FROM linea), 'ejecucion','En revisión',      4),
  ((SELECT id FROM linea), 'cobro',    'Por cobrar',       5);

-- ------------------------------------------------------------
-- 3. PLANTILLA 2 — "Ejecuto proyectos"
-- Constructor, instalador, técnico, ingeniero, arquitecto
-- 8 etapas: Venta×3 + Ejecución×4 + Cobro×1
-- ------------------------------------------------------------
WITH linea AS (
  INSERT INTO lineas_negocio (workspace_id, nombre, descripcion, tipo)
  VALUES (NULL, 'Ejecuto proyectos', 'Para constructores, instaladores, técnicos e ingenieros que entregan obras y resultados tangibles', 'plantilla')
  RETURNING id
)
INSERT INTO etapas_negocio (linea_id, stage, nombre, orden) VALUES
  ((SELECT id FROM linea), 'venta',    'Por contactar',  1),
  ((SELECT id FROM linea), 'venta',    'Propuesta enviada', 2),
  ((SELECT id FROM linea), 'venta',    'Contrato',       3),
  ((SELECT id FROM linea), 'ejecucion','Planeación',     4),
  ((SELECT id FROM linea), 'ejecucion','En ejecución',   5),
  ((SELECT id FROM linea), 'ejecucion','Supervisión',    6),
  ((SELECT id FROM linea), 'ejecucion','Entrega',        7),
  ((SELECT id FROM linea), 'cobro',    'Por cobrar',     8);

-- ------------------------------------------------------------
-- 4. PLANTILLA 3 — "Atiendo clientes"
-- Estética, boutique, taller, restaurante, spa
-- 3 etapas: Venta×1 + Ejecución×1 + Cobro×1
-- ------------------------------------------------------------
WITH linea AS (
  INSERT INTO lineas_negocio (workspace_id, nombre, descripcion, tipo)
  VALUES (NULL, 'Atiendo clientes', 'Para estéticas, boutiques, talleres y negocios de atención directa con flujo transaccional rápido', 'plantilla')
  RETURNING id
)
INSERT INTO etapas_negocio (linea_id, stage, nombre, orden) VALUES
  ((SELECT id FROM linea), 'venta',    'Solicitud recibida', 1),
  ((SELECT id FROM linea), 'ejecucion','En atención',        2),
  ((SELECT id FROM linea), 'cobro',    'Por cobrar',         3);

-- ------------------------------------------------------------
-- 5. FUNCIÓN: Aplicar plantilla a un workspace
-- Crea bloque_configs por defecto al onboardear un tenant
-- Llamar en onboarding cuando el usuario elige su tipo
-- ------------------------------------------------------------
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
        -- Venta: equipo + cotización
        (v_etapa.stage = 'venta'      AND bd.tipo IN ('equipo', 'cotizacion'))
        -- Ejecución: equipo + cobros + resumen + ejecución (sin datos/checklist/documentos — requieren config_extra)
        OR (v_etapa.stage = 'ejecucion' AND bd.tipo IN ('equipo', 'cobros', 'resumen_financiero', 'ejecucion'))
        -- Cobro: cobros + resumen + ejecución
        OR (v_etapa.stage = 'cobro'    AND bd.tipo IN ('cobros', 'resumen_financiero', 'ejecucion'))
      )
      ORDER BY bd.tipo
    LOOP
      INSERT INTO bloque_configs (etapa_id, workspace_id, bloque_definition_id, estado, orden, es_gate)
      VALUES (v_etapa.id, p_workspace_id, v_bloque.id, v_bloque.default_estado, v_orden, false)
      ON CONFLICT (etapa_id, workspace_id, bloque_definition_id) DO NOTHING;
      v_orden := v_orden + 1;
    END LOOP;
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- COMENTARIO FINAL
-- Para aplicar una plantilla a un workspace en onboarding:
--   SELECT apply_plantilla_to_workspace('workspace-uuid', 'linea-uuid');
-- Para verificar gates antes de avanzar de etapa:
--   SELECT puede_avanzar_etapa('negocio-uuid', 'etapa-uuid');
-- ------------------------------------------------------------
