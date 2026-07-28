-- Menciones multiples + etiquetas de equipo en comentarios
--
-- PROBLEMA. `activity_log` tiene UNA sola columna `mencion_id` (un uuid, una
-- persona). Para pedirle algo a tres personas hay que escribir el mismo
-- comentario tres veces — es literalmente lo que hace Daniela hoy. Y no existe
-- forma de dirigirse a un area completa.
--
-- SOLUCION. Tabla de menciones donde cada fila es una persona O un area:
--   · persona -> notificacion personal (`mencion`), como hoy
--   · area    -> notificacion de EQUIPO (`mencion_equipo`): le llega a todos los
--                miembros y basta con que uno la atienda para que desaparezca de
--                la campana de los demas (mecanismo de `grupo_clave`, ver
--                20260727000004).
--
-- `activity_log.mencion_id` se conserva: la usa el timeline para mostrar a quien
-- se menciono. Deja de ser la fuente de las notificaciones.

create table if not exists public.activity_menciones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  activity_log_id uuid not null references public.activity_log(id) on delete cascade,
  -- Exactamente uno de los dos: o mencionas a una persona, o a un equipo.
  staff_id uuid references public.staff(id) on delete cascade,
  area text check (area in ('comercial', 'operaciones', 'financiera')),
  created_at timestamptz not null default now(),
  constraint activity_menciones_persona_o_area check (num_nonnulls(staff_id, area) = 1)
);

create index if not exists activity_menciones_activity_idx
  on public.activity_menciones (activity_log_id);

-- Sin menciones duplicadas en un mismo comentario
create unique index if not exists activity_menciones_unica_persona
  on public.activity_menciones (activity_log_id, staff_id) where staff_id is not null;
create unique index if not exists activity_menciones_unica_area
  on public.activity_menciones (activity_log_id, area) where area is not null;

alter table public.activity_menciones enable row level security;

-- Se escribe/lee con el cliente `authenticated` (el compositor de comentarios),
-- asi que necesita policy por workspace + grant explicito.
drop policy if exists activity_menciones_select on public.activity_menciones;
create policy activity_menciones_select on public.activity_menciones
  for select using (workspace_id = current_user_workspace_id());

drop policy if exists activity_menciones_insert on public.activity_menciones;
create policy activity_menciones_insert on public.activity_menciones
  for insert with check (workspace_id = current_user_workspace_id());

drop policy if exists activity_menciones_delete on public.activity_menciones;
create policy activity_menciones_delete on public.activity_menciones
  for delete using (workspace_id = current_user_workspace_id());

grant select, insert, delete on public.activity_menciones to authenticated;

-- ── El aviso ────────────────────────────────────────────────────────────────

create or replace function public.fn_notif_mencion_multiple()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_log record;
  v_autor_nombre text;
  v_autor_profile uuid;
  v_entidad_nombre text;
  v_deep_link text;
  v_destino_profile uuid;
begin
  select al.entidad_tipo, al.entidad_id, al.autor_id, al.workspace_id
    into v_log
  from activity_log al where al.id = new.activity_log_id;

  if v_log is null then return new; end if;

  select full_name, profile_id into v_autor_nombre, v_autor_profile
  from staff where id = v_log.autor_id limit 1;

  -- Todas las entidades del producto viven bajo /negocios (pipeline y proyectos
  -- se eliminaron en mayo).
  if v_log.entidad_tipo = 'negocio' then
    select nombre into v_entidad_nombre from negocios where id = v_log.entidad_id;
  end if;
  v_deep_link := '/negocios/' || v_log.entidad_id;

  -- ── Mencion a una persona ──
  if new.staff_id is not null then
    select profile_id into v_destino_profile from staff where id = new.staff_id limit 1;
    if v_destino_profile is null then return new; end if;
    -- D169: no notificarse a si mismo
    if v_destino_profile = v_autor_profile then return new; end if;

    perform crear_notificacion(
      v_log.workspace_id, v_destino_profile, 'mencion',
      coalesce(v_autor_nombre,'Alguien') || ' te mencionó en "' || coalesce(v_entidad_nombre,'un registro') || '"',
      v_log.entidad_tipo, v_log.entidad_id, v_deep_link,
      jsonb_build_object('autor_nombre', coalesce(v_autor_nombre,''),
                         'activity_log_id', new.activity_log_id),
      true  -- cada mencion es un hecho distinto: no deduplicar
    );
    return new;
  end if;

  -- ── Etiqueta a un equipo ──
  -- Un pendiente para toda el area: lo atiende uno, se cierra para todos.
  perform crear_notificacion_equipo(
    v_log.workspace_id,
    new.area,
    'mencion_equipo',
    coalesce(v_autor_nombre,'Alguien') || ' etiquetó a @' || new.area || ' en "' || coalesce(v_entidad_nombre,'un registro') || '"',
    'mencion:' || new.activity_log_id::text || ':' || new.area,
    v_log.entidad_tipo, v_log.entidad_id, v_deep_link,
    jsonb_build_object('autor_nombre', coalesce(v_autor_nombre,''),
                       'area', new.area,
                       'activity_log_id', new.activity_log_id),
    v_autor_profile  -- quien etiqueta no se auto-notifica
  );

  return new;
end;
$$;

drop trigger if exists trg_notif_mencion_multiple on public.activity_menciones;
create trigger trg_notif_mencion_multiple
  after insert on public.activity_menciones
  for each row execute function public.fn_notif_mencion_multiple();

-- ── Evitar el aviso doble con el camino legacy ───────────────────────────────
--
-- `activity_log.mencion_id` sigue escribiendose (el timeline la usa para mostrar
-- a quien se menciono), y su trigger `trg_notif_mencion` crearia una segunda
-- notificacion para la misma persona. Se le agrega un guard: si el comentario ya
-- tiene menciones en la tabla nueva, el camino nuevo manda.
create or replace function public.fn_notif_mencion()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_autor_profile_id uuid;
  v_mencionado_profile_id uuid;
  v_autor_nombre text;
  v_entidad_nombre text;
  v_deep_link text;
begin
  if new.mencion_id is null then
    return new;
  end if;

  -- Guard: el compositor nuevo ya registro las menciones -> no duplicar.
  if exists (select 1 from activity_menciones am where am.activity_log_id = new.id) then
    return new;
  end if;

  select profile_id into v_mencionado_profile_id
  from staff where id = new.mencion_id limit 1;
  if v_mencionado_profile_id is null then return new; end if;

  select profile_id into v_autor_profile_id from staff where id = new.autor_id limit 1;
  if v_autor_profile_id = v_mencionado_profile_id then return new; end if;

  select full_name into v_autor_nombre from staff where id = new.autor_id limit 1;

  if new.entidad_tipo = 'oportunidad' then
    select descripcion into v_entidad_nombre from oportunidades where id = new.entidad_id;
  elsif new.entidad_tipo = 'proyecto' then
    select nombre into v_entidad_nombre from proyectos where id = new.entidad_id;
  elsif new.entidad_tipo = 'negocio' then
    select nombre into v_entidad_nombre from negocios where id = new.entidad_id;
  end if;
  v_deep_link := '/negocios/' || new.entidad_id;

  perform crear_notificacion(
    new.workspace_id, v_mencionado_profile_id, 'mencion',
    coalesce(v_autor_nombre,'Alguien') || ' te mencionó en "' || coalesce(v_entidad_nombre,'un registro') || '"',
    new.entidad_tipo, new.entidad_id, v_deep_link,
    jsonb_build_object('autor_nombre', coalesce(v_autor_nombre,''),
                       'entidad_nombre', coalesce(v_entidad_nombre,''),
                       'activity_log_id', new.id),
    true
  );

  return new;
end;
$$;
