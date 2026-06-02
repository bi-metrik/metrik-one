-- Fix linter Supabase rls_disabled_in_public: staff_areas estaba sin RLS y con grant a anon.
-- La anon key es publica (NEXT_PUBLIC_SUPABASE_ANON_KEY va en el bundle del browser), por lo que
-- cualquiera podia leer el equipo (staff_id, area) de TODOS los workspaces via /rest/v1/staff_areas.
--
-- staff_areas se accede con cliente authenticated (via getWorkspace) en:
--   src/lib/actions/equipo-areas.ts (select + insert + delete)
--   src/lib/actions/cierre-adelantado.ts (select)
--   src/lib/actions/reapertura.ts (select)
-- => no basta enable RLS: requiere policies de aislamiento por workspace o se romperia la gestion de equipo.
-- staff_areas no tiene workspace_id propio: se valida via join a staff (mismo patron que control_causa).

alter table staff_areas enable row level security;

create policy staff_areas_select on staff_areas for select to authenticated
  using (exists (select 1 from staff s where s.id = staff_areas.staff_id and s.workspace_id = current_user_workspace_id()));

create policy staff_areas_insert on staff_areas for insert to authenticated
  with check (exists (select 1 from staff s where s.id = staff_areas.staff_id and s.workspace_id = current_user_workspace_id()));

create policy staff_areas_update on staff_areas for update to authenticated
  using (exists (select 1 from staff s where s.id = staff_areas.staff_id and s.workspace_id = current_user_workspace_id()))
  with check (exists (select 1 from staff s where s.id = staff_areas.staff_id and s.workspace_id = current_user_workspace_id()));

create policy staff_areas_delete on staff_areas for delete to authenticated
  using (exists (select 1 from staff s where s.id = staff_areas.staff_id and s.workspace_id = current_user_workspace_id()));
