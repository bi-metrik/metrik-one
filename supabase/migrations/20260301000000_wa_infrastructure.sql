-- ============================================================
-- Migration: WhatsApp Bot Infrastructure (Spec 98F)
-- Creates: pg_trgm extension, oportunidad_notas, trigram indexes
-- Date: 2026-03-01
-- ============================================================

-- 1. Enable pg_trgm for fuzzy matching (D85-D89)
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 2. oportunidad_notas (W09 — notas sobre oportunidades)
CREATE TABLE IF NOT EXISTS oportunidad_notas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  oportunidad_id UUID NOT NULL REFERENCES oportunidades(id) ON DELETE CASCADE,
  contenido TEXT NOT NULL,
  canal_registro TEXT DEFAULT 'app' CHECK (canal_registro IN ('app', 'whatsapp')),
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE oportunidad_notas ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'oportunidad_notas' AND policyname = 'oportunidad_notas_ws') THEN
    CREATE POLICY "oportunidad_notas_ws" ON oportunidad_notas FOR ALL USING (workspace_id = current_user_workspace_id());
  END IF;
END $$;
CREATE INDEX IF NOT EXISTS idx_oportunidad_notas_opp ON oportunidad_notas(oportunidad_id);
CREATE INDEX IF NOT EXISTS idx_oportunidad_notas_ws ON oportunidad_notas(workspace_id);

-- 3. Add soporte_pendiente to gastos (W02 v2.1 — D103)
ALTER TABLE gastos ADD COLUMN IF NOT EXISTS soporte_pendiente BOOLEAN DEFAULT false;

-- 4. Trigram indexes for fuzzy name matching (pg_trgm)
CREATE INDEX IF NOT EXISTS idx_contactos_nombre_trgm ON contactos USING gin (nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_proyectos_nombre_trgm ON proyectos USING gin (nombre gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_empresas_nombre_trgm ON empresas USING gin (nombre gin_trgm_ops);

-- 5. wa_message_log for rate limiting and debugging (D97)
CREATE TABLE IF NOT EXISTS wa_message_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id),
  phone TEXT NOT NULL,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  intent TEXT,
  message_preview TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_message_log_phone_time ON wa_message_log(phone, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_message_log_ws ON wa_message_log(workspace_id, created_at DESC);

-- No RLS on wa_message_log — only accessed by Edge Functions via service_role

-- ============================================================
-- 6. RPC Functions for fuzzy lookup (used by Edge Functions)
-- ============================================================

-- Find projects by fuzzy name match
CREATE OR REPLACE FUNCTION wa_find_projects(
  p_workspace_id UUID,
  p_hint TEXT,
  p_limit INT DEFAULT 5
) RETURNS TABLE (
  id UUID,
  nombre TEXT,
  estado TEXT,
  contacto_nombre TEXT,
  empresa_nombre TEXT,
  presupuesto_total NUMERIC,
  costo_acumulado NUMERIC,
  presupuesto_consumido_pct NUMERIC,
  horas_reales NUMERIC,
  horas_estimadas NUMERIC,
  facturado NUMERIC,
  cobrado NUMERIC,
  cartera NUMERIC
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    v.proyecto_id AS id,
    v.nombre,
    v.estado,
    v.contacto_nombre,
    v.empresa_nombre,
    v.presupuesto_total,
    v.costo_acumulado,
    v.presupuesto_consumido_pct,
    v.horas_reales,
    v.horas_estimadas,
    v.facturado,
    v.cobrado,
    v.cartera
  FROM v_proyecto_financiero v
  WHERE v.workspace_id = p_workspace_id
    AND v.estado = 'en_ejecucion'
    AND (
      similarity(v.nombre, p_hint) > 0.3
      OR similarity(COALESCE(v.contacto_nombre, ''), p_hint) > 0.3
      OR similarity(COALESCE(v.empresa_nombre, ''), p_hint) > 0.3
    )
  ORDER BY GREATEST(
    similarity(v.nombre, p_hint),
    similarity(COALESCE(v.contacto_nombre, ''), p_hint),
    similarity(COALESCE(v.empresa_nombre, ''), p_hint)
  ) DESC
  LIMIT p_limit;
$$;

-- Find contacts by fuzzy name match
CREATE OR REPLACE FUNCTION wa_find_contacts(
  p_workspace_id UUID,
  p_hint TEXT,
  p_limit INT DEFAULT 5
) RETURNS TABLE (
  id UUID,
  nombre TEXT,
  telefono TEXT,
  email TEXT,
  rol TEXT
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT id, nombre, telefono, email, rol
  FROM contactos
  WHERE workspace_id = p_workspace_id
    AND similarity(nombre, p_hint) > 0.3
  ORDER BY similarity(nombre, p_hint) DESC
  LIMIT p_limit;
$$;

-- Find opportunities by fuzzy match
CREATE OR REPLACE FUNCTION wa_find_opportunities(
  p_workspace_id UUID,
  p_hint TEXT,
  p_limit INT DEFAULT 5
) RETURNS TABLE (
  id UUID,
  descripcion TEXT,
  etapa TEXT,
  valor_estimado NUMERIC,
  contacto_nombre TEXT,
  empresa_nombre TEXT,
  updated_at TIMESTAMPTZ
) LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT
    o.id,
    o.descripcion,
    o.etapa,
    o.valor_estimado,
    c.nombre AS contacto_nombre,
    e.nombre AS empresa_nombre,
    o.updated_at
  FROM oportunidades o
  JOIN contactos c ON c.id = o.contacto_id
  JOIN empresas e ON e.id = o.empresa_id
  WHERE o.workspace_id = p_workspace_id
    AND o.etapa NOT IN ('ganada', 'perdida')
    AND (
      similarity(o.descripcion, p_hint) > 0.3
      OR similarity(c.nombre, p_hint) > 0.3
      OR similarity(e.nombre, p_hint) > 0.3
    )
  ORDER BY GREATEST(
    similarity(o.descripcion, p_hint),
    similarity(c.nombre, p_hint),
    similarity(e.nombre, p_hint)
  ) DESC
  LIMIT p_limit;
$$;
