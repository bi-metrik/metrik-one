-- ============================================================
-- Multi-proceso: parametrización de líneas de negocio por tenant
-- Permite que un workspace tenga etapas y campos exclusivos
-- de un proceso específico (ej: 've', 'kaeser', 'incentivos_b2b').
-- proceso = NULL = aplica a todas las líneas (etapa estándar).
-- proceso = 've'  = exclusivo de esa línea de negocio.
-- ============================================================

-- Agregar columna proceso a workspace_stages
ALTER TABLE workspace_stages
  ADD COLUMN IF NOT EXISTS proceso TEXT DEFAULT NULL;

-- Índice de soporte para filtros por proceso en kanban
CREATE INDEX IF NOT EXISTS idx_workspace_stages_proceso
  ON workspace_stages(workspace_id, entidad, proceso, orden);

-- Agregar condicion_visibilidad a custom_fields
-- NULL = siempre visible
-- {"campo": "linea_negocio", "valor": "ve"} = solo si ese campo tiene ese valor
ALTER TABLE custom_fields
  ADD COLUMN IF NOT EXISTS condicion_visibilidad JSONB DEFAULT NULL;
