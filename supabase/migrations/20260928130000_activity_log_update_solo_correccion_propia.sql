-- Editar en la Actividad: la base solo deja lo que la app hace (sigue a #944).
--
-- Hueco: #944 partio la politica FOR ALL de `activity_log` y cerro DELETE a
-- comentarios (autor u owner/admin), pero dejo `activity_log_update_workspace`
-- solo por workspace. Con la anon key + su JWT, cualquier miembro podia por
-- PostgREST:
--   - reescribir un `cambio_etapa` ajeno a tipo='comentario' con su propio
--     autor_id y despues borrarlo (el DELETE nuevo lo dejaba: ya era "su"
--     comentario). Medido en el ensayo de #944: 1 fila y 1 fila.
--   - reescribir el texto de comentarios ajenos.
--   - mover cualquier fila a otro negocio, cambiarle created_at, etc.
--
-- Que actualiza hoy `activity_log` con el cliente de sesion (auditado en src/ y
-- supabase/functions/ el 2026-09-28): UN solo camino, `actualizarActividad`
-- (src/lib/activity/registrar-actividad.ts), llamado solo por
-- `registrarCorrecciones` (src/lib/correcciones/registrar.ts). Refresca el evento
-- tipo='cambio' que la MISMA persona inserto al empezar la correccion (autor_id =
-- su staff.id) y solo toca `contenido`, `valor_nuevo` y `valor_anterior`.
-- La app NO edita comentarios (no hay accion ni UI) y nadie mas hace UPDATE:
-- bot de WhatsApp, FunnelChat, hook one-actividad y crons usan service_role, que
-- hace bypass de RLS y conserva su grant de tabla completo.
--
-- Arreglo, en dos capas, espejo exacto de ese unico camino:
--   1. Filas (RLS): solo el evento tipo='cambio' propio, del workspace activo,
--      y la fila tiene que seguir siendolo despues (WITH CHECK igual al USING):
--      nadie cambia tipo, autor ni workspace. Comentarios: nadie los edita,
--      ni el autor ni owner/admin (la moderacion es borrar, #944).
--   2. Columnas (GRANT): `authenticated` solo puede escribir contenido,
--      valor_nuevo y valor_anterior. entidad_tipo/entidad_id, created_at,
--      campo_modificado, mencion_id y link_url quedan fijos sin trigger. Se
--      eligio el grant por columnas y no un trigger BEFORE UPDATE porque es
--      declarativo, no corre codigo por fila y falla en voz alta (42501).
--      ⚠️ Una migracion futura con `grant all on all tables in schema public to
--      authenticated` lo reabriria; la politica RLS seguiria conteniendo el dano
--      a los eventos `cambio` propios.
--
-- `to authenticated`: `current_user_staff_id()` esta revocada a anon, y anon no
-- tiene staff; con `to public` una peticion anonima fallaria en vez de dar 0.
--
-- No se tocan SELECT, INSERT ni DELETE.
--
-- Efecto conocido: en "Ver como" (platform_admin impersonando) el evento se
-- inserta con el staff del impersonado pero la sesion es la del admin, asi que
-- el refresco del autosave da 0 filas: el timeline queda con el primer valor de
-- esa correccion. `actualizarActividad` ahora lo reporta en vez de callarlo.

drop policy if exists activity_log_update_workspace on public.activity_log;

create policy activity_log_update_correccion_propia on public.activity_log
  for update to authenticated
  using (
    workspace_id = (select public.current_user_workspace_id())
    and tipo = 'cambio'
    and autor_id is not null
    and autor_id = (select public.current_user_staff_id())
  )
  with check (
    workspace_id = (select public.current_user_workspace_id())
    and tipo = 'cambio'
    and autor_id is not null
    and autor_id = (select public.current_user_staff_id())
  );

comment on policy activity_log_update_correccion_propia on public.activity_log is
  'Solo el evento tipo=cambio propio (refresco de correcciones, actualizarActividad en src/lib/activity/registrar-actividad.ts). Nadie edita comentarios.';

revoke update on public.activity_log from public, anon, authenticated;
grant update (contenido, valor_nuevo, valor_anterior) on public.activity_log to authenticated;
