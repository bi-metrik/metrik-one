-- Fix Supabase security linter warnings
-- 1. Views: Set security_invoker = true so RLS policies of underlying tables apply per-user
-- 2. Tables: Enable RLS on wa_message_log and ref_tarifas_ica

-- ── Views: Switch from SECURITY DEFINER (default) to SECURITY INVOKER ──

ALTER VIEW public.v_proyecto_financiero SET (security_invoker = true);
ALTER VIEW public.v_facturas_estado SET (security_invoker = true);
ALTER VIEW public.v_proyecto_rubros_comparativo SET (security_invoker = true);
ALTER VIEW public.v_cartera_antiguedad SET (security_invoker = true);
ALTER VIEW public.v_gastos_fijos_mes_actual SET (security_invoker = true);

-- ── wa_message_log: Enable RLS ──
-- Only accessed by Edge Functions via service_role (which bypasses RLS).
-- No permissive policies needed — anon/authenticated users should NOT access this table.

ALTER TABLE public.wa_message_log ENABLE ROW LEVEL SECURITY;

-- ── ref_tarifas_ica: Enable RLS + read-only policy ──
-- Global reference table (tax rates by municipality). All authenticated users can read.

ALTER TABLE public.ref_tarifas_ica ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ref_tarifas_ica_select_authenticated"
  ON public.ref_tarifas_ica
  FOR SELECT
  TO authenticated
  USING (true);
