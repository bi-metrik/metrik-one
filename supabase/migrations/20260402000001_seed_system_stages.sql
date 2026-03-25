-- =====================================================
-- [98I] Seed etapas de sistema para workspaces existentes
-- + Trigger para nuevos workspaces
-- =====================================================

-- ── Seed etapas de sistema para todos los workspaces ya existentes ──

-- Pipeline (oportunidad): 7 etapas que mapean a EtapaPipeline
INSERT INTO workspace_stages
  (workspace_id, entidad, nombre, slug, color, orden, es_sistema, sistema_slug, es_terminal)
SELECT
  w.id,
  'oportunidad',
  etapa.nombre,
  etapa.slug,
  etapa.color,
  etapa.orden,
  true,
  etapa.slug,
  etapa.es_terminal
FROM workspaces w
CROSS JOIN (VALUES
  ('Por contactar',        'lead_nuevo',        '#9CA3AF', 0, false),
  ('Primer contacto',      'contacto_inicial',  '#3B82F6', 1, false),
  ('Necesidad clara',      'discovery_hecha',   '#6366F1', 2, false),
  ('Propuesta presentada', 'propuesta_enviada', '#EAB308', 3, false),
  ('Negociacion',          'negociacion',       '#F97316', 4, false),
  ('Ganada',               'ganada',            '#10B981', 5, true),
  ('Perdida',              'perdida',           '#EF4444', 6, true)
) AS etapa(nombre, slug, color, orden, es_terminal)
ON CONFLICT (workspace_id, entidad, slug) DO NOTHING;

-- Proyectos (proyecto): 6 estados que mapean a ProjectStatus
INSERT INTO workspace_stages
  (workspace_id, entidad, nombre, slug, color, orden, es_sistema, sistema_slug, es_terminal)
SELECT
  w.id,
  'proyecto',
  etapa.nombre,
  etapa.slug,
  etapa.color,
  etapa.orden,
  true,
  etapa.slug,
  etapa.es_terminal
FROM workspaces w
CROSS JOIN (VALUES
  ('Activo',     'active',    '#10B981', 0, false),
  ('Pausado',    'paused',    '#EAB308', 1, false),
  ('Reproceso',  'rework',    '#F97316', 2, false),
  ('Completado', 'completed', '#3B82F6', 3, false),
  ('Cerrado',    'closed',    '#6B7280', 4, true),
  ('Cancelado',  'cancelled', '#EF4444', 5, true)
) AS etapa(nombre, slug, color, orden, es_terminal)
ON CONFLICT (workspace_id, entidad, slug) DO NOTHING;

-- ── Funcion trigger: crea etapas de sistema al crear un workspace nuevo ──

CREATE OR REPLACE FUNCTION create_default_stages_for_workspace()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO workspace_stages
    (workspace_id, entidad, nombre, slug, color, orden, es_sistema, sistema_slug, es_terminal)
  VALUES
    -- Pipeline
    (NEW.id, 'oportunidad', 'Por contactar',        'lead_nuevo',        '#9CA3AF', 0, true, 'lead_nuevo',        false),
    (NEW.id, 'oportunidad', 'Primer contacto',       'contacto_inicial',  '#3B82F6', 1, true, 'contacto_inicial',  false),
    (NEW.id, 'oportunidad', 'Necesidad clara',       'discovery_hecha',   '#6366F1', 2, true, 'discovery_hecha',   false),
    (NEW.id, 'oportunidad', 'Propuesta presentada',  'propuesta_enviada', '#EAB308', 3, true, 'propuesta_enviada', false),
    (NEW.id, 'oportunidad', 'Negociacion',           'negociacion',       '#F97316', 4, true, 'negociacion',       false),
    (NEW.id, 'oportunidad', 'Ganada',                'ganada',            '#10B981', 5, true, 'ganada',            true),
    (NEW.id, 'oportunidad', 'Perdida',               'perdida',           '#EF4444', 6, true, 'perdida',           true),
    -- Proyectos
    (NEW.id, 'proyecto',    'Activo',                'active',            '#10B981', 0, true, 'active',            false),
    (NEW.id, 'proyecto',    'Pausado',               'paused',            '#EAB308', 1, true, 'paused',            false),
    (NEW.id, 'proyecto',    'Reproceso',             'rework',            '#F97316', 2, true, 'rework',            false),
    (NEW.id, 'proyecto',    'Completado',            'completed',         '#3B82F6', 3, true, 'completed',         false),
    (NEW.id, 'proyecto',    'Cerrado',               'closed',            '#6B7280', 4, true, 'closed',            true),
    (NEW.id, 'proyecto',    'Cancelado',             'cancelled',         '#EF4444', 5, true, 'cancelled',         true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Eliminar trigger previo si existe para evitar duplicado en re-run
DROP TRIGGER IF EXISTS trigger_default_stages_on_workspace_create ON workspaces;

CREATE TRIGGER trigger_default_stages_on_workspace_create
  AFTER INSERT ON workspaces
  FOR EACH ROW EXECUTE FUNCTION create_default_stages_for_workspace();
