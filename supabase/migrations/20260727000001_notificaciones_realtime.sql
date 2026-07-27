-- Notificaciones: habilitar Supabase Realtime
--
-- `NotificationBell` se suscribe a `postgres_changes` (INSERT) sobre
-- public.notificaciones desde 2026-03, pero la tabla NUNCA se agregó a la
-- publicación `supabase_realtime` → el canal se suscribía sin error y jamás
-- recibía un evento. Resultado: la campana no se actualizaba sola nunca.
--
-- El aislamiento lo sigue dando RLS: la policy `notificaciones_select`
-- (destinatario_id = auth.uid()) aplica también al stream de realtime, así que
-- cada usuario solo recibe eventos de SUS notificaciones. No se abre nada nuevo.

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'notificaciones'
  ) then
    alter publication supabase_realtime add table public.notificaciones;
  end if;
end $$;

-- REPLICA IDENTITY FULL: sin esto el payload de UPDATE/DELETE solo trae la PK.
-- Para INSERT no cambia nada, pero deja el canal listo si más adelante se
-- escuchan cambios de estado (completada/descartada) desde otra pestaña.
alter table public.notificaciones replica identity full;
