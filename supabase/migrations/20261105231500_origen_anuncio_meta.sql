-- Origen del anuncio de Meta: de qué anuncio llegó cada persona que escribe (recomendación 7 del informe de
-- arquitectura de agentes conversacionales; encargo max-agus-origen-anuncio, 2026-11-05).
--
-- Por qué: Meta manda el `referral` (anuncio, `ctwa_clid`, URL, titular) SOLO en el primer mensaje después del clic.
-- Hasta hoy ningún canal lo leía (`git grep referral` en supabase/functions = 0), así que cada día sin captura era
-- atribución perdida para siempre.
--
-- Qué hace (aditiva; no reescribe ni una fila existente):
--   1. `origen_toques`: cada toque de origen que llega de Meta, con el JSON crudo y los campos normalizados. El
--      primero por persona y alcance queda marcado `es_primero` (índice único parcial) y nadie puede cambiar sus campos
--      de origen (disparador). Los siguientes son filas aparte.
--   2. `origen_canales`: a qué empresa pertenece cada número, página o cuenta de Meta (alcance). Sin fila, el toque se
--      guarda igual con `workspace_id` nulo y se le asigna después: perder el dato es peor que guardarlo sin dueño.
--   3. `registrar_toque_origen(...)`: la única puerta de escritura (la llaman wa-webhook y chatwoot-agente con la llave
--      de servicio). Idempotente por mensaje: el reintento de Meta no duplica.
--   4. Contacto y negocio: al crear un contacto con el teléfono de un primer toque de WhatsApp (o al llegar el toque de
--      un contacto que ya existe), se llenan `contactos.origen_tipo = 'anuncio_meta'`, `origen_ref`, `campana_origen` y
--      `origen_capturado_at` si estaban vacíos; y un negocio nuevo de ese contacto sin `origen` declarado nace con
--      `origen = 'meta'`. Solo llena vacíos: nunca pisa lo que alguien declaró.
--   5. `chatwoot_conversacion.canal` acepta 'messenger' (hoy las 206 filas dicen 'otro' porque el inbox de Dimpro es
--      `Channel::FacebookPage` y ni el código ni este CHECK conocían Messenger).
--
-- Alcance (`alcance`): dónde vive el id de la persona, porque Meta lo emite por alcance:
--   whatsapp  -> el phone_number_id del número que recibió (o 'cw:<cuenta>:<inbox>' si llegó por Chatwoot)
--   messenger -> el page_id (el PSID es por página)
--   instagram -> el id de la cuenta de IG (el IGSID es por cuenta)
-- El índice del primer toque es (canal, alcance, id_externo) y no (workspace_id, canal, id_externo): el alcance ya
-- identifica a la empresa y `workspace_id` puede llegar nulo (sin fila en `origen_canales`).
--
-- NO toca datos de producción: no hay UPDATE ni INSERT sobre filas existentes. Las filas viejas de
-- chatwoot_conversacion se quedan en 'otro' (cambiarlas es escribir en Dimpro: aparte y con su autorización).
--
-- DRY-RUN: `DO $dry$ ... EXECUTE <este archivo> ... RAISE EXCEPTION 'DRY-RUN OK'` por la Management API. Se aplica
-- con visto de Mauricio ANTES del merge (el merge despliega solo).
--
-- epoca: no-rompe solo agrega tablas, funciones y disparadores, y amplía dos CHECK (nada que el código viejo espere desaparece)

-- ── 0. Teléfono comparable ──────────────────────────────────────────────────────────────────────────────────────
-- Solo dígitos; un celular colombiano de 10 dígitos (3xx) gana el 57 para compararse con el wa_id de Meta.
create or replace function public.telefono_clave(p text)
returns text
language sql
immutable
set search_path = public, pg_temp
as $$
  select case
    when d is null or d = '' then null
    when length(d) = 10 and left(d, 1) = '3' then '57' || d
    else d
  end
  from (select regexp_replace(coalesce(p, ''), '\D', '', 'g') as d) x;
$$;

revoke execute on function public.telefono_clave(text) from public, anon, authenticated;

-- ── 1. A qué empresa pertenece cada número, página o cuenta de Meta ──────────────────────────────────────────────
-- server-only: la leen wa-webhook, chatwoot-agente y (Fase B) meta-origen con la llave de servicio; la llena MéTRIK.
create table public.origen_canales (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  canal text not null check (canal in ('whatsapp', 'instagram', 'messenger')),
  alcance text not null check (length(btrim(alcance)) between 1 and 200),
  nota text check (nota is null or length(nota) <= 300),
  created_at timestamptz not null default now(),
  constraint origen_canales_unico unique (canal, alcance)
);

alter table public.origen_canales enable row level security;
revoke all on public.origen_canales from anon, authenticated;

comment on table public.origen_canales is
  'Que empresa es duena de cada numero (phone_number_id), pagina (page_id) o cuenta de IG, para atribuir los toques de origen.';

-- ── 2. Los toques de origen ─────────────────────────────────────────────────────────────────────────────────────
-- server-only: la escriben wa-webhook y chatwoot-agente (y la Fase B) por `registrar_toque_origen`, con la llave de servicio.
create table public.origen_toques (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id) on delete cascade,
  canal text not null check (canal in ('whatsapp', 'instagram', 'messenger')),
  alcance text not null check (length(btrim(alcance)) between 1 and 200),
  -- whatsapp: el wa_id (teléfono) o, sin él, el BSUID; messenger: PSID; instagram: IGSID.
  id_externo text not null check (length(btrim(id_externo)) between 1 and 200),
  es_primero boolean not null,
  contacto_id uuid references public.contactos(id) on delete set null,
  fuente text not null check (fuente in ('wa-webhook', 'chatwoot', 'meta-origen')),
  -- El id del mensaje que trajo el toque (wamid, mid o id de Chatwoot): la idempotencia ante reintentos.
  mensaje_id text check (mensaje_id is null or length(mensaje_id) <= 300),
  -- Normalizados del `referral` de Meta (WhatsApp: source_type/source_id/source_url/headline/ctwa_clid;
  -- Messenger e IG: source/type/ad_id/ref y ads_context_data). Lo que no llegó queda nulo.
  source_type text check (source_type is null or length(source_type) <= 100),
  source_id text check (source_id is null or length(source_id) <= 200),
  ad_id text check (ad_id is null or length(ad_id) <= 200),
  ctwa_clid text check (ctwa_clid is null or length(ctwa_clid) <= 500),
  source_url text check (source_url is null or length(source_url) <= 2000),
  headline text check (headline is null or length(headline) <= 1000),
  ref text check (ref is null or length(ref) <= 1000),
  -- El objeto `referral` completo, tal como llegó.
  crudo jsonb not null check (jsonb_typeof(crudo) = 'object'),
  created_at timestamptz not null default now()
);

create unique index origen_toques_primero on public.origen_toques (canal, alcance, id_externo) where es_primero;
create unique index origen_toques_mensaje on public.origen_toques (fuente, alcance, mensaje_id) where mensaje_id is not null;
create index origen_toques_ws_externo on public.origen_toques (workspace_id, canal, id_externo);
create index origen_toques_contacto on public.origen_toques (contacto_id) where contacto_id is not null;

alter table public.origen_toques enable row level security;
revoke all on public.origen_toques from anon, authenticated;

comment on table public.origen_toques is
  'Toques de origen de Meta (referral de anuncios). El primero por (canal, alcance, id_externo) es inmutable; los siguientes, filas aparte.';

-- Los campos de origen no se editan; solo se puede asignar la empresa (de nulo a una) y el contacto. Borrar sí se
-- puede (supresión de datos: «borren mis datos»).
create or replace function public.origen_toques_inmutable()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if (new.canal, new.alcance, new.id_externo, new.es_primero, new.fuente, new.mensaje_id, new.source_type, new.source_id,
      new.ad_id, new.ctwa_clid, new.source_url, new.headline, new.ref, new.crudo, new.created_at)
     is distinct from
     (old.canal, old.alcance, old.id_externo, old.es_primero, old.fuente, old.mensaje_id, old.source_type, old.source_id,
      old.ad_id, old.ctwa_clid, old.source_url, old.headline, old.ref, old.crudo, old.created_at) then
    raise exception 'el toque de origen % no se edita', old.id using errcode = 'P0001';
  end if;
  if old.workspace_id is not null and new.workspace_id is distinct from old.workspace_id then
    raise exception 'el toque de origen % ya tiene empresa', old.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke execute on function public.origen_toques_inmutable() from public, anon, authenticated;

create trigger origen_toques_inmutable
  before update on public.origen_toques
  for each row execute function public.origen_toques_inmutable();

-- Guarda de misma empresa (20261105170000, SQLSTATE MK002): el contacto del toque es de la misma empresa.
create trigger guarda_misma_empresa_contacto
  before insert or update of contacto_id, workspace_id on public.origen_toques
  for each row when (new.contacto_id is not null)
  execute function public.guarda_misma_empresa('contacto_id', 'contactos');

-- ── 3. Contacto: origen desde el primer toque ───────────────────────────────────────────────────────────────────
alter table public.contactos drop constraint if exists contactos_origen_tipo_chk;
alter table public.contactos add constraint contactos_origen_tipo_chk check (origen_tipo is null or origen_tipo in
  ('inbound_formulario', 'rues_certificado', 'sitio_web_empresa', 'referido_cliente', 'via_aliado', 'red_profesional', 'evento',
   'anuncio_meta')) not valid;

-- Llena los vacíos de origen del contacto con el toque. No pisa nada declarado. Devuelve true si cambió algo.
create or replace function public.origen_a_contacto(p_toque public.origen_toques, p_contacto_id uuid)
returns boolean
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_n integer;
begin
  update public.contactos c
     set origen_tipo = 'anuncio_meta',
         origen_ref = coalesce(p_toque.source_url, 'meta:' || p_toque.canal || ':' || coalesce(p_toque.ad_id, p_toque.source_id, p_toque.ref, 'sin_id'))
                      || ' (toque ' || p_toque.id || ')',
         campana_origen = coalesce(p_toque.ad_id, p_toque.source_id),
         origen_capturado_at = p_toque.created_at
   where c.id = p_contacto_id
     and c.workspace_id = p_toque.workspace_id
     and c.origen_tipo is null and c.origen_ref is null and c.campana_origen is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$$;

revoke execute on function public.origen_a_contacto(public.origen_toques, uuid) from public, anon, authenticated;

-- Al crear un contacto con teléfono: si hay toques de WhatsApp sin contacto con ese teléfono en su empresa, se
-- vinculan, y el primero llena su origen. Después del insert porque el toque apunta al contacto por llave foránea.
create or replace function public.contacto_toma_origen()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_clave text := public.telefono_clave(new.telefono);
  v_primero public.origen_toques;
begin
  if v_clave is null then
    return null;
  end if;
  update public.origen_toques t set contacto_id = new.id
   where t.workspace_id = new.workspace_id and t.canal = 'whatsapp' and t.id_externo = v_clave and t.contacto_id is null;
  select * into v_primero from public.origen_toques t
   where t.workspace_id = new.workspace_id and t.canal = 'whatsapp' and t.id_externo = v_clave and t.es_primero
   order by t.created_at limit 1;
  if found then
    perform public.origen_a_contacto(v_primero, new.id);
  end if;
  return null;
end;
$$;

revoke execute on function public.contacto_toma_origen() from public, anon, authenticated;

create trigger contacto_toma_origen
  after insert on public.contactos
  for each row when (new.telefono is not null and new.origen_tipo is null)
  execute function public.contacto_toma_origen();

-- ── 4. Negocio: nace con origen 'meta' si su contacto llegó por un anuncio y nadie declaró otro ─────────────────
create or replace function public.negocio_toma_origen()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if exists (select 1 from public.contactos c
              where c.id = new.contacto_id and c.workspace_id = new.workspace_id and c.origen_tipo = 'anuncio_meta') then
    new.origen := 'meta';
  end if;
  return new;
end;
$$;

revoke execute on function public.negocio_toma_origen() from public, anon, authenticated;

create trigger negocio_toma_origen
  before insert on public.negocios
  for each row when (new.contacto_id is not null and new.origen is null)
  execute function public.negocio_toma_origen();

-- ── 5. La puerta de escritura ───────────────────────────────────────────────────────────────────────────────────
-- Graba el toque y devuelve su id. Primero si no había primero para (canal, alcance, id_externo). Idempotente por
-- (fuente, alcance, mensaje_id). La empresa sale de `origen_canales` si no viene. Si es WhatsApp y hay un contacto
-- único con ese teléfono en la empresa, se vincula y (si es el primero) le llena el origen.
create or replace function public.registrar_toque_origen(
  p_canal text,
  p_alcance text,
  p_id_externo text,
  p_fuente text,
  p_crudo jsonb,
  p_workspace_id uuid default null,
  p_mensaje_id text default null,
  p_source_type text default null,
  p_source_id text default null,
  p_ad_id text default null,
  p_ctwa_clid text default null,
  p_source_url text default null,
  p_headline text default null,
  p_ref text default null
)
returns uuid
language plpgsql
set search_path = public, pg_temp
as $$
declare
  v_ws uuid := p_workspace_id;
  v_id uuid;
  v_externo text := btrim(p_id_externo);
  v_contacto uuid;
  v_toque public.origen_toques;
begin
  if v_ws is null then
    select oc.workspace_id into v_ws from public.origen_canales oc where oc.canal = p_canal and oc.alcance = p_alcance;
  end if;
  -- WhatsApp: el teléfono se guarda comparable; el BSUID (`CO.123…`) no es teléfono y se guarda tal cual.
  if p_canal = 'whatsapp' and v_externo !~ '[A-Za-z]' then
    v_externo := coalesce(public.telefono_clave(v_externo), v_externo);
  end if;

  if p_mensaje_id is not null then
    select t.id into v_id from public.origen_toques t
     where t.fuente = p_fuente and t.alcance = p_alcance and t.mensaje_id = p_mensaje_id;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  begin
    insert into public.origen_toques (workspace_id, canal, alcance, id_externo, es_primero, fuente, mensaje_id, source_type,
                                      source_id, ad_id, ctwa_clid, source_url, headline, ref, crudo)
    values (v_ws, p_canal, p_alcance, v_externo, true, p_fuente, p_mensaje_id, p_source_type, p_source_id, p_ad_id, p_ctwa_clid,
            p_source_url, p_headline, p_ref, p_crudo)
    on conflict (canal, alcance, id_externo) where es_primero do nothing
    returning id into v_id;
    if v_id is null then
      insert into public.origen_toques (workspace_id, canal, alcance, id_externo, es_primero, fuente, mensaje_id, source_type,
                                        source_id, ad_id, ctwa_clid, source_url, headline, ref, crudo)
      values (v_ws, p_canal, p_alcance, v_externo, false, p_fuente, p_mensaje_id, p_source_type, p_source_id, p_ad_id, p_ctwa_clid,
              p_source_url, p_headline, p_ref, p_crudo)
      returning id into v_id;
    end if;
  exception when unique_violation then
    -- Dos entregas del mismo mensaje a la vez: gana la que entró.
    select t.id into v_id from public.origen_toques t
     where t.fuente = p_fuente and t.alcance = p_alcance and t.mensaje_id = p_mensaje_id;
    if v_id is null then
      raise;
    end if;
    return v_id;
  end;

  if v_ws is not null and p_canal = 'whatsapp' then
    -- Solo con un contacto único: dos contactos con el mismo teléfono no se adivinan.
    select min(c.id::text)::uuid into v_contacto from public.contactos c
     where c.workspace_id = v_ws and public.telefono_clave(c.telefono) = v_externo
    having count(*) = 1;
    if v_contacto is not null then
      update public.origen_toques set contacto_id = v_contacto where id = v_id returning * into v_toque;
      if v_toque.es_primero then
        perform public.origen_a_contacto(v_toque, v_contacto);
      end if;
    end if;
  end if;
  return v_id;
end;
$$;

revoke execute on function public.registrar_toque_origen(text, text, text, text, jsonb, uuid, text, text, text, text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function public.registrar_toque_origen(text, text, text, text, jsonb, uuid, text, text, text, text, text, text, text, text)
  to service_role;

comment on function public.registrar_toque_origen(text, text, text, text, jsonb, uuid, text, text, text, text, text, text, text, text) is
  'Graba un toque de origen de Meta (referral). Solo service_role. Idempotente por (fuente, alcance, mensaje_id).';

-- ── 6. Chatwoot: Messenger es un canal ──────────────────────────────────────────────────────────────────────────
alter table public.chatwoot_conversacion drop constraint if exists chatwoot_conversacion_canal;
alter table public.chatwoot_conversacion add constraint chatwoot_conversacion_canal
  check (canal in ('instagram', 'tiktok', 'whatsapp', 'messenger', 'otro'));
