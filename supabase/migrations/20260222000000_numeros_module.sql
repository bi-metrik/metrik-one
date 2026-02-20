-- ═══════════════════════════════════════════════════════
-- Migration: Módulo Mis Números v2
-- Tables: config_metas, saldos_banco, streaks
-- ═══════════════════════════════════════════════════════

-- ── 1. config_metas ──────────────────────────────────
CREATE TABLE IF NOT EXISTS config_metas (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  mes DATE NOT NULL,                          -- primer día del mes (YYYY-MM-01)
  meta_ventas_mensual NUMERIC(15,2),
  meta_recaudo_mensual NUMERIC(15,2),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, mes)
);

ALTER TABLE config_metas ENABLE ROW LEVEL SECURITY;
CREATE POLICY "config_metas_ws" ON config_metas
  FOR ALL USING (workspace_id = current_user_workspace_id());

CREATE INDEX idx_config_metas_ws_mes ON config_metas(workspace_id, mes DESC);

-- ── 2. saldos_banco ──────────────────────────────────
CREATE TABLE IF NOT EXISTS saldos_banco (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  saldo_real NUMERIC(15,2) NOT NULL,
  saldo_teorico NUMERIC(15,2) NOT NULL,       -- calculado al momento del registro
  diferencia NUMERIC(15,2) NOT NULL,          -- saldo_real - saldo_teorico
  fecha TIMESTAMPTZ DEFAULT NOW(),
  registrado_via VARCHAR(20) NOT NULL DEFAULT 'app',  -- 'app' | 'whatsapp' | 'push'
  nota TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE saldos_banco ENABLE ROW LEVEL SECURITY;
CREATE POLICY "saldos_banco_ws" ON saldos_banco
  FOR ALL USING (workspace_id = current_user_workspace_id());

CREATE INDEX idx_saldos_banco_ws_fecha ON saldos_banco(workspace_id, fecha DESC);

-- ── 3. streaks ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS streaks (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  tipo VARCHAR(30) NOT NULL DEFAULT 'conciliacion',
  semanas_actuales INTEGER DEFAULT 0,
  semanas_record INTEGER DEFAULT 0,
  ultima_actualizacion TIMESTAMPTZ,
  streak_inicio DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, tipo)
);

ALTER TABLE streaks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "streaks_ws" ON streaks
  FOR ALL USING (workspace_id = current_user_workspace_id());
