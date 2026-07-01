-- Security Advisor OLA 2 — cerrar `anon_security_definer_function_executable` (45 funciones)
--
-- Contexto: las 45 funciones son SECURITY DEFINER y hoy son ejecutables por `anon`,
-- `authenticated` y `public` porque tienen el ACL por defecto (EXECUTE a PUBLIC).
-- ONE opera 100% autenticado y las edge functions/crons usan `service_role`.
-- Ninguna de estas debe ser invocable por un usuario SIN login.
--
-- Estrategia (prioriza NO romper aislamiento ni la app):
--   * TODAS (45): REVOKE EXECUTE FROM PUBLIC y FROM anon  -> cierra los 45 warns `anon_...`.
--   * 21 funciones trigger puras (RETURNS trigger): ademas REVOKE FROM authenticated.
--       Un trigger NO chequea el privilegio EXECUTE del usuario que dispara el DML,
--       la funcion corre en el contexto del disparo -> revocar a authenticated es seguro
--       y ademas cierra 21 warns `authenticated_...`.
--   * 24 funciones NO-trigger (RPCs desde el cliente, helpers de RLS, helpers de edge):
--       se MANTIENE / GRANT EXECUTE a authenticated + service_role para no romper
--       ni la app ni los webhooks/crons. Su warn `authenticated_...` queda ABIERTO a
--       proposito (es advertencia, no obligacion; revocarlo rompe RPCs o policies).
--
-- NO se toca `authenticated_security_definer_function_executable` en bloque (riesgoso).
-- NO se aplica a produccion desde este PR: la migracion queda en el repo para que
-- Mauricio la aplique cuando decida.

------------------------------------------------------------------------------
-- GRUPO 1 — Funciones trigger puras (RETURNS trigger): revocar public+anon+authenticated
------------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.admin_proceso_etapas_updated_at()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_skills_updated_at()              FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_workflows_assign_numero()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.asignar_responsable_area_entrante()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_etapa_numero()                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.assign_linea_numero()                  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.create_default_stages_for_workspace()  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_auto_cerrar_proyecto_entregado()    FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_notif_asignacion_responsable()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_notif_colaborador()                 FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_notif_handoff()                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_notif_mencion()                     FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_notif_proyecto_entregado()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_registrar_etapa_historial()         FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.fn_sync_staff_role_to_profile()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.negocios_init_etapa_cambiada_at()      FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.negocios_track_etapa_change()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.protect_workspace_drive_config()       FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_negocio_responsable_id()          FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_negocio_stage_from_etapa()        FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_negocios_pausa()                  FROM PUBLIC, anon, authenticated;

------------------------------------------------------------------------------
-- GRUPO 2 — Funciones NO-trigger: revocar public+anon; conservar authenticated + service_role
--   Motivo por el que se conserva authenticated (queda warn abierto a proposito):
--     - RPC desde el cliente: apply_plantilla_to_workspace, claim_bloque_lock,
--       evaluate_stage_rules, force_unlock_bloque, gates_pendientes_etapa,
--       generate_cuenta_cobro_numero, heartbeat_bloque_lock, puede_avanzar_etapa,
--       release_bloque_lock, count_negocios_por_conciliar
--     - Referenciada en policies RLS: current_user_workspace_id, is_admin_or_owner
--       (revocar authenticated rompe el aislamiento por workspace de TODAS las tablas)
--     - Helper de gates / notificaciones / util invocada indirectamente o por
--       edge/cron con posible ruta authenticated: condicion_cumplida, crear_notificacion,
--       get_user_role, get_profile_by_role, horas_habiles_entre, generate_cert_lote_numero,
--       cleanup_expired_bloque_locks, detectar_responsable_faltante_area,
--       wa_find_contacts, wa_find_opportunities, wa_find_projects, wa_identify_user
------------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.apply_plantilla_to_workspace(uuid, uuid)                                     FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.claim_bloque_lock(uuid, uuid, uuid, integer)                                 FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_expired_bloque_locks()                                               FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.condicion_cumplida(uuid, uuid, uuid, jsonb)                                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.count_negocios_por_conciliar(uuid)                                           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.crear_notificacion(uuid, uuid, text, text, text, uuid, text, jsonb)         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.current_user_workspace_id()                                                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.detectar_responsable_faltante_area()                                         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.evaluate_stage_rules(uuid, uuid, text)                                       FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.force_unlock_bloque(uuid, uuid)                                              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.gates_pendientes_etapa(uuid, uuid)                                           FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_cert_lote_numero(uuid, uuid, text)                                  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.generate_cuenta_cobro_numero(uuid, integer, integer)                         FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_profile_by_role(uuid, text)                                              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_user_role()                                                              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.heartbeat_bloque_lock(uuid, uuid, integer)                                   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.horas_habiles_entre(timestamptz, timestamptz)                                FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin_or_owner()                                                          FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.puede_avanzar_etapa(uuid, uuid)                                              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.release_bloque_lock(uuid, uuid)                                              FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.wa_find_contacts(uuid, text, integer)                                        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.wa_find_opportunities(uuid, text, integer)                                   FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.wa_find_projects(uuid, text, integer)                                        FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.wa_identify_user(text)                                                       FROM PUBLIC, anon;

-- Asegurar EXECUTE para los roles que SI deben ejecutarlas (idempotente):
GRANT EXECUTE ON FUNCTION public.apply_plantilla_to_workspace(uuid, uuid)                             TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_bloque_lock(uuid, uuid, uuid, integer)                         TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.cleanup_expired_bloque_locks()                                       TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.condicion_cumplida(uuid, uuid, uuid, jsonb)                          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.count_negocios_por_conciliar(uuid)                                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.crear_notificacion(uuid, uuid, text, text, text, uuid, text, jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_workspace_id()                                          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.detectar_responsable_faltante_area()                                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.evaluate_stage_rules(uuid, uuid, text)                               TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.force_unlock_bloque(uuid, uuid)                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.gates_pendientes_etapa(uuid, uuid)                                   TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_cert_lote_numero(uuid, uuid, text)                          TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_cuenta_cobro_numero(uuid, integer, integer)                 TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_profile_by_role(uuid, text)                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_user_role()                                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_bloque_lock(uuid, uuid, integer)                           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.horas_habiles_entre(timestamptz, timestamptz)                        TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin_or_owner()                                                  TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.puede_avanzar_etapa(uuid, uuid)                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.release_bloque_lock(uuid, uuid)                                      TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wa_find_contacts(uuid, text, integer)                                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wa_find_opportunities(uuid, text, integer)                           TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wa_find_projects(uuid, text, integer)                                TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wa_identify_user(text)                                               TO authenticated, service_role;

-- ── NO incluido a proposito en esta OLA (documentado para decision de madrugada) ──
-- C) public.v_cardumen_live  (security_definer_view, ERROR): vista de un producto
--    APARTE (cardumen), sin referencias en ONE. Expone cardumen_respuestas (menos
--    'narrative') a `anon` como feed publico "live". La tabla base NO tiene policy
--    SELECT para anon (por diseno) -> pasar la vista a security_invoker la DEJA VACIA
--    para anon y rompe el feed. Requiere decision del dueno de cardumen. NO se toca.
-- D) public.cardumen_respuestas (rls_policy_always_true): policy anon INSERT
--    WITH CHECK (true) = captura publica anonima intencional (formulario de estudio).
--    Sin policy SELECT para anon -> no hay fuga de lectura. NO se toca.
-- E) admin_proceso_etapas, admin_skills, generaciones_log, wa_message_log,
--    cardumen_chat_sessions (rls_enabled_no_policy): todas service-role-only
--    (o producto externo). RLS on + 0 policy = deny a clientes = correcto by-design.
--    NO se agrega policy.
-- F) extension_in_public (pg_net, pg_trgm, unaccent): mover de schema es riesgoso
--    y solo cosmetico. NO se toca en esta ola.
-- G) auth_leaked_password_protection: config de Auth (Dashboard), no SQL. Accion
--    manual de Mauricio.
