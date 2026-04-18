-- ═══════════════════════════════════════════════════════════════════════════
-- Security Fase 1: Fixes criticos del linter de Supabase
-- Fecha: 2026-04-18
--
-- Cubre 4 hallazgos ERROR/HIGH del Supabase linter:
--   1. ve_procesamiento_log sin RLS (data leak a cualquiera con anon key)
--   2. v_equipo_activo con SECURITY DEFINER (privilege escalation)
--   3. gastos-soportes bucket con listing publico (data leak cross-workspace)
--   4. notificaciones_insert_service con WITH CHECK (true) (insert permisivo)
-- ═══════════════════════════════════════════════════════════════════════════


-- ── 1. ve_procesamiento_log: habilitar RLS + policy por workspace ──────────
-- Escrituras usan service_role (bypass RLS) via admin client en ve-documentos.ts
-- Lectura queda scoped al workspace del usuario autenticado
ALTER TABLE ve_procesamiento_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ve_log_select_workspace" ON ve_procesamiento_log
  FOR SELECT USING (workspace_id = current_user_workspace_id());


-- ── 2. v_equipo_activo: forzar SECURITY INVOKER ─────────────────────────────
-- Sin WITH (security_invoker = true), Postgres puede tratar views como
-- SECURITY DEFINER por default en algunas configuraciones, permitiendo leer
-- staff cross-workspace con las policies del owner.
DROP VIEW IF EXISTS v_equipo_activo;

CREATE VIEW v_equipo_activo
WITH (security_invoker = true) AS
SELECT workspace_id, COUNT(*) > 1 AS tiene_equipo
FROM staff
WHERE is_active = true
GROUP BY workspace_id;


-- ── 3. Bucket gastos-soportes: quitar listing publico ──────────────────────
-- La policy "Anyone can read gastos soportes" con USING (bucket_id = ...) TO public
-- permite listar TODOS los archivos del bucket, no solo acceder por URL directa.
-- Un bucket con public=true NO necesita esta policy para que las URLs funcionen
-- (Supabase sirve los archivos via URL publica sin RLS SELECT).
DROP POLICY IF EXISTS "Anyone can read gastos soportes" ON storage.objects;


-- ── 4. notificaciones: reemplazar policy INSERT permisiva ──────────────────
-- La policy actual permite a cualquier usuario autenticado insertar notificaciones
-- a cualquier destinatario en cualquier workspace.
-- Los triggers (fn_notif_*) corren como SECURITY DEFINER y bypass RLS, no necesitan
-- policy permisiva. Para inserts desde la app (ej: menciones), restringir a workspace.
DROP POLICY IF EXISTS "notificaciones_insert_service" ON notificaciones;

CREATE POLICY "notificaciones_insert_same_workspace" ON notificaciones
  FOR INSERT TO authenticated
  WITH CHECK (workspace_id = current_user_workspace_id());
