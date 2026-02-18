-- ============================================================
-- MéTRIK ONE — Schema Completo
-- Sprint 0: Fundaciones Técnicas
-- Alineado a ONE_Plan_Sprints_v1.md (245 decisiones)
-- Fecha: 18/02/2026
-- ============================================================

-- ============================================================
-- EXTENSIONES
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ============================================================
-- 1. WORKSPACES (Multi-tenant — D5, D165)
-- Cada cuenta = 1 workspace. Preparado para multi-workspace Phase 2.
-- ============================================================
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,

  -- Suscripción (D204 — 6 estados)
  subscription_status TEXT NOT NULL DEFAULT 'trial',
    -- trial | active_pro | active_pro_plus | past_due | free | read_only
  subscription_started_at TIMESTAMPTZ DEFAULT now(),
  subscription_expires_at TIMESTAMPTZ,
  trial_ends_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '14 days'),

  -- Onboarding
  profession TEXT,
    -- arquitecto | ingeniero | disenador | abogado | contador | medico | consultor | otro
  years_independent INTEGER,
  onboarding_completed BOOLEAN DEFAULT false,

  -- Meta
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- SLUG AUTO-GENERATION
-- ============================================================
CREATE OR REPLACE FUNCTION generate_workspace_slug()
RETURNS TRIGGER AS $$
DECLARE
  base_slug TEXT;
  final_slug TEXT;
  counter INTEGER := 0;
BEGIN
  base_slug := NEW.name;
  base_slug := lower(base_slug);
  base_slug := regexp_replace(base_slug, '\s*(s\.?a\.?s\.?|ltda\.?|s\.?a\.?|e\.?u\.?)\s*$', '', 'i');
  base_slug := translate(base_slug, 'áéíóúñÁÉÍÓÚÑ', 'aeiounAEIOUN');
  base_slug := regexp_replace(base_slug, '[^a-z0-9]+', '-', 'g');
  base_slug := trim(both '-' from base_slug);
  base_slug := left(base_slug, 20);
  base_slug := trim(both '-' from base_slug);

  IF length(base_slug) < 3 THEN
    base_slug := base_slug || '-ws';
  END IF;

  final_slug := base_slug;

  WHILE final_slug IN ('www', 'api', 'admin', 'app', 'test', 'demo', 'staging', 'mail', 'ftp')
        OR EXISTS (SELECT 1 FROM workspaces WHERE slug = final_slug) LOOP
    counter := counter + 1;
    final_slug := left(base_slug, 17) || '-' || counter;
  END LOOP;

  NEW.slug := final_slug;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_workspace_slug
  BEFORE INSERT ON workspaces
  FOR EACH ROW
  WHEN (NEW.slug IS NULL)
  EXECUTE FUNCTION generate_workspace_slug();

-- ============================================================
-- 2. PROFILES (Extiende Supabase Auth — D163-D170)
-- ============================================================
CREATE TABLE profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  full_name TEXT,
  role TEXT NOT NULL DEFAULT 'owner',
    -- owner | admin | operator | read_only (D97, D166)
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- HELPER: obtener workspace_id del usuario autenticado
-- ============================================================
CREATE OR REPLACE FUNCTION current_user_workspace_id()
RETURNS UUID AS $$
  SELECT workspace_id FROM profiles WHERE id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- ============================================================
-- 3. FISCAL PROFILES (D2, D234-D236 — Wizard Felipe)
-- Separado de workspace para limpieza y escalabilidad
-- ============================================================
CREATE TABLE fiscal_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID UNIQUE NOT NULL REFERENCES workspaces(id),
  person_type TEXT,                       -- natural | juridica
  tax_regime TEXT,                        -- responsable_iva | no_responsable_iva | regimen_simple
  ciiu TEXT,
  self_withholder BOOLEAN DEFAULT false,
  ica_rate NUMERIC,                       -- tarifa ICA municipal (‰)
  ica_city TEXT,                          -- Ciudad para ICA
  is_complete BOOLEAN DEFAULT false,      -- ¿Wizard Felipe completado?
  is_estimated BOOLEAN DEFAULT false,     -- ¿Valores estimados (inferencia)?
  nudge_count INTEGER DEFAULT 0,          -- Max 3 nudges (D236)
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 4. FISCAL PARAMS (D94 — Tabla de parámetros fiscales)
-- Valores actualizables sin redeploy
-- ============================================================
CREATE TABLE fiscal_params (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key TEXT UNIQUE NOT NULL,
  value NUMERIC NOT NULL,
  description TEXT,
  valid_from DATE,
  valid_to DATE,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 5. CLIENTS (D29, D30 — Catálogo clientes con perfil fiscal)
-- ============================================================
CREATE TABLE clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  nit TEXT,                               -- Opcional primera creación (D30)
  person_type TEXT,                       -- natural | juridica
  tax_regime TEXT,
  gran_contribuyente BOOLEAN DEFAULT false,
  agente_retenedor BOOLEAN DEFAULT true,  -- Default conservador (D51)
  contact_name TEXT,
  contact_phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 6. EXPENSE CATEGORIES (D95 — 9 categorías, sin "Otro")
-- Se crean automáticamente al crear workspace (seed trigger)
-- ============================================================
CREATE TABLE expense_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  is_deductible TEXT NOT NULL DEFAULT 'yes',   -- yes | no | partial
  deduction_pct NUMERIC DEFAULT 100,
  sort_order INTEGER,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 7. OPPORTUNITIES (D171-D174, D176 — Pipeline 6 etapas)
-- ============================================================
CREATE TABLE opportunities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  client_id UUID REFERENCES clients(id),
  name TEXT NOT NULL,
  estimated_value NUMERIC NOT NULL DEFAULT 0,
  stage TEXT NOT NULL DEFAULT 'lead',
    -- lead | prospect | quotation | negotiation | won | lost (D171 — 6 etapas)
  probability INTEGER NOT NULL DEFAULT 10,
  source TEXT,                            -- referido | linkedin | web | otro
  lost_reason TEXT,                       -- Obligatorio en perdida (D174)
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 8. OPPORTUNITY STAGE HISTORY
-- ============================================================
CREATE TABLE opportunity_stage_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  opportunity_id UUID NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  from_stage TEXT,
  to_stage TEXT NOT NULL,
  changed_at TIMESTAMPTZ DEFAULT now(),
  changed_by UUID REFERENCES auth.users(id)
);

-- ============================================================
-- 9. QUOTES (D185-D186 — 4 estados cotización)
-- ============================================================
CREATE TABLE quotes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  client_id UUID REFERENCES clients(id),
  opportunity_id UUID REFERENCES opportunities(id),
  mode TEXT NOT NULL DEFAULT 'flash',     -- flash | detailed (D84)
  description TEXT,
  -- Montos
  total_price NUMERIC NOT NULL DEFAULT 0,
  estimated_cost NUMERIC DEFAULT 0,
  iva_amount NUMERIC DEFAULT 0,
  retention_amount NUMERIC DEFAULT 0,     -- Retención estimada
  net_amount NUMERIC DEFAULT 0,           -- "Te consignan" (D32)
  profit_amount NUMERIC DEFAULT 0,        -- "Te queda limpio" (D33)
  margin_pct NUMERIC DEFAULT 0,
  -- Estado (D185)
  status TEXT NOT NULL DEFAULT 'draft',   -- draft | sent | accepted | rejected
  sent_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ,
  valid_until DATE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 10. QUOTE ITEMS (D85 — 6 rubros mapean a 9 categorías)
-- ============================================================
CREATE TABLE quote_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  quote_id UUID NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  item_type TEXT NOT NULL,
    -- my_work | third_parties | materials | travel | software | professional_services
  description TEXT NOT NULL,
  quantity NUMERIC NOT NULL DEFAULT 1,
  unit_price NUMERIC NOT NULL DEFAULT 0,
  total NUMERIC GENERATED ALWAYS AS (ROUND(quantity * unit_price, 0)) STORED,
  sort_order INTEGER DEFAULT 0
);

-- ============================================================
-- 11. PROJECTS (D175, D177-D181 — 6 estados)
-- ============================================================
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  client_id UUID REFERENCES clients(id),
  opportunity_id UUID REFERENCES opportunities(id),
  quote_id UUID REFERENCES quotes(id),
  name TEXT NOT NULL,
  approved_budget NUMERIC DEFAULT 0,
  start_date DATE,
  estimated_end_date DATE,
  status TEXT NOT NULL DEFAULT 'active',
    -- active | paused | completed | rework | cancelled | closed (D175)
  progress_pct INTEGER DEFAULT 0 CHECK (progress_pct >= 0 AND progress_pct <= 100),
  -- Rework (D178-D179)
  rework_reason TEXT,                     -- Obligatorio al entrar en rework
  rework_cost NUMERIC DEFAULT 0,          -- Bolsa separada costos rework
  -- Cierre (D180)
  closed_at TIMESTAMPTZ,
  actual_cost NUMERIC,
  actual_margin_pct NUMERIC,
  lessons_learned TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 12. TIME ENTRIES (Horas — Sprint 5)
-- ============================================================
CREATE TABLE time_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  user_id UUID REFERENCES auth.users(id),
  entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
  hours NUMERIC NOT NULL CHECK (hours > 0),
  activity TEXT,
  source TEXT DEFAULT 'app',              -- app | whatsapp
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 13. EXPENSES (D44 — 3 capas de gastos)
-- Capa 1: Gastos fijos (fixed_expenses)
-- Capa 2: Gastos puntuales/operativos (expenses sin project_id)
-- Capa 3: Gastos directos proyecto (expenses con project_id)
-- ============================================================
CREATE TABLE expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  project_id UUID REFERENCES projects(id),   -- NULL = gasto operativo (capa 2)
  category_id UUID NOT NULL REFERENCES expense_categories(id),
  expense_date DATE NOT NULL DEFAULT CURRENT_DATE,
  amount NUMERIC NOT NULL CHECK (amount > 0),
  description TEXT,
  support_url TEXT,                       -- URL imagen en Supabase Storage
  is_rework BOOLEAN DEFAULT false,        -- ¿Es gasto de rework? (D179)
  source TEXT DEFAULT 'app',              -- app | whatsapp
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 14. FIXED EXPENSES (D44, D239-D240 — Gastos fijos config)
-- ============================================================
CREATE TABLE fixed_expenses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  category_id UUID REFERENCES expense_categories(id),
  description TEXT NOT NULL,
  monthly_amount NUMERIC NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 15. INVOICES / PAYMENTS (D182-D184 — Cobros tracking)
-- NO facturación electrónica. Solo tracking "Lo que me deben" / "Me pagaron"
-- ============================================================
CREATE TABLE invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  concept TEXT NOT NULL,
  gross_amount NUMERIC NOT NULL CHECK (gross_amount > 0),  -- Cobro bruto (D183)
  due_date DATE,
  status TEXT NOT NULL DEFAULT 'scheduled',
    -- scheduled | partial | collected | overdue (D183)
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  invoice_id UUID NOT NULL REFERENCES invoices(id),
  net_received NUMERIC NOT NULL CHECK (net_received > 0),  -- Neto consignado (D183)
  payment_date DATE NOT NULL DEFAULT CURRENT_DATE,
  payment_method TEXT NOT NULL DEFAULT 'transfer',
  retention_applied NUMERIC NOT NULL DEFAULT 0,            -- Retención real aplicada
  source TEXT DEFAULT 'app',
  reference TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 16. SUBSCRIPTIONS (D204-D218 — Billing)
-- Tabla separada para historial de suscripciones
-- ============================================================
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  plan TEXT NOT NULL,                     -- trial | free | pro | pro_plus
  status TEXT NOT NULL DEFAULT 'active',  -- active | past_due | cancelled
  payment_provider TEXT,                  -- wompi
  payment_method TEXT,                    -- card | pse
  amount NUMERIC,
  currency TEXT DEFAULT 'COP',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancelled_at TIMESTAMPTZ,
  cancel_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 17. BOT SESSIONS (D224 — WhatsApp Bot, Sprint 7)
-- ============================================================
CREATE TABLE bot_sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_phone TEXT NOT NULL,
  intent TEXT,                            -- register_expense | register_hours | register_payment | query | correct
  state TEXT DEFAULT 'started',           -- started | collecting | confirming | completed | expired
  context JSONB DEFAULT '{}',
  started_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT (now() + INTERVAL '5 minutes')
);

-- ============================================================
-- 18. WA COLLABORATORS (D60-D65, D170 — Sprint 8)
-- ============================================================
CREATE TABLE wa_collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  requires_approval BOOLEAN DEFAULT false,  -- D65: default directo
  consent_accepted_at TIMESTAMPTZ,          -- Ley 1581 (D170)
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 19. NOTIFICATIONS (Cross-module)
-- ============================================================
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id UUID REFERENCES auth.users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  action_url TEXT,
  is_read BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 20. REFERRALS (D102-D104 — Sprint 14)
-- ============================================================
CREATE TABLE referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  referrer_workspace_id UUID REFERENCES workspaces(id),
  referral_code TEXT UNIQUE NOT NULL,     -- Link memorable (D104)
  status TEXT NOT NULL DEFAULT 'pending', -- pending | signed_up | paid | rewarded
  months_rewarded INTEGER DEFAULT 0,      -- Max 12 acumulativo (D103)
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 21. HEALTH SCORES (D105-D106 — Sprint 13, interno)
-- NUNCA visible al usuario
-- ============================================================
CREATE TABLE health_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  actions_per_week NUMERIC DEFAULT 0,
  days_inactive INTEGER DEFAULT 0,
  questions_complete INTEGER DEFAULT 0,   -- De las 5 preguntas MéTRIK
  wa_collaborators_active INTEGER DEFAULT 0,
  summary_open_rate NUMERIC DEFAULT 0,
  score NUMERIC DEFAULT 0,               -- Calculated composite
  calculated_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 22. TESTIMONIALS (D118-D120 — Sprint 14)
-- ============================================================
CREATE TABLE testimonials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  answer_1 TEXT,                          -- 3 preguntas (D119)
  answer_2 TEXT,
  answer_3 TEXT,
  marketing_consent BOOLEAN DEFAULT false, -- D120
  status TEXT DEFAULT 'draft',            -- draft | approved | published
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- 23. AUDIT LOG
-- ============================================================
CREATE TABLE audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  user_id UUID REFERENCES auth.users(id),
  action TEXT NOT NULL,                   -- create | update | delete | stage_change
  table_name TEXT NOT NULL,
  record_id UUID,
  old_data JSONB,
  new_data JSONB,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- ============================================================
-- ROW LEVEL SECURITY — Todas las tablas por workspace_id (D5)
-- ============================================================

-- Workspaces
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ws_select" ON workspaces FOR SELECT USING (id = current_user_workspace_id());
CREATE POLICY "ws_update" ON workspaces FOR UPDATE USING (id = current_user_workspace_id());

-- Profiles
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles_select" ON profiles FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "profiles_update" ON profiles FOR UPDATE USING (id = auth.uid());
CREATE POLICY "profiles_insert" ON profiles FOR INSERT WITH CHECK (id = auth.uid());

-- Fiscal Profiles
ALTER TABLE fiscal_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fp_select" ON fiscal_profiles FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "fp_insert" ON fiscal_profiles FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());
CREATE POLICY "fp_update" ON fiscal_profiles FOR UPDATE USING (workspace_id = current_user_workspace_id());

-- Fiscal Params (lectura pública, escritura solo admin)
ALTER TABLE fiscal_params ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fp_select_all" ON fiscal_params FOR SELECT USING (true);

-- Clients
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clients_select" ON clients FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "clients_insert" ON clients FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());
CREATE POLICY "clients_update" ON clients FOR UPDATE USING (workspace_id = current_user_workspace_id());
CREATE POLICY "clients_delete" ON clients FOR DELETE USING (workspace_id = current_user_workspace_id());

-- Expense Categories
ALTER TABLE expense_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ec_select" ON expense_categories FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "ec_insert" ON expense_categories FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());
CREATE POLICY "ec_update" ON expense_categories FOR UPDATE USING (workspace_id = current_user_workspace_id());

-- Opportunities
ALTER TABLE opportunities ENABLE ROW LEVEL SECURITY;
CREATE POLICY "opp_select" ON opportunities FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "opp_insert" ON opportunities FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());
CREATE POLICY "opp_update" ON opportunities FOR UPDATE USING (workspace_id = current_user_workspace_id());
CREATE POLICY "opp_delete" ON opportunities FOR DELETE USING (workspace_id = current_user_workspace_id());

-- Opportunity Stage History
ALTER TABLE opportunity_stage_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "osh_select" ON opportunity_stage_history FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "osh_insert" ON opportunity_stage_history FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());

-- Quotes
ALTER TABLE quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "q_select" ON quotes FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "q_insert" ON quotes FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());
CREATE POLICY "q_update" ON quotes FOR UPDATE USING (workspace_id = current_user_workspace_id());
CREATE POLICY "q_delete" ON quotes FOR DELETE USING (workspace_id = current_user_workspace_id());

-- Quote Items (via quote → workspace_id)
ALTER TABLE quote_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "qi_select" ON quote_items FOR SELECT USING (
  EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id AND q.workspace_id = current_user_workspace_id())
);
CREATE POLICY "qi_insert" ON quote_items FOR INSERT WITH CHECK (
  EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id AND q.workspace_id = current_user_workspace_id())
);
CREATE POLICY "qi_update" ON quote_items FOR UPDATE USING (
  EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id AND q.workspace_id = current_user_workspace_id())
);
CREATE POLICY "qi_delete" ON quote_items FOR DELETE USING (
  EXISTS (SELECT 1 FROM quotes q WHERE q.id = quote_id AND q.workspace_id = current_user_workspace_id())
);

-- Projects
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "proj_select" ON projects FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "proj_insert" ON projects FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());
CREATE POLICY "proj_update" ON projects FOR UPDATE USING (workspace_id = current_user_workspace_id());
CREATE POLICY "proj_delete" ON projects FOR DELETE USING (workspace_id = current_user_workspace_id());

-- Time Entries
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "te_select" ON time_entries FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "te_insert" ON time_entries FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());
CREATE POLICY "te_update" ON time_entries FOR UPDATE USING (workspace_id = current_user_workspace_id());
CREATE POLICY "te_delete" ON time_entries FOR DELETE USING (workspace_id = current_user_workspace_id());

-- Expenses
ALTER TABLE expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exp_select" ON expenses FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "exp_insert" ON expenses FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());
CREATE POLICY "exp_update" ON expenses FOR UPDATE USING (workspace_id = current_user_workspace_id());
CREATE POLICY "exp_delete" ON expenses FOR DELETE USING (workspace_id = current_user_workspace_id());

-- Fixed Expenses
ALTER TABLE fixed_expenses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "fe_select" ON fixed_expenses FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "fe_insert" ON fixed_expenses FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());
CREATE POLICY "fe_update" ON fixed_expenses FOR UPDATE USING (workspace_id = current_user_workspace_id());
CREATE POLICY "fe_delete" ON fixed_expenses FOR DELETE USING (workspace_id = current_user_workspace_id());

-- Invoices
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
CREATE POLICY "inv_select" ON invoices FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "inv_insert" ON invoices FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());
CREATE POLICY "inv_update" ON invoices FOR UPDATE USING (workspace_id = current_user_workspace_id());
CREATE POLICY "inv_delete" ON invoices FOR DELETE USING (workspace_id = current_user_workspace_id());

-- Payments
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "pay_select" ON payments FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "pay_insert" ON payments FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());
CREATE POLICY "pay_update" ON payments FOR UPDATE USING (workspace_id = current_user_workspace_id());

-- Subscriptions
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sub_select" ON subscriptions FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "sub_insert" ON subscriptions FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());

-- Bot Sessions
ALTER TABLE bot_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bs_select" ON bot_sessions FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "bs_insert" ON bot_sessions FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());
CREATE POLICY "bs_update" ON bot_sessions FOR UPDATE USING (workspace_id = current_user_workspace_id());

-- WA Collaborators
ALTER TABLE wa_collaborators ENABLE ROW LEVEL SECURITY;
CREATE POLICY "wac_select" ON wa_collaborators FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "wac_insert" ON wa_collaborators FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());
CREATE POLICY "wac_update" ON wa_collaborators FOR UPDATE USING (workspace_id = current_user_workspace_id());
CREATE POLICY "wac_delete" ON wa_collaborators FOR DELETE USING (workspace_id = current_user_workspace_id());

-- Notifications
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notif_select" ON notifications FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "notif_insert" ON notifications FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());
CREATE POLICY "notif_update" ON notifications FOR UPDATE USING (workspace_id = current_user_workspace_id());

-- Referrals
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ref_select" ON referrals FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "ref_insert" ON referrals FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());

-- Health Scores
ALTER TABLE health_scores ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hs_select" ON health_scores FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "hs_insert" ON health_scores FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());

-- Testimonials
ALTER TABLE testimonials ENABLE ROW LEVEL SECURITY;
CREATE POLICY "test_select" ON testimonials FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "test_insert" ON testimonials FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());
CREATE POLICY "test_update" ON testimonials FOR UPDATE USING (workspace_id = current_user_workspace_id());

-- Audit Log
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "al_select" ON audit_log FOR SELECT USING (workspace_id = current_user_workspace_id());
CREATE POLICY "al_insert" ON audit_log FOR INSERT WITH CHECK (workspace_id = current_user_workspace_id());

-- ============================================================
-- ÍNDICES (performance multi-tenant)
-- ============================================================
CREATE INDEX idx_profiles_ws ON profiles(workspace_id);
CREATE INDEX idx_fiscal_profiles_ws ON fiscal_profiles(workspace_id);
CREATE INDEX idx_clients_ws ON clients(workspace_id);
CREATE INDEX idx_expense_categories_ws ON expense_categories(workspace_id);
CREATE INDEX idx_opportunities_ws ON opportunities(workspace_id);
CREATE INDEX idx_opportunities_stage ON opportunities(workspace_id, stage);
CREATE INDEX idx_opp_history_opp ON opportunity_stage_history(opportunity_id);
CREATE INDEX idx_quotes_ws ON quotes(workspace_id);
CREATE INDEX idx_quote_items_quote ON quote_items(quote_id);
CREATE INDEX idx_projects_ws ON projects(workspace_id);
CREATE INDEX idx_projects_status ON projects(workspace_id, status);
CREATE INDEX idx_time_entries_ws ON time_entries(workspace_id);
CREATE INDEX idx_time_entries_project ON time_entries(project_id);
CREATE INDEX idx_expenses_ws ON expenses(workspace_id);
CREATE INDEX idx_expenses_project ON expenses(project_id);
CREATE INDEX idx_expenses_date ON expenses(workspace_id, expense_date);
CREATE INDEX idx_fixed_expenses_ws ON fixed_expenses(workspace_id);
CREATE INDEX idx_invoices_ws ON invoices(workspace_id);
CREATE INDEX idx_invoices_status ON invoices(workspace_id, status);
CREATE INDEX idx_invoices_project ON invoices(project_id);
CREATE INDEX idx_payments_ws ON payments(workspace_id);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);
CREATE INDEX idx_subscriptions_ws ON subscriptions(workspace_id);
CREATE INDEX idx_bot_sessions_ws ON bot_sessions(workspace_id);
CREATE INDEX idx_bot_sessions_phone ON bot_sessions(user_phone);
CREATE INDEX idx_wa_collaborators_ws ON wa_collaborators(workspace_id);
CREATE INDEX idx_wa_collaborators_phone ON wa_collaborators(phone);
CREATE INDEX idx_notifications_ws ON notifications(workspace_id);
CREATE INDEX idx_notifications_unread ON notifications(workspace_id, is_read) WHERE is_read = false;
CREATE INDEX idx_referrals_code ON referrals(referral_code);
CREATE INDEX idx_health_scores_ws ON health_scores(workspace_id);
CREATE INDEX idx_audit_log_ws ON audit_log(workspace_id);
CREATE INDEX idx_audit_log_table ON audit_log(table_name, record_id);
CREATE INDEX idx_workspaces_slug ON workspaces(slug);

-- ============================================================
-- TRIGGERS
-- ============================================================

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON workspaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_fiscal_profiles_updated_at BEFORE UPDATE ON fiscal_profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_clients_updated_at BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_opportunities_updated_at BEFORE UPDATE ON opportunities
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_quotes_updated_at BEFORE UPDATE ON quotes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_fixed_expenses_updated_at BEFORE UPDATE ON fixed_expenses
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_projects_updated_at BEFORE UPDATE ON projects
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_invoices_updated_at BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_subscriptions_updated_at BEFORE UPDATE ON subscriptions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- SEED: 9 categorías de gasto al crear workspace (D242, D95)
-- ============================================================
CREATE OR REPLACE FUNCTION seed_expense_categories()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO expense_categories (workspace_id, name, is_deductible, deduction_pct, sort_order) VALUES
    (NEW.id, 'Materiales e insumos',      'yes',     100, 1),
    (NEW.id, 'Transporte y movilidad',     'yes',     100, 2),
    (NEW.id, 'Alimentación trabajo',       'partial',  50, 3),
    (NEW.id, 'Servicios profesionales',    'yes',     100, 4),
    (NEW.id, 'Software y tecnología',      'yes',     100, 5),
    (NEW.id, 'Arriendo y servicios',       'yes',     100, 6),
    (NEW.id, 'Marketing y publicidad',     'yes',     100, 7),
    (NEW.id, 'Capacitación',              'yes',     100, 8),
    (NEW.id, 'Otros gastos operativos',    'partial',  50, 9);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER seed_categories_on_workspace_create
  AFTER INSERT ON workspaces
  FOR EACH ROW
  EXECUTE FUNCTION seed_expense_categories();

-- SEED: Crear fiscal_profile vacío al crear workspace
CREATE OR REPLACE FUNCTION seed_fiscal_profile()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO fiscal_profiles (workspace_id) VALUES (NEW.id);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER seed_fiscal_profile_on_workspace_create
  AFTER INSERT ON workspaces
  FOR EACH ROW
  EXECUTE FUNCTION seed_fiscal_profile();

-- ============================================================
-- SEED: Parámetros fiscales 2026 (D94, D242)
-- ============================================================
INSERT INTO fiscal_params (key, value, description, valid_from) VALUES
  ('uvt_2026', 49799, 'Valor UVT 2026 (DIAN)', '2026-01-01'),
  ('iva_general', 19, 'Tarifa general IVA (%)', '2026-01-01'),
  ('retefuente_servicios_4', 4, 'ReteFuente servicios 4% (>27 UVT)', '2026-01-01'),
  ('retefuente_servicios_6', 6, 'ReteFuente servicios 6% (>4 UVT)', '2026-01-01'),
  ('retefuente_honorarios_10', 10, 'ReteFuente honorarios 10% (no declarante)', '2026-01-01'),
  ('retefuente_honorarios_11', 11, 'ReteFuente honorarios 11% (declarante)', '2026-01-01'),
  ('reteica_bogota_default', 9.66, 'ReteICA Bogotá consultoría (‰)', '2026-01-01'),
  ('reteiva_pct', 15, 'Retención de IVA (% del IVA)', '2026-01-01'),
  ('tope_retefuente_servicios_uvt', 4, 'Tope ReteFuente servicios (UVT)', '2026-01-01'),
  ('tope_retefuente_honorarios_uvt', 27, 'Tope ReteFuente honorarios (UVT)', '2026-01-01');

-- ============================================================
-- TRIGGER: Track cambios de etapa pipeline
-- ============================================================
CREATE OR REPLACE FUNCTION track_opportunity_stage_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.stage IS DISTINCT FROM NEW.stage THEN
    INSERT INTO opportunity_stage_history (workspace_id, opportunity_id, from_stage, to_stage, changed_by)
    VALUES (NEW.workspace_id, NEW.id, OLD.stage, NEW.stage, auth.uid());

    NEW.probability := CASE NEW.stage
      WHEN 'lead' THEN 10
      WHEN 'prospect' THEN 25
      WHEN 'quotation' THEN 50
      WHEN 'negotiation' THEN 75
      WHEN 'won' THEN 100
      WHEN 'lost' THEN 0
      ELSE NEW.probability
    END;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER track_opp_stage_change
  BEFORE UPDATE ON opportunities
  FOR EACH ROW
  EXECUTE FUNCTION track_opportunity_stage_change();

-- ============================================================
-- TRIGGER: Notificación al ganar oportunidad
-- ============================================================
CREATE OR REPLACE FUNCTION on_opportunity_won()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.stage = 'won' AND OLD.stage != 'won' THEN
    INSERT INTO notifications (workspace_id, type, title, message, action_url)
    VALUES (
      NEW.workspace_id,
      'opportunity_won',
      '¡Oportunidad ganada: ' || NEW.name || '!',
      '¿Crear proyecto a partir de esta oportunidad?',
      '/pipeline/' || NEW.id
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_opportunity_won
  AFTER UPDATE ON opportunities
  FOR EACH ROW
  WHEN (NEW.stage = 'won' AND OLD.stage != 'won')
  EXECUTE FUNCTION on_opportunity_won();

-- ============================================================
-- STORAGE BUCKETS
-- ============================================================
INSERT INTO storage.buckets (id, name, public) VALUES
  ('expense-supports', 'expense-supports', false);

CREATE POLICY "storage_select" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'expense-supports' AND
    (storage.foldername(name))[1] = current_user_workspace_id()::text
  );

CREATE POLICY "storage_insert" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'expense-supports' AND
    (storage.foldername(name))[1] = current_user_workspace_id()::text
  );

CREATE POLICY "storage_delete" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'expense-supports' AND
    (storage.foldername(name))[1] = current_user_workspace_id()::text
  );
