-- Asistentes MeTRIK: roles y funciones. El modelo común sobre el que salen Sabor (29-oct), Imperviun y Laura.
--
-- Spec: docs/specs/2026-10-26_asistentes-roles-y-funciones.md, §2 (2.3 a 2.5 y 2.8) y §4.2 a §4.4.
-- Decisiones de Mauricio del 26-oct: los tres asistentes salen sobre roles, Sabor desde el primer día.
--
-- ─────────────────────────────────────────────────────────────────────────────
-- Qué trae
-- ─────────────────────────────────────────────────────────────────────────────
--
-- 1. `asistente_funciones_empresa`: qué funciones del catálogo (que vive en el código) tiene prendidas un workspace.
-- 2. `asistente_roles`: la cabecera de cada rol, con el puntero `reglamento_id` a su versión publicada en
--    `bot_reglamentos` (bot = 'rol:' || clave). Un trigger exige que el puntero sea del mismo workspace y del mismo rol.
-- 3. `asistente_asignaciones`: qué persona (staff o colaborador), cargo o canal (inbox) habla con qué rol, con
--    vigencia. Una sola asignación vigente por sujeto, sin solapes.
-- 4. `asistente_publicar_rol`: publica la versión de un rol solo si el banco del arnés pasa (k >= 3), la huella de lo
--    probado es la de lo publicado y toda función asignada está prendida en la empresa. Si no, revierte la versión.
-- 5. `asistente_resolver_rol`: la lectura del componedor, en una sola ida: la asignación vigente más específica
--    (persona, luego cargo, luego inbox) en el canal del turno, su rol con el puntero y las funciones que quedan
--    (las del rol ∩ las prendidas en la empresa). Solo lectura.
-- 6. `asistente_escalamientos`, `asistente_calificaciones` y `asistente_preferencias` (§4.2, §4.4 y la regla 3 del ADN).
--
-- La huella (§2.8, supuesto 6). `bot_publicar_reglamento` guarda sha256 de `fichas::text` de jsonb (con espacios,
-- llaves en el orden interno de jsonb y fichas en el orden de la intercalación de la base). `huellaDe` del arnés
-- (TypeScript) hace sha256 de JSON.stringify con llaves ordenadas y fichas por `localeCompare`. Medido en PGlite con el
-- reglamento de Sabor: dan distinto (y `localeCompare` pone `rf.persona_por_que` antes de `rf.persona.crisis`, al
-- revés que la intercalación C). Por eso aquí no se compara la columna `huella`: se compara
-- `asistente_huella_fichas(fichas)`, un canónico definido igual en los dos lados (fichas sin nulos y ordenadas por
-- clave en orden de bytes, llaves en orden de bytes, JSON sin espacios). Su gemelo en TypeScript es `huellaPublicable`
-- (`supabase/functions/_shared/agente/reglamento.ts`), y la prueba `roles-sql.test.ts` exige que coincidan.
--
-- No siembra nada: los roles, las funciones prendidas y las asignaciones de cada cliente se cargan por SQL aparte.
-- No toca datos existentes. Nada del código de hoy lee estas tablas hasta que entre el componedor.
--
-- epoca: no-rompe tablas y funciones nuevas; nada del código de hoy las usa.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Funciones prendidas por empresa
-- ─────────────────────────────────────────────────────────────────────────────

create table public.asistente_funciones_empresa (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- Clave del catálogo en código: 'equipo.gastos', 'clientes.ficha'… Las comunes (`nucleo.*`, `comun.*`) no se prenden.
  funcion text not null,
  activa boolean not null default true,
  parametros jsonb not null default '{}'::jsonb,
  -- Quién la prendió (correo o 'max'), como `bot_reglamentos.publicado_por`.
  prendida_por text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, funcion),
  constraint asistente_funciones_empresa_clave check (funcion ~ '^(equipo|recolector|clientes)\.[a-z][a-z0-9_]*$'),
  constraint asistente_funciones_empresa_parametros check (jsonb_typeof(parametros) = 'object')
);

comment on table public.asistente_funciones_empresa is
  'Funciones del catalogo de asistentes (que vive en el codigo) prendidas por workspace, con sus parametros. Una clave que el codigo no conoce se ignora. Spec 2026-10-26 asistentes-roles-y-funciones, 2.3.';

alter table public.asistente_funciones_empresa enable row level security;
-- server-only: la lee el componedor del agente con la llave de servicio y la cambia MéTRIK por SQL.
revoke all on public.asistente_funciones_empresa from anon, authenticated;
grant all on public.asistente_funciones_empresa to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Roles (la cabecera; el contenido va en la versión publicada de bot_reglamentos)
-- ─────────────────────────────────────────────────────────────────────────────

create table public.asistente_roles (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- 'mano_derecha', 'recolector', 'asesor_vendedor'. Su reglamento se publica con bot = 'rol:' || clave.
  clave text not null,
  familia text not null,
  canal text not null,
  -- El puntero. Null = el rol no se ha publicado. Marcha atrás = mover el puntero a una versión anterior.
  reglamento_id uuid references public.bot_reglamentos(id),
  -- Nace apagado: se prende después de publicar con un banco que pasa y mover el puntero.
  activo boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint asistente_roles_clave unique (workspace_id, clave),
  -- Para que una asignación no pueda apuntar a un rol de otro workspace (llave foránea compuesta).
  constraint asistente_roles_id_workspace unique (id, workspace_id),
  constraint asistente_roles_clave_forma check (clave ~ '^[a-z][a-z0-9_]*$'),
  constraint asistente_roles_familia check (familia in ('equipo', 'clientes')),
  constraint asistente_roles_canal check (canal in ('wa_one', 'chatwoot', 'wa_propio')),
  constraint asistente_roles_activo_publicado check (not activo or reglamento_id is not null)
);

comment on table public.asistente_roles is
  'Cabecera de cada rol de asistente por workspace. reglamento_id es el puntero a su version publicada en bot_reglamentos (bot = rol:<clave>). Spec 2026-10-26, 2.4.';

-- El puntero tiene que ser una versión del MISMO workspace y del bot del rol. También refresca updated_at.
create or replace function public.asistente_roles_puntero_valido() returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.reglamento_id is not null and not exists (
    select 1 from public.bot_reglamentos r
    where r.id = new.reglamento_id and r.workspace_id = new.workspace_id and r.bot = 'rol:' || new.clave
  ) then
    raise exception 'el reglamento % no es una version del rol % en este workspace', new.reglamento_id, new.clave;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke execute on function public.asistente_roles_puntero_valido() from public, anon, authenticated;

create trigger asistente_roles_puntero_valido
  before insert or update on public.asistente_roles
  for each row execute function public.asistente_roles_puntero_valido();

alter table public.asistente_roles enable row level security;
-- server-only: la lee el componedor del agente con la llave de servicio y la cambia MéTRIK por SQL.
revoke all on public.asistente_roles from anon, authenticated;
grant all on public.asistente_roles to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Asignaciones: quién (persona, cargo o canal) habla con qué rol
-- ─────────────────────────────────────────────────────────────────────────────
--
-- La llave del staff es `staff.id`, no `profiles.id`: el bot reconoce al staff por `staff.phone_whatsapp`
-- (`wa_identify_user`), y hay staff con WhatsApp y sin cuenta en ONE (sin perfil). La resolución acepta el `user_id`
-- que trae `identificarRemitente` y lo cruza contra `staff.id` o `staff.profile_id`, siempre dentro del workspace,
-- igual que `staffIdDelRemitente` (`_shared/wa-bandeja.ts`).
--
-- El inbox se guarda con su origen para que no choquen dos números: 'cw:<cuenta_id>:<inbox_id>' (Chatwoot, los dos
-- enteros que ya lee `leerPayload`) o 'wa:<phone_number_id>' (Meta, `value.metadata.phone_number_id`).

create table public.asistente_asignaciones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rol_id uuid not null,
  sujeto_tipo text not null,
  staff_id uuid references public.staff(id) on delete cascade,
  collaborator_id uuid references public.wa_collaborators(id) on delete cascade,
  cargo text,
  inbox text,
  -- La llave del sujeto como texto, para el índice de vigencia y la búsqueda de solapes.
  sujeto text generated always as (coalesce(staff_id::text, collaborator_id::text, cargo, inbox)) stored,
  desde timestamptz not null default now(),
  hasta timestamptz,
  asignado_por text not null,
  created_at timestamptz not null default now(),
  constraint asistente_asignaciones_rol foreign key (rol_id, workspace_id)
    references public.asistente_roles(id, workspace_id) on delete cascade,
  constraint asistente_asignaciones_tipo check (sujeto_tipo in ('staff', 'colaborador', 'cargo', 'inbox')),
  constraint asistente_asignaciones_una_llave check (
    (sujeto_tipo = 'staff'       and staff_id is not null and collaborator_id is null and cargo is null and inbox is null) or
    (sujeto_tipo = 'colaborador' and collaborator_id is not null and staff_id is null and cargo is null and inbox is null) or
    (sujeto_tipo = 'cargo'       and cargo is not null and staff_id is null and collaborator_id is null and inbox is null) or
    (sujeto_tipo = 'inbox'       and inbox is not null and staff_id is null and collaborator_id is null and cargo is null)
  ),
  constraint asistente_asignaciones_cargo check (cargo is null or cargo in ('owner', 'admin', 'supervisor', 'operator', 'contador', 'read_only')),
  constraint asistente_asignaciones_inbox check (inbox is null or inbox ~ '^(cw:[0-9]+:[0-9]+|wa:[0-9]+)$'),
  constraint asistente_asignaciones_vigencia check (hasta is null or hasta > desde)
);

comment on table public.asistente_asignaciones is
  'Que staff, colaborador, cargo o inbox habla con que rol de asistente, con vigencia [desde, hasta). Gana la vigente mas especifica: persona, luego cargo, luego inbox. Spec 2026-10-26, 2.5.';

-- Un sujeto tiene una sola asignación abierta por workspace (el trigger de abajo cubre además los solapes con fin).
create unique index asistente_asignaciones_vigente on public.asistente_asignaciones (workspace_id, sujeto_tipo, sujeto)
  where hasta is null;
create index asistente_asignaciones_rol on public.asistente_asignaciones (rol_id);

-- El staff y el colaborador tienen que ser del mismo workspace, y un sujeto no puede tener dos asignaciones que se
-- solapen en el tiempo (así la resolución nunca desempata).
create or replace function public.asistente_asignaciones_validar() returns trigger
language plpgsql
set search_path = public
as $$
declare
  -- En un trigger BEFORE la columna generada `sujeto` todavía no está calculada: se arma aquí con la misma expresión.
  v_sujeto text := coalesce(new.staff_id::text, new.collaborator_id::text, new.cargo, new.inbox);
begin
  -- Lo que atajan los checks de la tabla (una llave, vigencia) se deja a ellos, que corren después del trigger.
  if v_sujeto is null or (new.hasta is not null and new.hasta <= new.desde) then
    return new;
  end if;
  if new.staff_id is not null and not exists (
    select 1 from public.staff s where s.id = new.staff_id and s.workspace_id = new.workspace_id
  ) then
    raise exception 'el staff % no es de este workspace', new.staff_id;
  end if;
  if new.collaborator_id is not null and not exists (
    select 1 from public.wa_collaborators c where c.id = new.collaborator_id and c.workspace_id = new.workspace_id
  ) then
    raise exception 'el colaborador % no es de este workspace', new.collaborator_id;
  end if;
  -- Serializa las escrituras del mismo sujeto para que dos transacciones no metan solapes a la vez.
  perform pg_advisory_xact_lock(hashtext('asistente_asignaciones|' || new.workspace_id || '|' || new.sujeto_tipo || '|' || v_sujeto));
  if exists (
    select 1 from public.asistente_asignaciones a
    where a.workspace_id = new.workspace_id and a.sujeto_tipo = new.sujeto_tipo and a.sujeto = v_sujeto
      and a.id <> new.id
      and tstzrange(a.desde, a.hasta) && tstzrange(new.desde, new.hasta)
  ) then
    raise exception 'el sujeto % % ya tiene una asignacion que se cruza con [%, %)', new.sujeto_tipo, v_sujeto, new.desde, new.hasta;
  end if;
  return new;
end;
$$;

revoke execute on function public.asistente_asignaciones_validar() from public, anon, authenticated;

create trigger asistente_asignaciones_validar
  before insert or update on public.asistente_asignaciones
  for each row execute function public.asistente_asignaciones_validar();

alter table public.asistente_asignaciones enable row level security;
-- server-only: la lee el componedor del agente con la llave de servicio y la cambia MéTRIK o el admin por SQL.
revoke all on public.asistente_asignaciones from anon, authenticated;
grant all on public.asistente_asignaciones to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. La huella comparable con el arnés y la publicación de un rol
-- ─────────────────────────────────────────────────────────────────────────────

-- JSON canónico: llaves en orden de bytes, sin espacios, cadenas escapadas como JSON.stringify, enteros sin decimales.
-- Gemelo de `canonicoPublicable` en TypeScript. Límite asumido: un número no entero con |x| < 1e-4 o >= 1e15 se escribe
-- distinto en Postgres y en JavaScript; la huella no coincide y el rol no se publica (falla hacia el lado seguro).
create or replace function public.asistente_json_canonico(p jsonb) returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  n numeric;
  t text;
begin
  case jsonb_typeof(p)
    when 'object' then
      return '{' || coalesce((
        select string_agg(to_json(e.key)::text || ':' || public.asistente_json_canonico(e.value), ',' order by e.key collate "C")
        from jsonb_each(p) e
      ), '') || '}';
    when 'array' then
      return '[' || coalesce((
        select string_agg(public.asistente_json_canonico(e.value), ',' order by e.i)
        from jsonb_array_elements(p) with ordinality as e(value, i)
      ), '') || ']';
    when 'string' then
      return to_json(p #>> '{}')::text;
    when 'number' then
      n := (p #>> '{}')::numeric;
      if n = trunc(n) and abs(n) < 1e21 then
        return trunc(n)::text;
      end if;
      t := n::float8::text;
      return regexp_replace(t, 'e([+-])0*([0-9])', 'e\1\2');
    else
      return p::text;  -- true, false, null
  end case;
end;
$$;

revoke execute on function public.asistente_json_canonico(jsonb) from public, anon, authenticated;
grant execute on function public.asistente_json_canonico(jsonb) to service_role;

-- La huella de un arreglo de fichas como la calcula el arnés (`huellaPublicable`): cada ficha sin nulos y sin `fuente`
-- vacía (las semillas guardan `fuente || null`, así que en el código '' y en la base nada son la misma ficha), ordenadas
-- por clave en orden de bytes, sha256 del canónico.
create or replace function public.asistente_huella_fichas(p_fichas jsonb) returns text
language sql
immutable
set search_path = public
as $$
  select encode(sha256(convert_to(
    '[' || coalesce((
      select string_agg(public.asistente_json_canonico(
        case when f->>'fuente' = '' then jsonb_strip_nulls(f) - 'fuente' else jsonb_strip_nulls(f) end
      ), ',' order by f->>'clave' collate "C")
      from jsonb_array_elements(p_fichas) f
    ), '') || ']',
    'UTF8')), 'hex');
$$;

revoke execute on function public.asistente_huella_fichas(jsonb) from public, anon, authenticated;
grant execute on function public.asistente_huella_fichas(jsonb) to service_role;

-- Publica una versión del rol. Exige: el rol registrado; un banco con pasa = true, k >= 3, fecha y la huella de las
-- fichas probadas; que esa huella sea la de lo publicado; la ficha `rol.funciones` y todas sus funciones prendidas en
-- la empresa (las comunes `nucleo.*` y `comun.*` no se prenden y no se exigen). Cualquier rechazo lanza, y la
-- excepción revierte también la versión que insertó `bot_publicar_reglamento` (es la misma transacción).
-- No mueve el puntero: `asistente_roles.reglamento_id` se cambia aparte y a propósito.
create or replace function public.asistente_publicar_rol(
  p_workspace_id uuid,
  p_rol text,
  p_publicado_por text,
  p_banco jsonb
) returns uuid
language plpgsql
set search_path = public
as $$
declare
  v_id uuid;
  v_fichas jsonb;
  v_funciones jsonb;
  v_raras text[];
  v_faltan text[];
begin
  if not exists (select 1 from public.asistente_roles where workspace_id = p_workspace_id and clave = p_rol) then
    raise exception 'el rol % no esta registrado en asistente_roles de este workspace', p_rol;
  end if;

  if p_banco is null or jsonb_typeof(p_banco) <> 'object'
     or p_banco->'pasa' is distinct from 'true'::jsonb
     or jsonb_typeof(p_banco->'k') is distinct from 'number' or (p_banco->>'k')::numeric < 3
     or coalesce(p_banco->>'fecha', '') = ''
     or coalesce(p_banco->>'huella_fichas', '') !~ '^[0-9a-f]{64}$' then
    raise exception 'el rol % no se publica sin un banco del arnes que pase con k >= 3, fecha y huella_fichas', p_rol;
  end if;

  v_id := public.bot_publicar_reglamento(p_workspace_id, 'rol:' || p_rol, p_publicado_por, p_banco);
  select fichas into v_fichas from public.bot_reglamentos where id = v_id;

  -- Lo probado tiene que ser lo publicado.
  if public.asistente_huella_fichas(v_fichas) <> p_banco->>'huella_fichas' then
    raise exception 'las fichas del rol % cambiaron despues de la prueba: vuelve a correr el arnes', p_rol;
  end if;

  select f->'valores'->'funciones' into v_funciones
  from jsonb_array_elements(v_fichas) f
  where f->>'clave' = 'rol.funciones';
  if jsonb_typeof(v_funciones) is distinct from 'array' then
    raise exception 'el rol % no trae la ficha rol.funciones con valores.funciones', p_rol;
  end if;

  select array_agg(coalesce(e.v #>> '{}', e.v::text)) into v_raras
  from jsonb_array_elements(v_funciones) as e(v)
  where jsonb_typeof(e.v) <> 'string'
     or (e.v #>> '{}') !~ '^(nucleo|comun|equipo|recolector|clientes)\.[a-z][a-z0-9_]*$';
  if v_raras is not null then
    raise exception 'funciones con forma invalida en el rol %: %', p_rol, v_raras;
  end if;

  select array_agg(x order by x) into v_faltan
  from jsonb_array_elements_text(v_funciones) x
  where x !~ '^(nucleo|comun)\.'
    and not exists (
      select 1 from public.asistente_funciones_empresa e
      where e.workspace_id = p_workspace_id and e.funcion = x and e.activa
    );
  if v_faltan is not null then
    raise exception 'funciones asignadas al rol % que la empresa no tiene prendidas: %', p_rol, v_faltan;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.asistente_publicar_rol(uuid, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.asistente_publicar_rol(uuid, text, text, jsonb) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. La lectura del componedor (una ida por turno)
-- ─────────────────────────────────────────────────────────────────────────────
--
-- Entra lo que ya sabe el turno: el canal ('wa_one', 'chatwoot', 'wa_propio'), y del remitente lo que haya: el
-- `user_id` del staff (perfil o staff, se aceptan los dos dentro del workspace), el `collaborator_id`, el cargo
-- (`WaUser.role`) y el inbox ('cw:<cuenta>:<inbox>' o 'wa:<phone_number_id>'). Lo que no aplique va en null.
--
-- Devuelve siempre un jsonb:
--   { usa_roles: false, rol: null }   el workspace no tiene roles en ese canal → enrutamiento de hoy;
--   { usa_roles: true,  rol: null }   tiene roles pero ninguna asignación vigente cubre a este remitente;
--   { usa_roles: true,  rol: { id, clave, familia, canal, activo, reglamento_id, version, por, asignacion_id,
--                              funciones: [{ funcion, parametros }], funciones_apagadas: [..] } }
-- `funciones` = las de `rol.funciones` de la versión del puntero ∩ las prendidas en la empresa (las comunes pasan
-- siempre, sin parámetros); `funciones_apagadas` = asignadas pero no prendidas (para el log). Si el rol está apagado o
-- sin publicar, se devuelve igual (`activo`, `reglamento_id`) y decide el canal. El reglamento completo NO viaja: el
-- componedor lo lee por id con la caché de `cargarReglamento`.
create or replace function public.asistente_resolver_rol(
  p_workspace_id uuid,
  p_canal text,
  p_staff uuid default null,
  p_colaborador uuid default null,
  p_cargo text default null,
  p_inbox text default null
) returns jsonb
language sql
stable
set search_path = public
as $$
  with staff_del_remitente as (
    select s.id from public.staff s
    where p_staff is not null and s.workspace_id = p_workspace_id and (s.id = p_staff or s.profile_id = p_staff)
    order by (s.id = p_staff) desc
    limit 1
  ),
  elegida as (
    select a.id as asignacion_id, a.sujeto_tipo, r.*
    from public.asistente_asignaciones a
    join public.asistente_roles r on r.id = a.rol_id and r.workspace_id = a.workspace_id
    where a.workspace_id = p_workspace_id
      and r.canal = p_canal
      and a.desde <= now() and (a.hasta is null or a.hasta > now())
      and (
        (a.sujeto_tipo = 'staff' and a.staff_id = (select id from staff_del_remitente))
        or (a.sujeto_tipo = 'colaborador' and a.collaborator_id = p_colaborador)
        or (a.sujeto_tipo = 'cargo' and a.cargo = p_cargo)
        or (a.sujeto_tipo = 'inbox' and a.inbox = p_inbox)
      )
    order by case a.sujeto_tipo when 'staff' then 1 when 'colaborador' then 1 when 'cargo' then 2 else 3 end,
             a.desde desc, a.id
    limit 1
  ),
  asignadas as (
    select f.value #>> '{}' as funcion, f.ordinality as orden
    from elegida e
    join public.bot_reglamentos b on b.id = e.reglamento_id
    cross join lateral jsonb_array_elements(b.fichas) ficha
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(ficha->'valores'->'funciones') = 'array' then ficha->'valores'->'funciones' else '[]'::jsonb end
    ) with ordinality f
    where ficha->>'clave' = 'rol.funciones' and jsonb_typeof(f.value) = 'string'
  ),
  cruzadas as (
    select a.funcion, a.orden, fe.parametros,
           (a.funcion ~ '^(nucleo|comun)\.' or coalesce(fe.activa, false)) as prendida
    from asignadas a
    left join public.asistente_funciones_empresa fe on fe.workspace_id = p_workspace_id and fe.funcion = a.funcion
  )
  select jsonb_build_object(
    'usa_roles', exists (select 1 from public.asistente_roles r where r.workspace_id = p_workspace_id and r.canal = p_canal),
    'rol', (
      select jsonb_build_object(
        'id', e.id, 'clave', e.clave, 'familia', e.familia, 'canal', e.canal, 'activo', e.activo,
        'reglamento_id', e.reglamento_id,
        'version', (select b.version from public.bot_reglamentos b where b.id = e.reglamento_id),
        'por', e.sujeto_tipo, 'asignacion_id', e.asignacion_id,
        'funciones', coalesce((
          select jsonb_agg(jsonb_build_object('funcion', c.funcion, 'parametros', coalesce(c.parametros, '{}'::jsonb)) order by c.orden)
          from cruzadas c where c.prendida
        ), '[]'::jsonb),
        'funciones_apagadas', coalesce((
          select jsonb_agg(c.funcion order by c.orden) from cruzadas c where not c.prendida
        ), '[]'::jsonb)
      )
      from elegida e
    )
  );
$$;

revoke execute on function public.asistente_resolver_rol(uuid, text, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.asistente_resolver_rol(uuid, text, uuid, uuid, text, text) to service_role;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Traspasos, calificaciones y preferencias
-- ─────────────────────────────────────────────────────────────────────────────

-- Traspasos a una persona (resumen diario y la métrica «escalamientos hechos y debidos», §4.2 y §2.9).
create table public.asistente_escalamientos (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- La clave y no el id: el registro sobrevive si el rol se renombra o se borra.
  rol_clave text not null,
  canal text not null,
  -- 'wa:<phone>' o 'cw:<cuenta>:<conversacion>'.
  conversacion text not null,
  -- pide_persona, bucle, no_pude, frustracion, sin_dato, falla, …
  motivo text not null,
  -- Lo arma el código; nunca un dato sensible.
  resumen text not null,
  -- 'ofrecido' (la persona no lo tomó), 'pasado' (Chatwoot), 'link' (botón a WhatsApp).
  modo text not null,
  created_at timestamptz not null default now(),
  constraint asistente_escalamientos_canal check (canal in ('wa_one', 'chatwoot', 'wa_propio')),
  constraint asistente_escalamientos_modo check (modo in ('ofrecido', 'pasado', 'link')),
  constraint asistente_escalamientos_motivo check (motivo <> '')
);

comment on table public.asistente_escalamientos is
  'Traspasos de un asistente a una persona (ofrecido, pasado en Chatwoot o link a WhatsApp). Sin datos sensibles. Spec 2026-10-26, 4.2.';

create index asistente_escalamientos_dia on public.asistente_escalamientos (workspace_id, created_at);

alter table public.asistente_escalamientos enable row level security;
-- server-only: la escriben los asistentes y la lee el resumen diario, con la llave de servicio.
revoke all on public.asistente_escalamientos from anon, authenticated;
grant all on public.asistente_escalamientos to service_role;

-- Calificación diaria de conversaciones (una fila por conversación y día de Bogotá, §4.4).
create table public.asistente_calificaciones (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  rol_clave text not null,
  fecha date not null,
  conversacion text not null,
  -- [{ tipo: 'F6', turno: '<turno_id>', evidencia: '…' }]
  fallas jsonb not null default '[]'::jsonb,
  resuelta boolean,
  nota smallint,
  -- Modelo y versión de la lista de fallas.
  juez text not null,
  -- Quién la confirmó o corrigió (calibración).
  revisada_por text,
  created_at timestamptz not null default now(),
  constraint asistente_calificaciones_una unique (workspace_id, fecha, conversacion),
  constraint asistente_calificaciones_nota check (nota is null or nota between 1 and 5),
  constraint asistente_calificaciones_fallas check (jsonb_typeof(fallas) = 'array')
);

comment on table public.asistente_calificaciones is
  'Calificacion diaria de cada conversacion de un asistente contra la lista fija de fallas. Evidencia corta, no la conversacion. Spec 2026-10-26, 4.4.';

alter table public.asistente_calificaciones enable row level security;
-- server-only: la escribe el cron de calificación y la lee el resumen diario, con la llave de servicio.
revoke all on public.asistente_calificaciones from anon, authenticated;
grant all on public.asistente_calificaciones to service_role;

-- Preferencias recordadas (regla 3 del ADN). Se proponen con un toque; nunca se aprenden en silencio.
create table public.asistente_preferencias (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  -- 'staff:<id>' o 'colaborador:<id>'.
  sujeto text not null,
  -- 'proveedor:<nit o nombre normalizado>'.
  clave text not null,
  -- { destino: 'empresa' } o { rubro: '<id>' }.
  valor jsonb not null,
  -- El turno del toque que la aceptó.
  confirmada_en_turno uuid not null,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  constraint asistente_preferencias_una unique (workspace_id, sujeto, clave),
  constraint asistente_preferencias_sujeto check (sujeto ~ '^(staff|colaborador):[0-9a-f-]{36}$')
);

comment on table public.asistente_preferencias is
  'Preferencias que una persona confirmo con un toque (este proveedor siempre es gasto de empresa). Spec 2026-10-26, regla 3 del ADN.';

alter table public.asistente_preferencias enable row level security;
-- server-only: la leen y escriben los asistentes con la llave de servicio.
revoke all on public.asistente_preferencias from anon, authenticated;
grant all on public.asistente_preferencias to service_role;
