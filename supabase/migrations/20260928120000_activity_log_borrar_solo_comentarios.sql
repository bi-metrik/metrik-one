-- Borrar en la Actividad: la misma regla en la base que en la app (PR #943).
--
-- Hueco: `activity_log` tenia UNA sola politica, `activity_log_workspace_isolation`,
-- PERMISSIVE, FOR ALL, TO public, con `workspace_id = current_user_workspace_id()`.
-- Para DELETE eso bastaba con estar en el workspace: cualquier autenticado podia
-- borrar por PostgREST un comentario ajeno o un cambio de etapa (el rastro de lo que
-- paso con el negocio), aunque la app ya lo niega desde `puedeBorrarEntrada`
-- (src/lib/activity/borrar-comentario.ts).
--
-- Arreglo: la politica FOR ALL se parte en cuatro. SELECT, INSERT y UPDATE quedan
-- EXACTAMENTE como estaban (mismo rol `public`, misma expresion; en una FOR ALL sin
-- WITH CHECK, Postgres usa el USING como check de INSERT/UPDATE, y asi se reescribe).
-- Solo DELETE se endurece, y es la unica politica DELETE de la tabla (las permisivas
-- se suman con OR: si quedara la FOR ALL, la nueva no cerraria nada):
--   mismo workspace
--   AND tipo = 'comentario'
--   AND (rol owner/admin en el workspace activo  -- moderacion
--        OR autor_id = staff del usuario)          -- su propio comentario
--
-- Helpers reusados, ya usados en RLS (20260730000010, 20260831000005), SECURITY
-- DEFINER con search_path fijo y sin RLS recursiva:
--   current_user_workspace_id()  -> profiles.workspace_id de auth.uid()
--   current_user_profile_role()  -> profiles.role de auth.uid() (el `role` de la app)
--   current_user_staff_id()      -> staff activo de auth.uid() (staff es 1 por persona)
-- Envueltos en (select ...) para que se evaluen una vez por sentencia (initplan).
--
-- Quien no pasa por aqui: service_role hace bypass de RLS (bot de WhatsApp,
-- webhook de FunnelChat, hook one-actividad, crons). Los ON DELETE CASCADE de las FK
-- tampoco pasan por RLS.


drop policy if exists activity_log_workspace_isolation on public.activity_log;

create policy activity_log_select_workspace on public.activity_log
  for select to public
  using (workspace_id = (select public.current_user_workspace_id()));

create policy activity_log_insert_workspace on public.activity_log
  for insert to public
  with check (workspace_id = (select public.current_user_workspace_id()));

create policy activity_log_update_workspace on public.activity_log
  for update to public
  using (workspace_id = (select public.current_user_workspace_id()))
  with check (workspace_id = (select public.current_user_workspace_id()));

create policy activity_log_delete_comentario on public.activity_log
  for delete to authenticated
  using (
    workspace_id = (select public.current_user_workspace_id())
    and tipo = 'comentario'
    and (
      (select public.current_user_profile_role()) in ('owner', 'admin')
      or (autor_id is not null and autor_id = (select public.current_user_staff_id()))
    )
  );

comment on policy activity_log_delete_comentario on public.activity_log is
  'Solo comentarios; los borra su autor o un owner/admin del workspace. Misma regla que puedeBorrarEntrada (src/lib/activity/borrar-comentario.ts).';

