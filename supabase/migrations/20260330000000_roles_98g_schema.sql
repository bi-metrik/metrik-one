-- [98G] Fase 0: Schema migration — backward-compatible, zero frontend changes
-- Extiende staff, oportunidades, proyectos. Crea activity_log + helpers.

-- ─── 1. Extender staff ───────────────────────────────────────────────────────

ALTER TABLE staff ADD COLUMN IF NOT EXISTS profile_id UUID UNIQUE REFERENCES profiles(id);

ALTER TABLE staff ADD COLUMN IF NOT EXISTS rol_plataforma TEXT DEFAULT 'ejecutor'
  CHECK (rol_plataforma IN ('dueno','administrador','supervisor','ejecutor','campo'));

ALTER TABLE staff ADD COLUMN IF NOT EXISTS area TEXT
  CHECK (area IN ('comercial','operaciones','admin_finanzas','direccion'));

CREATE INDEX IF NOT EXISTS idx_staff_profile_id ON staff(profile_id) WHERE profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_staff_ws_role ON staff(workspace_id, is_active, rol_plataforma);

-- ─── 2. Extender oportunidades y proyectos ───────────────────────────────────

ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS responsable_id UUID REFERENCES staff(id);
ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS colaboradores UUID[] DEFAULT '{}';

ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS responsable_id UUID REFERENCES staff(id);
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS colaboradores UUID[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_oportunidades_responsable ON oportunidades(responsable_id) WHERE responsable_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proyectos_responsable ON proyectos(responsable_id) WHERE responsable_id IS NOT NULL;

-- ─── 3. Crear activity_log ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS activity_log (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  entidad_tipo TEXT NOT NULL CHECK (entidad_tipo IN ('oportunidad','proyecto')),
  entidad_id UUID NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('comentario','cambio','sistema')),
  autor_id UUID REFERENCES staff(id),
  campo_modificado TEXT,
  valor_anterior TEXT,
  valor_nuevo TEXT,
  contenido TEXT CHECK (char_length(contenido) <= 280),
  mencion_id UUID REFERENCES staff(id),
  link_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_activity_log_entidad ON activity_log(entidad_tipo, entidad_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_workspace ON activity_log(workspace_id, created_at DESC);

ALTER TABLE activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_log_workspace_isolation" ON activity_log
  FOR ALL USING (workspace_id = current_user_workspace_id());

-- ─── 4. Funciones helper ─────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION is_admin_or_owner()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM staff
    WHERE profile_id = auth.uid()
      AND is_active = true
      AND rol_plataforma IN ('dueno', 'administrador')
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

CREATE OR REPLACE FUNCTION get_user_role()
RETURNS TEXT AS $$
BEGIN
  RETURN (
    SELECT rol_plataforma FROM staff
    WHERE profile_id = auth.uid()
      AND is_active = true
    LIMIT 1
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- Vista: workspace tiene >1 staff activo
CREATE OR REPLACE VIEW v_equipo_activo AS
SELECT workspace_id, COUNT(*) > 1 AS tiene_equipo
FROM staff
WHERE is_active = true
GROUP BY workspace_id;
