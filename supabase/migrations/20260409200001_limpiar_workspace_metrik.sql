-- ============================================================
-- Limpiar workspace MéTRIK (a21bfc88-1a60-48c3-afcd-144226aa2392)
-- Borrar TODOS los datos transaccionales y de entidades
-- Preservar: workspace, profiles, etapas_negocio, bloque_configs,
--            bloque_definitions, staff, workspace_stages, stage_transition_rules
-- ============================================================

DO $$
DECLARE
  v_wid UUID := 'a21bfc88-1a60-48c3-afcd-144226aa2392';
BEGIN
  -- Nivel 5: notificaciones, logs
  DELETE FROM notifications WHERE workspace_id = v_wid;
  DELETE FROM causaciones_log WHERE workspace_id = v_wid;
  DELETE FROM activity_log WHERE workspace_id = v_wid;

  -- negocio_bloques (via bloque_configs del workspace)
  DELETE FROM negocio_bloques WHERE bloque_config_id IN (
    SELECT bc.id FROM bloque_configs bc WHERE bc.workspace_id = v_wid
  );

  -- Nivel 4: horas, cobros, payments, facturas
  DELETE FROM horas WHERE workspace_id = v_wid;
  DELETE FROM cobros WHERE workspace_id = v_wid;
  DELETE FROM payments WHERE workspace_id = v_wid;
  DELETE FROM facturas WHERE workspace_id = v_wid;

  -- Romper dependencia circular gastos <-> gastos_fijos_borradores
  UPDATE gastos SET gasto_fijo_ref_id = NULL WHERE workspace_id = v_wid;
  DELETE FROM gastos_fijos_borradores WHERE workspace_id = v_wid;
  DELETE FROM gastos WHERE workspace_id = v_wid;

  -- Nivel 3: proyecto_rubros, quote_items
  DELETE FROM proyecto_rubros WHERE proyecto_id IN (
    SELECT id FROM proyectos WHERE workspace_id = v_wid
  );
  -- quote_items: tabla vacía, skip

  -- entity_labels, labels
  DELETE FROM entity_labels WHERE label_id IN (
    SELECT id FROM labels WHERE workspace_id = v_wid
  );
  DELETE FROM labels WHERE workspace_id = v_wid;

  -- custom fields
  DELETE FROM custom_field_mappings WHERE workspace_id = v_wid;
  DELETE FROM custom_fields WHERE workspace_id = v_wid;

  -- Nivel 2: entidades principales (orden FK: proyectos→cotizaciones, empresas→contactos)
  DELETE FROM proyectos WHERE workspace_id = v_wid;
  DELETE FROM cotizaciones WHERE workspace_id = v_wid;
  DELETE FROM negocios WHERE workspace_id = v_wid;
  DELETE FROM oportunidades WHERE workspace_id = v_wid;
  DELETE FROM empresas WHERE workspace_id = v_wid;
  DELETE FROM contactos WHERE workspace_id = v_wid;

  -- Nivel 1: datos financieros de config
  DELETE FROM gastos_fijos_config WHERE workspace_id = v_wid;
  DELETE FROM saldos_banco WHERE workspace_id = v_wid;

  RAISE NOTICE 'Workspace metrik limpio — todo borrado.';
END;
$$;
