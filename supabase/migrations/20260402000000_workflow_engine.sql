-- =====================================================
-- [98I] Workflow Engine — Etapas personalizadas + Reglas de transicion
-- workspace_stages, stage_transition_rules, evaluate_stage_rules()
-- =====================================================

-- ── workspace_stages: etapas por workspace y entidad ──

CREATE TABLE IF NOT EXISTS workspace_stages (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entidad      TEXT NOT NULL CHECK (entidad IN ('oportunidad', 'proyecto')),
  nombre       TEXT NOT NULL,
  slug         TEXT NOT NULL,
  color        TEXT DEFAULT '#6B7280',
  orden        INT NOT NULL DEFAULT 0,
  es_sistema   BOOLEAN DEFAULT false,  -- etapas del sistema, no se pueden borrar
  sistema_slug TEXT DEFAULT NULL,      -- mapea a EtapaPipeline o ProjectStatus interno
  es_terminal  BOOLEAN DEFAULT false,  -- bloquea transiciones despues de este estado
  activo       BOOLEAN DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, entidad, slug)
);

CREATE INDEX IF NOT EXISTS idx_workspace_stages_lookup
  ON workspace_stages(workspace_id, entidad, activo, orden);

ALTER TABLE workspace_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "workspace_stages_isolation" ON workspace_stages
  FOR ALL USING (workspace_id = current_user_workspace_id());

-- ── stage_transition_rules: reglas de transicion entre etapas ──

CREATE TABLE IF NOT EXISTS stage_transition_rules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  entidad         TEXT NOT NULL CHECK (entidad IN ('oportunidad', 'proyecto')),
  desde_stage_id  UUID REFERENCES workspace_stages(id) ON DELETE CASCADE,  -- NULL = cualquier etapa
  hasta_stage_id  UUID NOT NULL REFERENCES workspace_stages(id) ON DELETE CASCADE,
  tipo            TEXT NOT NULL CHECK (tipo IN ('manual', 'auto', 'condicional')),
  condicion_tipo  TEXT CHECK (condicion_tipo IN (
    'all_required_fields',
    'checklist_complete',
    'custom_field_value'
  )),
  condicion_config JSONB DEFAULT '{}',
  activo          BOOLEAN DEFAULT true,
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_stage_rules_lookup
  ON stage_transition_rules(workspace_id, entidad, desde_stage_id, activo);

ALTER TABLE stage_transition_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "stage_transition_rules_isolation" ON stage_transition_rules
  FOR ALL USING (workspace_id = current_user_workspace_id());

-- ── evaluate_stage_rules: evalua si hay transicion automatica disponible ──
-- Retorna el UUID de la etapa destino si alguna regla condicional se cumple,
-- o NULL si no hay transicion automatica aplicable.

CREATE OR REPLACE FUNCTION evaluate_stage_rules(
  p_entidad_id   UUID,
  p_workspace_id UUID,
  p_entidad_tipo TEXT
) RETURNS UUID AS $$
DECLARE
  v_rule            stage_transition_rules%ROWTYPE;
  v_current_slug    TEXT;
  v_current_stage_id UUID;
  v_custom_data     JSONB;
  v_field_value     TEXT;
  v_checklist       JSONB;
  v_all_checked     BOOLEAN;
BEGIN
  -- Obtener estado actual y custom_data segun entidad
  IF p_entidad_tipo = 'oportunidad' THEN
    SELECT etapa, custom_data
      INTO v_current_slug, v_custom_data
      FROM oportunidades
     WHERE id = p_entidad_id
       AND workspace_id = p_workspace_id;
  ELSIF p_entidad_tipo = 'proyecto' THEN
    SELECT estado, custom_data
      INTO v_current_slug, v_custom_data
      FROM proyectos
     WHERE id = p_entidad_id
       AND workspace_id = p_workspace_id;
  END IF;

  IF v_current_slug IS NULL THEN
    RETURN NULL;
  END IF;

  -- Normalizar custom_data a objeto vacio si es NULL
  v_custom_data := COALESCE(v_custom_data, '{}');

  -- Resolver stage_id actual desde workspace_stages
  -- Busca primero por sistema_slug (etapas de sistema), luego por slug
  SELECT id INTO v_current_stage_id
    FROM workspace_stages
   WHERE workspace_id = p_workspace_id
     AND entidad = p_entidad_tipo
     AND (sistema_slug = v_current_slug OR slug = v_current_slug)
     AND activo = true
   LIMIT 1;

  -- Si no hay etapa mapeada, no se puede evaluar reglas
  IF v_current_stage_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Evaluar reglas condicionales activas para la etapa actual
  -- Orden: por created_at ASC (la regla mas antigua tiene prioridad)
  FOR v_rule IN
    SELECT *
      FROM stage_transition_rules
     WHERE workspace_id = p_workspace_id
       AND entidad = p_entidad_tipo
       AND tipo = 'condicional'
       AND activo = true
       AND (desde_stage_id = v_current_stage_id OR desde_stage_id IS NULL)
     ORDER BY created_at ASC
  LOOP
    IF v_rule.condicion_tipo = 'custom_field_value' THEN
      -- Verificar que un campo custom tenga un valor especifico
      v_field_value := v_custom_data ->> (v_rule.condicion_config->>'field_slug');
      IF v_field_value = (v_rule.condicion_config->>'value') THEN
        RETURN v_rule.hasta_stage_id;
      END IF;

    ELSIF v_rule.condicion_tipo = 'checklist_complete' THEN
      -- Verificar que todos los items de un checklist esten marcados
      v_checklist := v_custom_data -> (v_rule.condicion_config->>'field_slug');
      IF v_checklist IS NOT NULL AND jsonb_typeof(v_checklist) = 'array' THEN
        SELECT bool_and((item->>'checked')::boolean)
          INTO v_all_checked
          FROM jsonb_array_elements(v_checklist) AS item;
        IF v_all_checked = true THEN
          RETURN v_rule.hasta_stage_id;
        END IF;
      END IF;

    ELSIF v_rule.condicion_tipo = 'all_required_fields' THEN
      -- Verificar que todos los custom_fields obligatorios esten llenos
      IF NOT EXISTS (
        SELECT 1
          FROM custom_fields cf
         WHERE cf.workspace_id = p_workspace_id
           AND cf.entidad = p_entidad_tipo
           AND cf.obligatorio = true
           AND cf.activo = true
           AND (v_custom_data ->> cf.slug IS NULL OR v_custom_data ->> cf.slug = '')
      ) THEN
        RETURN v_rule.hasta_stage_id;
      END IF;
    END IF;
  END LOOP;

  RETURN NULL; -- Sin transicion automatica aplicable
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
