-- Credenciales por workspace en Supabase Vault.
--
-- Por que: hasta hoy vivian en `workspaces.config_extra`, y esa columna la lee Y la
-- actualiza cualquier miembro del workspace por REST. `ws_select` / `ws_update` solo
-- piden `id = current_user_workspace_id()`, sin mirar rol, y `authenticated` tiene
-- SELECT y UPDATE sobre la tabla. Medido el 2026-09-14: soena (Drive, Siigo,
-- FunnelChat), afi (Drive, Valida) y otros 6 workspaces con `valida_api_key`.
--
-- Esta migracion SOLO crea las funciones: no mueve datos. El codigo lee Vault primero
-- y cae a `config_extra`, asi que funciona antes y despues de mover las claves. El
-- traslado y el cierre de grants van en una migracion aparte.
--
-- Nombre del secreto en Vault: `ws:<workspace_id>:<clave>`. Claves anidadas se aplanan
-- (`funnelchat.webhook_token` -> `funnelchat_webhook_token`).
--
-- Solo `service_role` ejecuta. Se revoca nombrando cada rol: en esta base el EXECUTE de
-- `authenticated` viene de los privilegios por defecto del esquema, y `revoke ... from
-- public` no se lo quita.

-- Todas las credenciales del workspace, como {clave: valor}.
create or replace function public.leer_secretos_workspace(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    jsonb_object_agg(split_part(s.name, ':', 3), s.decrypted_secret),
    '{}'::jsonb
  )
  from vault.decrypted_secrets s
  where s.name like 'ws:' || p_workspace_id::text || ':%';
$function$;

-- Crea o reemplaza una credencial. La usan los scripts de setup y la migracion de traslado.
create or replace function public.guardar_secreto_workspace(
  p_workspace_id uuid,
  p_clave text,
  p_valor text
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_nombre text;
  v_id uuid;
begin
  if p_clave is null or p_clave !~ '^[a-z][a-z0-9_]*$' then
    raise exception 'guardar_secreto_workspace: clave invalida (%)', p_clave
      using errcode = 'check_violation';
  end if;
  if p_valor is null or length(p_valor) = 0 then
    raise exception 'guardar_secreto_workspace: valor vacio para %', p_clave
      using errcode = 'check_violation';
  end if;
  if not exists (select 1 from public.workspaces w where w.id = p_workspace_id) then
    raise exception 'guardar_secreto_workspace: workspace % no existe', p_workspace_id
      using errcode = 'foreign_key_violation';
  end if;

  v_nombre := 'ws:' || p_workspace_id::text || ':' || p_clave;
  select s.id into v_id from vault.secrets s where s.name = v_nombre;

  if v_id is null then
    perform vault.create_secret(p_valor, v_nombre, 'Credencial de workspace (' || p_clave || ')');
  else
    perform vault.update_secret(v_id, p_valor);
  end if;
end;
$function$;

-- Resuelve el workspace dueño de una credencial (el webhook de FunnelChat identifica al
-- workspace por su token). Devuelve null si nadie la tiene y tambien si la tienen dos:
-- un token ambiguo no identifica a nadie.
create or replace function public.workspace_por_secreto(p_clave text, p_valor text)
returns uuid
language sql
stable
security definer
set search_path = ''
as $function$
  select case when count(*) = 1 then min(split_part(s.name, ':', 2))::uuid end
  from vault.decrypted_secrets s
  where s.name like 'ws:%'
    and split_part(s.name, ':', 3) = p_clave
    and s.decrypted_secret = p_valor;
$function$;

revoke all on function public.leer_secretos_workspace(uuid) from public, anon, authenticated;
revoke all on function public.guardar_secreto_workspace(uuid, text, text) from public, anon, authenticated;
revoke all on function public.workspace_por_secreto(text, text) from public, anon, authenticated;

grant execute on function public.leer_secretos_workspace(uuid) to service_role;
grant execute on function public.guardar_secreto_workspace(uuid, text, text) to service_role;
grant execute on function public.workspace_por_secreto(text, text) to service_role;
