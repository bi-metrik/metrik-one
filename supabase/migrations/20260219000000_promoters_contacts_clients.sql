-- ============================================================
-- Migration: Promoters + Contacts extensions + Clients extensions
-- For: Contactos v2 module (Promotores, Empresa inline, Referidos)
-- Date: 2026-02-19
-- ============================================================

-- 1. Create promoters table
CREATE TABLE IF NOT EXISTS promoters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  commission_pct NUMERIC DEFAULT 10,
  bank_name TEXT,
  bank_account TEXT,
  referrals_count INTEGER DEFAULT 0,
  won_projects INTEGER DEFAULT 0,
  accumulated_commission NUMERIC DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE promoters ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'promoters' AND policyname = 'promoters_ws') THEN
    CREATE POLICY "promoters_ws" ON promoters FOR ALL USING (workspace_id = current_user_workspace_id());
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_promoters_ws ON promoters(workspace_id);

-- 2. Add columns to contacts
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS promoter_id UUID REFERENCES promoters(id);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS referred_by_id UUID REFERENCES contacts(id);
ALTER TABLE contacts ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'Colombia';

-- 3. Add columns to clients (empresas)
ALTER TABLE clients ADD COLUMN IF NOT EXISTS razon_social TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS digito_verificacion TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS sector TEXT;
ALTER TABLE clients ADD COLUMN IF NOT EXISTS regimen_simple BOOLEAN DEFAULT false;
