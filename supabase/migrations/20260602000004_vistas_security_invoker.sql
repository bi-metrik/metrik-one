-- Fix linter security_definer_view (7 ERROR): las vistas financieras eran SECURITY DEFINER
-- (corren como owner => bypasean el RLS de las tablas base) y tenian grant a anon.
-- Con la anon key publica (va en el bundle del browser) se podia hacer GET /rest/v1/v_pyl_mes
-- y leer EBITDA / P&L / MC / costos de TODOS los workspaces. Fuga financiera cross-tenant.
--
-- security_invoker=on hace que la vista respete el RLS del rol que consulta:
--   - authenticated: solo ve su workspace (RLS de cobros/gastos/negocios/etc por workspace),
--     aunque se quite el filtro .eq('workspace_id', ...) en el cliente.
--   - service_role (platform_admin / admin/workflows): sigue bypaseando RLS; la app filtra por ws.
-- La app consume estas vistas via getWorkspace() y siempre filtra por su propio workspace,
-- asi que el comportamiento legitimo no cambia.
-- Ademas se revoca SELECT a anon: estas vistas nunca deben leerse sin sesion.

alter view v_proyecto_financiero        set (security_invoker = on);
alter view v_proyecto_rubros_comparativo set (security_invoker = on);
alter view v_mc_negocio                 set (security_invoker = on);
alter view v_mc_linea_mes               set (security_invoker = on);
alter view v_pyl_mes                    set (security_invoker = on);
alter view v_negocios_etapa_vencimiento set (security_invoker = on);
alter view v_tutorial_adopcion          set (security_invoker = on);

revoke select on v_proyecto_financiero        from anon;
revoke select on v_proyecto_rubros_comparativo from anon;
revoke select on v_mc_negocio                 from anon;
revoke select on v_mc_linea_mes               from anon;
revoke select on v_pyl_mes                    from anon;
revoke select on v_negocios_etapa_vencimiento from anon;
revoke select on v_tutorial_adopcion          from anon;
