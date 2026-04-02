-- =====================================================
-- [98H] §4 — Motor de Reglas Condicionales (tenant_rules)
-- Gates configurables por tenant sobre entidades y eventos
-- =====================================================

-- ── tenant_rules: reglas de negocio por workspace ──

CREATE TABLE IF NOT EXISTS tenant_rules (
  id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  nombre       TEXT NOT NULL,
  descripcion  TEXT,
  entidad      TEXT NOT NULL CHECK (entidad IN ('oportunidad', 'proyecto', 'contacto', 'empresa')),
  evento       TEXT NOT NULL CHECK (evento IN ('create', 'update', 'status_change', 'handoff')),
  condiciones  JSONB NOT NULL,
  acciones     JSONB NOT NULL,
  prioridad    INT DEFAULT 0,
  activo       BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

-- Índice compuesto para evaluación eficiente en runtime:
-- dado un tenant + entidad + evento, solo reglas activas
CREATE INDEX idx_tenant_rules_eval
  ON tenant_rules(tenant_id, entidad, evento, activo);

ALTER TABLE tenant_rules ENABLE ROW LEVEL SECURITY;

-- Cualquier usuario del tenant puede leer las reglas
CREATE POLICY "tenant_read" ON tenant_rules FOR SELECT
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID);

-- Solo admin/owner puede escribir reglas
CREATE POLICY "admin_write" ON tenant_rules FOR ALL
  USING (tenant_id = (auth.jwt() ->> 'tenant_id')::UUID AND is_admin_or_owner());

-- Nota: MéTRIK configura las reglas directamente en BD via Clarity.
-- No hay UI de administración para el usuario final de ONE.
