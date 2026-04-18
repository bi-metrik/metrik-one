-- ═══════════════════════════════════════════════════════════════════════════
-- Security Fase 2: Fix search_path mutable en 46 funciones
-- Fecha: 2026-04-18
--
-- Cubre el warning `function_search_path_mutable` del Supabase linter.
-- Aplica `SET search_path = public, pg_temp` a todas las funciones listadas.
--
-- Riesgo mitigado: schema hijacking. Un atacante con permisos de CREATE
-- en otro schema podria crear una funcion con el mismo nombre + schema
-- antepuesto en search_path, y lograr que una funcion publica invoque el
-- codigo malicioso en lugar del legitimo.
-- ═══════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  fn_signature TEXT;
  fn_names TEXT[] := ARRAY[
    'get_next_cotizacion_consecutivo', 'update_negocios_updated_at',
    'update_item_subtotal', 'update_negocio_bloques_updated_at',
    'is_admin_or_owner', 'get_user_role', 'check_perfil_fiscal_completo',
    'generate_riesgo_codigo', 'fn_sync_staff_role_to_profile',
    'wa_find_contacts', 'wa_find_opportunities', 'generate_workspace_slug',
    'crear_notificacion', 'get_profile_by_role', 'fn_registrar_etapa_historial',
    'update_probabilidad', 'recalcular_margen', 'apply_plantilla_to_workspace',
    'generate_oportunidad_codigo', 'trg_oportunidad_auto_codigo',
    'fn_notif_asignacion_responsable', 'trg_empresa_auto_codigo',
    'wa_find_projects', 'fn_notif_colaborador', 'wa_identify_user',
    'trg_proyecto_auto_nombre', 'fn_notif_handoff', 'fn_notif_proyecto_entregado',
    'fn_auto_cerrar_proyecto_entregado', 'evaluate_stage_rules',
    'create_default_stages_for_workspace', 'compute_riesgo_dimensions',
    'trg_cotizacion_auto_codigo', 'seed_fiscal_profile',
    'track_opportunity_stage_change', 'on_opportunity_won', 'fn_notif_mencion',
    'generate_empresa_codigo', 'trg_negocio_auto_codigo', 'set_updated_at',
    'generate_negocio_codigo_sin_empresa', 'generate_negocio_codigo',
    'puede_avanzar_etapa', 'current_user_workspace_id',
    'update_updated_at_column', 'seed_expense_categories'
  ];
BEGIN
  FOR fn_signature IN
    SELECT n.nspname || '.' || p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')'
    FROM pg_proc p
    JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public'
      AND p.proname = ANY(fn_names)
  LOOP
    EXECUTE 'ALTER FUNCTION ' || fn_signature || ' SET search_path = public, pg_temp';
    RAISE NOTICE 'Fixed: %', fn_signature;
  END LOOP;
END $$;
