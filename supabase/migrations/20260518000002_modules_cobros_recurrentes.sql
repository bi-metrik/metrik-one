-- ============================================================
-- 20260518000002 — Activar modulo cobros_recurrentes en workspace metrik
--
-- El modulo `cobros_recurrentes` habilita:
--  - Sidebar item "Cuentas de cobro" en seccion Extras
--  - Seccion "Planilla PILA mensual" en /mi-negocio
--  - Bloque embebido cuentas_cobro_negocio en detalle de negocio
--  - Cron diario evalua si dia es 15 y emite cuentas para workspaces con este flag
--
-- Solo activado por defecto en workspace metrik (ID a21bfc88-1a60-48c3-afcd-144226aa2392).
-- Cualquier otro workspace que se incorpore como persona natural emisora puede
-- activarlo seteando workspaces.modules.cobros_recurrentes=true.
-- ============================================================

UPDATE workspaces
SET modules = COALESCE(modules, '{}'::jsonb) || jsonb_build_object('cobros_recurrentes', true)
WHERE id = 'a21bfc88-1a60-48c3-afcd-144226aa2392';
