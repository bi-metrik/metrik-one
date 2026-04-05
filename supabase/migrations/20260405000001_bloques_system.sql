-- ============================================================
-- NEGOCIOS ARCHITECTURE — Migración 2/3: Sistema de bloques
-- Biblioteca de tipos + configuración por tenant + instancias
-- ============================================================

-- ------------------------------------------------------------
-- 1. BLOQUE DEFINITIONS — Biblioteca global (11 tipos)
-- Define los tipos disponibles. Solo service_role escribe.
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bloque_definitions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tipo                  TEXT NOT NULL UNIQUE CHECK (tipo IN (
                          'datos', 'documentos', 'cotizacion', 'cobros',
                          'checklist', 'checklist_soporte', 'equipo',
                          'aprobacion', 'cronograma',
                          'resumen_financiero', 'ejecucion'
                        )),
  nombre                TEXT NOT NULL,
  descripcion           TEXT,
  -- Bloques de visualización: solo muestran, no pueden ser gate
  is_visualization      BOOLEAN NOT NULL DEFAULT false,
  -- Puede marcarse como gate en una etapa
  can_be_gate           BOOLEAN NOT NULL DEFAULT false,
  -- Tiene ítems internos (checklist, cronograma, documentos)
  supports_array_items  BOOLEAN NOT NULL DEFAULT false,
  -- Estado por defecto al activar
  default_estado        TEXT NOT NULL DEFAULT 'editable'
                          CHECK (default_estado IN ('editable', 'visible')),
  icon_name             TEXT,  -- nombre del ícono Lucide
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bloque_definitions ENABLE ROW LEVEL SECURITY;

-- Todos leen, nadie escribe (service_role bypasa RLS)
CREATE POLICY "bloque_definitions_read_all" ON bloque_definitions
  FOR SELECT USING (true);

CREATE POLICY "bloque_definitions_write_service" ON bloque_definitions
  FOR ALL USING (false);

-- ------------------------------------------------------------
-- 2. BLOQUE CONFIGS — Configuración por etapa por workspace
-- Qué bloques están activos en cada etapa de cada cliente
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bloque_configs (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  etapa_id              UUID NOT NULL REFERENCES etapas_negocio(id) ON DELETE CASCADE,
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  bloque_definition_id  UUID NOT NULL REFERENCES bloque_definitions(id),
  estado                TEXT NOT NULL DEFAULT 'editable'
                          CHECK (estado IN ('editable', 'visible')),
  orden                 INTEGER NOT NULL DEFAULT 0,
  -- Si true: el bloque debe estar completo para avanzar de etapa
  es_gate               BOOLEAN NOT NULL DEFAULT false,
  -- Parámetros específicos del tipo (ej: campos requeridos, items template)
  config_extra          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(etapa_id, workspace_id, bloque_definition_id)
);

CREATE INDEX idx_bloque_configs_etapa     ON bloque_configs(etapa_id);
CREATE INDEX idx_bloque_configs_workspace ON bloque_configs(workspace_id);

ALTER TABLE bloque_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bloque_configs_workspace_isolation" ON bloque_configs
  FOR ALL USING (workspace_id = current_user_workspace_id());

-- ------------------------------------------------------------
-- 3. NEGOCIO BLOQUES — Instancias runtime por negocio
-- Estado real de cada bloque en cada negocio específico
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS negocio_bloques (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_id        UUID NOT NULL REFERENCES negocios(id) ON DELETE CASCADE,
  bloque_config_id  UUID NOT NULL REFERENCES bloque_configs(id) ON DELETE CASCADE,
  -- Estado del bloque para este negocio
  estado            TEXT NOT NULL DEFAULT 'pendiente'
                      CHECK (estado IN ('pendiente', 'completo')),
  completado_por    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  completado_at     TIMESTAMPTZ,
  -- Datos flexibles del bloque (según tipo: campos, cotizacion_id, etc.)
  data              JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(negocio_id, bloque_config_id)
);

CREATE INDEX idx_negocio_bloques_negocio ON negocio_bloques(negocio_id);
CREATE INDEX idx_negocio_bloques_estado  ON negocio_bloques(estado);

CREATE OR REPLACE FUNCTION update_negocio_bloques_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER negocio_bloques_updated_at
  BEFORE UPDATE ON negocio_bloques
  FOR EACH ROW EXECUTE FUNCTION update_negocio_bloques_updated_at();

ALTER TABLE negocio_bloques ENABLE ROW LEVEL SECURITY;

CREATE POLICY "negocio_bloques_workspace_isolation" ON negocio_bloques
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM negocios n
      WHERE n.id = negocio_bloques.negocio_id
        AND n.workspace_id = current_user_workspace_id()
    )
  );

-- ------------------------------------------------------------
-- 4. BLOQUE ITEMS — Ítems internos de bloques con array
-- Checklist, cronograma, documentos, checklist_soporte
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS bloque_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  negocio_bloque_id UUID NOT NULL REFERENCES negocio_bloques(id) ON DELETE CASCADE,
  orden             INTEGER NOT NULL DEFAULT 0,
  label             TEXT NOT NULL,
  tipo              TEXT NOT NULL DEFAULT 'texto'
                      CHECK (tipo IN ('texto', 'checkbox', 'fecha', 'link', 'imagen_clipboard')),
  contenido         JSONB NOT NULL DEFAULT '{}'::jsonb,
  completado        BOOLEAN NOT NULL DEFAULT false,
  completado_por    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  completado_at     TIMESTAMPTZ,
  -- Para checklist_soporte y documentos: link al archivo en nube
  link_url          TEXT,
  -- Para imagen_clipboard: dato base64 o URL temporal
  imagen_data       TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bloque_items_bloque ON bloque_items(negocio_bloque_id);

ALTER TABLE bloque_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bloque_items_workspace_isolation" ON bloque_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM negocio_bloques nb
      JOIN negocios n ON n.id = nb.negocio_id
      WHERE nb.id = bloque_items.negocio_bloque_id
        AND n.workspace_id = current_user_workspace_id()
    )
  );

-- ------------------------------------------------------------
-- 5. FUNCIÓN: Verificar si una etapa tiene sus gates completos
-- Retorna true si se puede avanzar, false si hay bloqueo
-- ------------------------------------------------------------
CREATE OR REPLACE FUNCTION puede_avanzar_etapa(
  p_negocio_id UUID,
  p_etapa_id   UUID
) RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_gates_pendientes INTEGER;
BEGIN
  SELECT COUNT(*) INTO v_gates_pendientes
  FROM bloque_configs bc
  JOIN negocio_bloques nb ON nb.bloque_config_id = bc.id
                         AND nb.negocio_id = p_negocio_id
  WHERE bc.etapa_id = p_etapa_id
    AND bc.es_gate = true
    AND nb.estado = 'pendiente';

  RETURN v_gates_pendientes = 0;
END;
$$;
