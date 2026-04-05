-- ============================================================
-- NEGOCIOS ARCHITECTURE — Migración 1/3: Tablas core
-- Reemplaza el modelo Pipeline (oportunidades) + Proyectos
-- con una entidad unificada: negocios
-- ============================================================

-- ------------------------------------------------------------
-- 1. LINEAS DE NEGOCIO
-- workspace_id NULL = plantilla global ONE nativo
-- workspace_id NOT NULL = línea Clarity de un tenant
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS lineas_negocio (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id  UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  nombre        TEXT NOT NULL,
  descripcion   TEXT,
  tipo          TEXT NOT NULL DEFAULT 'clarity'
                  CHECK (tipo IN ('plantilla', 'clarity')),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lineas_negocio_workspace ON lineas_negocio(workspace_id);

-- RLS
ALTER TABLE lineas_negocio ENABLE ROW LEVEL SECURITY;

-- Plantillas globales: todos los autenticados pueden leer
CREATE POLICY "lineas_negocio_read_global" ON lineas_negocio
  FOR SELECT USING (
    workspace_id IS NULL
    OR workspace_id = current_user_workspace_id()
  );

-- Solo service_role escribe
CREATE POLICY "lineas_negocio_write_service" ON lineas_negocio
  FOR ALL USING (false);

-- ------------------------------------------------------------
-- 2. ETAPAS DE NEGOCIO
-- Pasos dentro de cada stage (venta / ejecucion / cobro)
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS etapas_negocio (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  linea_id    UUID NOT NULL REFERENCES lineas_negocio(id) ON DELETE CASCADE,
  stage       TEXT NOT NULL CHECK (stage IN ('venta', 'ejecucion', 'cobro')),
  nombre      TEXT NOT NULL,
  orden       INTEGER NOT NULL DEFAULT 0,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_etapas_negocio_linea ON etapas_negocio(linea_id);
CREATE INDEX idx_etapas_negocio_stage ON etapas_negocio(stage);

-- RLS
ALTER TABLE etapas_negocio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "etapas_negocio_read" ON etapas_negocio
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM lineas_negocio ln
      WHERE ln.id = etapas_negocio.linea_id
        AND (ln.workspace_id IS NULL OR ln.workspace_id = current_user_workspace_id())
    )
  );

CREATE POLICY "etapas_negocio_write_service" ON etapas_negocio
  FOR ALL USING (false);

-- ------------------------------------------------------------
-- 3. NEGOCIOS
-- Entidad unificada: nace en Venta, muere en Cobro o al cerrar
-- ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS negocios (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  linea_id              UUID REFERENCES lineas_negocio(id),
  empresa_id            UUID REFERENCES empresas(id) ON DELETE SET NULL,
  contacto_id           UUID REFERENCES contactos(id) ON DELETE SET NULL,

  -- Identidad
  nombre                TEXT NOT NULL,

  -- Precio: estimado libre hasta que hay cotización aprobada
  precio_estimado       NUMERIC(15,2),
  precio_aprobado       NUMERIC(15,2),

  -- Repositorio en nube (Drive, Dropbox, etc.)
  carpeta_url           TEXT,

  -- Posición en el flujo
  stage_actual          TEXT NOT NULL DEFAULT 'venta'
                          CHECK (stage_actual IN ('venta', 'ejecucion', 'cobro')),
  etapa_actual_id       UUID REFERENCES etapas_negocio(id) ON DELETE SET NULL,

  -- Estado de vida
  estado                TEXT NOT NULL DEFAULT 'activo'
                          CHECK (estado IN ('activo', 'cerrado')),
  tipo_cierre           TEXT CHECK (tipo_cierre IN ('finalizado', 'cancelado', 'perdido')),
  motivo_cierre         TEXT,
  lecciones_aprendidas  TEXT,
  balance_final         JSONB,  -- snapshot financiero al cierre por finalización

  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at             TIMESTAMPTZ
);

CREATE INDEX idx_negocios_workspace  ON negocios(workspace_id);
CREATE INDEX idx_negocios_estado     ON negocios(estado);
CREATE INDEX idx_negocios_stage      ON negocios(stage_actual);
CREATE INDEX idx_negocios_etapa      ON negocios(etapa_actual_id);
CREATE INDEX idx_negocios_empresa    ON negocios(empresa_id);
CREATE INDEX idx_negocios_contacto   ON negocios(contacto_id);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_negocios_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER negocios_updated_at
  BEFORE UPDATE ON negocios
  FOR EACH ROW EXECUTE FUNCTION update_negocios_updated_at();

-- RLS
ALTER TABLE negocios ENABLE ROW LEVEL SECURITY;

CREATE POLICY "negocios_workspace_isolation" ON negocios
  FOR ALL USING (workspace_id = current_user_workspace_id());
