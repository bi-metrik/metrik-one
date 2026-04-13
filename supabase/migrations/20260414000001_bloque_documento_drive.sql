-- ============================================================
-- BloqueDocumento + Google Drive integration
-- Adds 'documento' type (single doc per bloque, Drive export, configurable AI extraction)
-- ============================================================

-- 1. Update CHECK constraint to include 'documento' and 'historial'
ALTER TABLE bloque_definitions DROP CONSTRAINT IF EXISTS bloque_definitions_tipo_check;
ALTER TABLE bloque_definitions ADD CONSTRAINT bloque_definitions_tipo_check
  CHECK (tipo IN (
    'datos', 'documentos', 'documento', 'cotizacion', 'cobros',
    'checklist', 'checklist_soporte', 'equipo', 'aprobacion',
    'cronograma', 'resumen_financiero', 'ejecucion', 'historial'
  ));

-- 2. Insert definition for 'documento' type
INSERT INTO bloque_definitions (id, tipo, nombre, descripcion, can_be_gate, supports_array_items, default_estado, icon_name)
VALUES (
  gen_random_uuid(),
  'documento',
  'Documento',
  'Carga de documento individual con exportación a Drive y extracción AI opcional',
  true,
  false,
  'editable',
  'FileText'
)
ON CONFLICT (tipo) DO NOTHING;

-- 3. Add drive_folder_id to workspaces (Google Drive folder for document storage)
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS drive_folder_id TEXT;
