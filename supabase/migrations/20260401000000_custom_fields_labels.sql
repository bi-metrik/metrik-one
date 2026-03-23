-- =====================================================
-- [98H] Nivel 1: Campos Custom + Labels + Herencia
-- =====================================================

-- ── custom_fields: definicion de campos por tenant ──

CREATE TABLE IF NOT EXISTS custom_fields (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  entidad TEXT NOT NULL CHECK (entidad IN ('oportunidad', 'proyecto', 'contacto', 'empresa')),
  nombre TEXT NOT NULL,
  slug TEXT NOT NULL,
  tipo TEXT NOT NULL CHECK (tipo IN ('text', 'number', 'select', 'boolean', 'date')),
  opciones JSONB DEFAULT NULL,
  obligatorio BOOLEAN DEFAULT false,
  orden INT DEFAULT 0,
  activo BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, entidad, slug)
);

CREATE INDEX IF NOT EXISTS idx_custom_fields_tenant ON custom_fields(workspace_id, entidad, activo);

ALTER TABLE custom_fields ENABLE ROW LEVEL SECURITY;

CREATE POLICY "custom_fields_workspace_isolation" ON custom_fields
  FOR ALL USING (workspace_id = current_user_workspace_id());

-- ── custom_field_mappings: herencia entre modulos ──

CREATE TABLE IF NOT EXISTS custom_field_mappings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  origen_entidad TEXT NOT NULL,
  origen_slug TEXT NOT NULL,
  destino_entidad TEXT NOT NULL,
  destino_slug TEXT NOT NULL,
  activo BOOLEAN DEFAULT true,
  UNIQUE(workspace_id, origen_entidad, origen_slug, destino_entidad)
);

ALTER TABLE custom_field_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "custom_field_mappings_workspace_isolation" ON custom_field_mappings
  FOR ALL USING (workspace_id = current_user_workspace_id());

-- ── labels: etiquetas por entidad ──

CREATE TABLE IF NOT EXISTS labels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  entidad TEXT NOT NULL CHECK (entidad IN ('oportunidad', 'proyecto', 'contacto', 'empresa')),
  nombre TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#6B7280',
  created_by TEXT DEFAULT 'manual',
  UNIQUE(workspace_id, entidad, nombre)
);

ALTER TABLE labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "labels_workspace_isolation" ON labels
  FOR ALL USING (workspace_id = current_user_workspace_id());

-- ── entity_labels: relacion many-to-many ──

CREATE TABLE IF NOT EXISTS entity_labels (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  entidad TEXT NOT NULL,
  entidad_id UUID NOT NULL,
  label_id UUID NOT NULL REFERENCES labels(id),
  applied_by TEXT DEFAULT 'manual',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, entidad_id, label_id)
);

CREATE INDEX IF NOT EXISTS idx_entity_labels_lookup ON entity_labels(workspace_id, entidad, entidad_id);

ALTER TABLE entity_labels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "entity_labels_workspace_isolation" ON entity_labels
  FOR ALL USING (workspace_id = current_user_workspace_id());

-- ── custom_data JSONB en entidades existentes ──

ALTER TABLE oportunidades ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';
ALTER TABLE proyectos ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';
ALTER TABLE contactos ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';
ALTER TABLE empresas ADD COLUMN IF NOT EXISTS custom_data JSONB DEFAULT '{}';

-- Indices GIN para consultas sobre campos custom
CREATE INDEX IF NOT EXISTS idx_oportunidades_custom ON oportunidades USING GIN (custom_data);
CREATE INDEX IF NOT EXISTS idx_proyectos_custom ON proyectos USING GIN (custom_data);
CREATE INDEX IF NOT EXISTS idx_contactos_custom ON contactos USING GIN (custom_data);
CREATE INDEX IF NOT EXISTS idx_empresas_custom ON empresas USING GIN (custom_data);
