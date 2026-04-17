-- ============================================================
-- Pausa de negocios (Fase 1 + Fase 2)
-- Permite al comercial pausar un negocio en stage venta con motivo
-- y fecha de reapertura (max 14d desde ultima actividad). Al 4to
-- intento → auto-perdido. Cron diario reactiva, alerta y cierra.
-- ============================================================

-- 1. Columnas en negocios
ALTER TABLE negocios
  ADD COLUMN IF NOT EXISTS pausado boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS pausado_hasta date,
  ADD COLUMN IF NOT EXISTS motivo_pausa text,
  ADD COLUMN IF NOT EXISTS motivo_pausa_detalle text,
  ADD COLUMN IF NOT EXISTS veces_pausado integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ultimo_pausado_at timestamptz;

-- Indice para queries del filtro default (pipeline activo excluye pausados)
CREATE INDEX IF NOT EXISTS idx_negocios_workspace_pausado
  ON negocios (workspace_id, pausado)
  WHERE estado IN ('abierto', 'activo');

-- Indice para el cron de SLA
CREATE INDEX IF NOT EXISTS idx_negocios_pausados_hasta
  ON negocios (pausado_hasta)
  WHERE pausado = true;

-- Comentarios para claridad
COMMENT ON COLUMN negocios.pausado IS 'Negocio pausado por el comercial. Se oculta del pipeline activo por default.';
COMMENT ON COLUMN negocios.pausado_hasta IS 'Fecha de reapertura automatica. Max 14 dias desde ultima actividad al pausar.';
COMMENT ON COLUMN negocios.motivo_pausa IS 'Lista cerrada: silencio|decision_interna|esperando_credito|objecion_precio|timing|otro';
COMMENT ON COLUMN negocios.motivo_pausa_detalle IS 'Texto libre cuando motivo_pausa = otro';
COMMENT ON COLUMN negocios.veces_pausado IS 'Contador. Al llegar a 3 y pausar otra vez, auto-perdido.';
COMMENT ON COLUMN negocios.ultimo_pausado_at IS 'Timestamp de la ultima pausa. Usado por safety-net de 24h.';

-- 2. Flags por workspace en .modules (JSONB)
-- pausa_enabled: master switch de la feature (UI + acciones)
-- pausa_sla_auto_enabled: cron SLA activo (reactivacion + escalada + auto-perdido)
UPDATE workspaces
SET modules = COALESCE(modules, '{}'::jsonb) || jsonb_build_object(
  'pausa_enabled', true,
  'pausa_sla_auto_enabled', false
)
WHERE slug = 'soena';

-- Resto de workspaces: solo master switch OFF por default (no altera si ya existe)
UPDATE workspaces
SET modules = COALESCE(modules, '{}'::jsonb) || jsonb_build_object(
  'pausa_enabled', false,
  'pausa_sla_auto_enabled', false
)
WHERE slug != 'soena'
  AND NOT (modules ? 'pausa_enabled');
