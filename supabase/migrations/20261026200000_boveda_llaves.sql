-- Bóveda de llaves por workspace (decisión de Mauricio, 2026-10-26).
--
-- Las llaves de integración del cliente (Bold primero) se cargan desde ONE, en Configuración → Bóveda de llaves, y
-- viven en Supabase Vault como `ws:<workspace_id>:<clave>`, igual que las de la migración
-- 20260915010000_secretos_workspace_vault.sql. Tres garantías:
--   1. Solo el DUEÑO del workspace carga, reemplaza o borra. Lo revisa el servidor (rol owner, sin «Ver como», sin ser
--      platform admin de MéTRIK) y lo vuelve a revisar cada función aquí con el actor que recibe.
--   2. Cada carga, reemplazo o borrado queda en `boveda_auditoria`: quién, cuándo, qué clave y la acción. NUNCA el valor.
--   3. Ninguna función de esta migración devuelve una llave: el estado trae solo los últimos 4 caracteres y la fecha.
--
-- Esta migración SOLO agrega: una tabla vacía y cuatro funciones. No toca ningún dato existente.
-- Todo es de `service_role`: el navegador no llega a nada de esto.

-- ── Registro de auditoría ────────────────────────────────────────────────────

create table public.boveda_auditoria (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  clave text not null check (clave ~ '^[a-z][a-z0-9_]*$'),
  accion text not null check (accion in ('cargar', 'reemplazar', 'borrar')),
  actor_id uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create index boveda_auditoria_ws_fecha on public.boveda_auditoria (workspace_id, created_at desc);

alter table public.boveda_auditoria enable row level security;
-- server-only: la escriben y la leen solo las funciones de abajo (service_role). El dueño la ve en la pantalla de la
-- bóveda, que la pide al servidor después de comprobar que es el dueño.

-- ── ¿El actor es el dueño del workspace? ─────────────────────────────────────

create or replace function public.boveda_es_dueno(p_workspace_id uuid, p_actor uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select exists (
    select 1
      from public.profiles p
     where p.id = p_actor
       and p.workspace_id = p_workspace_id
       and p.role = 'owner'
       and coalesce(p.platform_admin, false) = false
  );
$function$;

-- ── Estado: qué claves hay, sus últimos 4 caracteres y la fecha. Nunca el valor ──

create or replace function public.boveda_estado(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'clave', split_part(s.name, ':', 3),
        'ultimos4', right(s.decrypted_secret, 4),
        'actualizado_at', s.updated_at
      )
      order by s.name
    ),
    '[]'::jsonb
  )
  from vault.decrypted_secrets s
  where s.name like 'ws:' || p_workspace_id::text || ':%';
$function$;

-- ── Cargar o reemplazar una llave ────────────────────────────────────────────
-- `p_conservar_anterior`: el valor que se reemplaza pasa a `<clave>_anterior` (la secreta de Bold, para verificar
-- firmas de los links de la cuenta vieja unos días después del cambio).

create or replace function public.boveda_guardar(
  p_workspace_id uuid,
  p_clave text,
  p_valor text,
  p_actor uuid,
  p_conservar_anterior boolean default false
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_nombre text := 'ws:' || p_workspace_id::text || ':' || coalesce(p_clave, '');
  v_anterior text;
begin
  if not public.boveda_es_dueno(p_workspace_id, p_actor) then
    raise exception 'boveda_sin_permiso' using errcode = 'P0001';
  end if;

  select s.decrypted_secret into v_anterior from vault.decrypted_secrets s where s.name = v_nombre;

  if p_conservar_anterior and v_anterior is not null and v_anterior is distinct from p_valor then
    perform public.guardar_secreto_workspace(p_workspace_id, p_clave || '_anterior', v_anterior);
  end if;

  -- Valida la clave, el valor y el workspace, y crea o actualiza en Vault.
  perform public.guardar_secreto_workspace(p_workspace_id, p_clave, p_valor);

  insert into public.boveda_auditoria (workspace_id, clave, accion, actor_id)
  values (p_workspace_id, p_clave, case when v_anterior is null then 'cargar' else 'reemplazar' end, p_actor);
end;
$function$;

-- ── Borrar llaves (desconecta la integración de inmediato) ───────────────────

create or replace function public.boveda_borrar(p_workspace_id uuid, p_claves text[], p_actor uuid)
returns integer
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_clave text;
  v_n integer := 0;
begin
  if not public.boveda_es_dueno(p_workspace_id, p_actor) then
    raise exception 'boveda_sin_permiso' using errcode = 'P0001';
  end if;

  foreach v_clave in array coalesce(p_claves, array[]::text[]) loop
    delete from vault.secrets s where s.name = 'ws:' || p_workspace_id::text || ':' || v_clave;
    if found then
      v_n := v_n + 1;
      insert into public.boveda_auditoria (workspace_id, clave, accion, actor_id)
      values (p_workspace_id, v_clave, 'borrar', p_actor);
    end if;
  end loop;
  return v_n;
end;
$function$;

-- ── El registro, para la pantalla del dueño ──────────────────────────────────

create or replace function public.boveda_auditoria_de(p_workspace_id uuid, p_limite integer default 50)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce(jsonb_agg(x order by x.created_at desc), '[]'::jsonb)
  from (
    select a.clave, a.accion, a.created_at, coalesce(p.full_name, 'Persona retirada') as actor
      from public.boveda_auditoria a
      left join public.profiles p on p.id = a.actor_id
     where a.workspace_id = p_workspace_id
     order by a.created_at desc
     limit least(greatest(coalesce(p_limite, 50), 1), 200)
  ) x;
$function$;

-- Solo `service_role`. Se revoca nombrando cada rol: el EXECUTE de `authenticated` viene de los privilegios por defecto
-- del esquema y `revoke ... from public` no se lo quita.
revoke all on function public.boveda_es_dueno(uuid, uuid) from public, anon, authenticated;
revoke all on function public.boveda_estado(uuid) from public, anon, authenticated;
revoke all on function public.boveda_guardar(uuid, text, text, uuid, boolean) from public, anon, authenticated;
revoke all on function public.boveda_borrar(uuid, text[], uuid) from public, anon, authenticated;
revoke all on function public.boveda_auditoria_de(uuid, integer) from public, anon, authenticated;

grant execute on function public.boveda_es_dueno(uuid, uuid) to service_role;
grant execute on function public.boveda_estado(uuid) to service_role;
grant execute on function public.boveda_guardar(uuid, text, text, uuid, boolean) to service_role;
grant execute on function public.boveda_borrar(uuid, text[], uuid) to service_role;
grant execute on function public.boveda_auditoria_de(uuid, integer) to service_role;
