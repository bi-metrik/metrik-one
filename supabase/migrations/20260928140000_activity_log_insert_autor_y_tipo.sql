-- Escribir en la Actividad: la base solo deja firmar como uno mismo (sigue a #944 y #946).
--
-- Hueco: #944 dejo `activity_log_insert_workspace` (FOR INSERT, TO public) con un
-- WITH CHECK solo por workspace. Con la anon key + su JWT, cualquier miembro podia
-- por PostgREST crear entradas a nombre de OTRO staff (un comentario "de" su jefe),
-- entradas anonimas que se leen como del sistema, o tipos que la app nunca le deja
-- crear: `platform_admin_enter` (el aviso de que MeTRIK entro al espacio),
-- `drive_health_failed`, `stage_auto_transition`...
--
-- Inventario (src/, supabase/functions/ y funciones SQL, 2026-09-28). Todo INSERT
-- de la app pasa por `registrarActividad` (src/lib/activity/registrar-actividad.ts);
-- el unico otro es el handler de WhatsApp. Con cliente de SESION (el unico al que
-- aplica esta politica):
--   - autor_id = `staffId` de getWorkspace(): el staff propio en el workspace activo
--     (activo o inactivo), o null si no tiene staff ahi (platform_admin trabajando en
--     el espacio de un cliente: staff es UNIQUE por persona en toda la base).
--     `asignarResponsable` lo resuelve por `profiles.id` -> staff del workspace: el
--     mismo resultado.
--   - En "Ver como" (solo platform_admin, cookie `__impersonate`) getWorkspace
--     devuelve el staff del IMPERSONADO y la sesion sigue siendo la del admin. Es a
--     proposito (get-workspace-impl.ts: "lo que importa es de quien es la accion").
--   - `ensureNegocioDriveFolder` (desde crearNegocio) escribe `drive_folder_skipped`
--     / `drive_folder_failed` SIN autor: son notas del sistema.
--   - tipos: comentario, cambio, sistema, cambio_etapa, cambio_estado,
--     cambio_sistema, propuesta_aprobada, drive_folder_skipped, drive_folder_failed.
-- Con service_role (bypass de RLS, no los toca esta politica): crons, webhooks de
-- pasarela y FunnelChat, bot de WhatsApp, entrada/salida de platform_admin, Siigo,
-- facturacion, enlaces de pago. `force_unlock_bloque` es SECURITY DEFINER (corre como
-- el dueno de la tabla, sin RLS).
--
-- Arreglo: una sola politica de INSERT, TO authenticated, que espeja ese inventario:
--   1. mismo workspace activo (igual que antes);
--   2. tipo dentro de la lista de la sesion. Quedan fuera los que solo escribe el
--      sistema: platform_admin_enter/exit, drive_health_failed,
--      stage_auto_transition y los dos de conciliacion sin escritor
--      (solicitud_conciliacion, conciliacion_atendida);
--   3. autor coherente (`activity_log_autor_coherente`):
--      - autor = el staff propio en ese workspace; o
--      - autor null, solo si quien actua NO tiene staff en ese workspace, o es
--        platform_admin, o la entrada es una nota de carpeta de Drive; o
--      - "Ver como": si quien actua es platform_admin, cualquier staff de ESE
--        workspace. La base no ve la cookie de impersonacion; la condicion es la
--        misma que getWorkspace exige para aceptarla (`profiles.platform_admin`).
--        Un platform_admin ya puede actuar como cualquiera con "Ver como"; lo que se
--        cierra es que un miembro del cliente firme por otro.
--
-- El helper es SECURITY DEFINER con search_path fijo, como current_user_staff_id():
-- no depende de la RLS de `staff` ni de `profiles` dentro de la politica. Mismo
-- criterio de staff que getWorkspace (profile_id + workspace, sin filtrar
-- is_active), NO el de current_user_staff_id() (que no mira el workspace).
--
-- `to authenticated`: anon no tiene staff ni workspace; sin politica, su INSERT se
-- rechaza con 42501 en vez de evaluar helpers revocados.
--
-- No se tocan SELECT, UPDATE ni DELETE.
--
-- ⚠️ Un tipo nuevo que la app inserte con cliente de sesion exige ampliar la lista
-- de abajo, o `registrarActividad` reportara "new row violates row-level security"
-- y la entrada no se guardara (no tumba la operacion: el helper nunca lanza).

create or replace function public.activity_log_autor_coherente(
  p_workspace_id uuid,
  p_autor_id uuid,
  p_tipo text
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select case
    when p_autor_id is null then
      p_tipo in ('drive_folder_skipped', 'drive_folder_failed')
      or not exists (
        select 1 from staff s
        where s.profile_id = auth.uid() and s.workspace_id = p_workspace_id
      )
      or coalesce((select p.platform_admin from profiles p where p.id = auth.uid()), false)
    else
      exists (
        select 1 from staff s
        where s.id = p_autor_id
          and s.profile_id = auth.uid()
          and s.workspace_id = p_workspace_id
      )
      or (
        coalesce((select p.platform_admin from profiles p where p.id = auth.uid()), false)
        and exists (
          select 1 from staff s
          where s.id = p_autor_id and s.workspace_id = p_workspace_id
        )
      )
  end;
$$;

revoke execute on function public.activity_log_autor_coherente(uuid, uuid, text) from public, anon;
grant execute on function public.activity_log_autor_coherente(uuid, uuid, text) to authenticated, service_role;

comment on function public.activity_log_autor_coherente(uuid, uuid, text) is
  'Politica de INSERT de activity_log: autor = staff propio del workspace; null solo sin staff ahi, platform_admin o nota de Drive; platform_admin puede firmar por un staff del workspace ("Ver como").';

drop policy if exists activity_log_insert_workspace on public.activity_log;

create policy activity_log_insert_propio on public.activity_log
  for insert to authenticated
  with check (
    workspace_id = (select public.current_user_workspace_id())
    and tipo in (
      'comentario',
      'cambio',
      'sistema',
      'cambio_etapa',
      'cambio_estado',
      'cambio_sistema',
      'propuesta_aprobada',
      'drive_folder_skipped',
      'drive_folder_failed'
    )
    and public.activity_log_autor_coherente(workspace_id, autor_id, tipo)
  );

comment on policy activity_log_insert_propio on public.activity_log is
  'Con cliente de sesion: mismo workspace, tipos que la app escribe con sesion, y autor = staff propio (o null/impersonado segun activity_log_autor_coherente). El sistema escribe con service_role.';
