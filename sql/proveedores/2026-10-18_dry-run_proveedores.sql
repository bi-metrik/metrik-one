-- Dry-run de supabase/migrations/20261018150000_proveedores.sql contra producción.
--
-- UN solo statement: cuenta perfiles, fotos y lo que da la vista de la propuesta; aplica la
-- migración (cuerpo pegado TAL CUAL entre $mig$); ensaya las reglas nuevas DENTRO de un subbloque
-- que se deshace; vuelve a contar y aborta con RAISE EXCEPTION. Nada queda escrito: el resultado
-- vuelve en el mensaje del error. Correrlo por MCP execute_sql y después confirmar que no quedó nada:
--   select to_regclass('public.proveedor_tarifarios'), to_regclass('public.proveedor_cuentas'),
--          to_regclass('public.proveedor_cuentas_historial');                       -- null, null, null
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'fotos_perfiles' and column_name = 'tipo_proveedor';  -- 0
--   select allowed_mime_types, file_size_limit from storage.buckets where id = 'fotos-catalogo';  -- {image/jpeg}, 5000000
--
-- Lo que tiene que decir:
--   ya_existia = false (ni las columnas ni las tablas estaban)
--   perfiles_antes = perfiles_despues, fotos_antes = fotos_despues, vista_antes = vista_despues
--     (no crea ni borra perfiles ni fotos; la propuesta ve exactamente lo mismo)
--   backfill = true (cada perfil de antes quedó con tipo_proveedor = su tipo)
--   bucket = true (fotos-catalogo acepta PDF, hasta 20 MB) — true también si el bucket no existe
--   Ensayos (solo si hay un workspace con dos personas activas en staff):
--   por_defecto = true (un perfil nuevo sin tipo_proveedor lo recibe de su espacio)
--   clave_fija = true (cambiar la llave de un perfil lo frena el trigger)
--   via = true (un hotel apunta a su mayorista del mismo espacio)
--   fechas = true (un tarifario con «hasta» antes de «desde» lo frena el CHECK)
--   misma_persona = true (quien cargó la cuenta no la puede verificar: lo frena el CHECK)
--   otra_persona = true (otra persona sí la verifica)
--   cambio_pendiente = true (cambiar el número la devuelve a «pendiente»)
--   rastro = 3 (creada, verificada, cambiada)
-- Si el mensaje no empieza por «DRY-RUN OK», algo no cuadra: NO aplicar.

DO $dry$
DECLARE
  ya_existia        boolean;
  perfiles_antes    bigint;
  perfiles_despues  bigint;
  fotos_antes       bigint;
  fotos_despues     bigint;
  vista_antes       bigint;
  vista_despues     bigint;
  backfill          boolean;
  bucket            boolean;
  ws                uuid;
  s1                uuid;
  s2                uuid;
  hotel             uuid;
  mayorista         uuid;
  cuenta            uuid;
  t                 text;
  ensayado          boolean := false;
  por_defecto       boolean := false;
  clave_fija        boolean := false;
  via               boolean := false;
  fechas            boolean := false;
  misma_persona     boolean := false;
  otra_persona      boolean := false;
  cambio_pendiente  boolean := false;
  rastro            bigint := 0;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'fotos_perfiles' AND column_name = 'tipo_proveedor')
      OR to_regclass('public.proveedor_tarifarios') IS NOT NULL
      OR to_regclass('public.proveedor_cuentas') IS NOT NULL
    INTO ya_existia;
  SELECT count(*) INTO perfiles_antes FROM public.fotos_perfiles;
  SELECT count(*) INTO fotos_antes FROM public.fotos_catalogo;
  SELECT count(*) INTO vista_antes FROM public.fotos_catalogo_por_clave;

  EXECUTE $mig$
-- ============================================================================
-- Proveedores de la agencia (Mauricio, 2026-10-18).
--
-- La ficha del hotel o del tour de #1202 (`fotos_perfiles`) SE VUELVE la ficha del proveedor: una
-- sola fila por proveedor real. Un hotel que entra a una cotización ya es un proveedor tipo hotel,
-- sus fotos siguen viviendo en `fotos_catalogo` con la misma llave y la propuesta las encuentra
-- igual (nada se mueve). Este archivo agrega:
--
--   · `fotos_perfiles`, columnas de la ficha: `tipo_proveedor` (hotel, operador, parque,
--     transporte, lancha, actividad, mayorista, otro), país, estrellas, web, contacto, celular
--     (E.164 y el original), correo, teléfono, dirección, notas, `etiquetas` (texto normalizado,
--     varias), «tarifas de mayorista», responsable de las tarifas, `origen`/`origen_ref` (para no
--     duplicar al reimportar de Airtable) y «se compra a través de» (`comprado_via_id`, otro
--     proveedor del mismo espacio).
--     `tipo` sigue siendo el ESPACIO DE LLAVES de las fotos (hotel | actividad) y gana
--     `proveedor` para lo que no sale en la propuesta (un mayorista, un transportador). `tipo` y
--     `clave` ya no cambian después de creados: de ellos cuelgan las fotos y los alias.
--   · `proveedor_tarifarios`: tarifarios (PDF o imagen) por proveedor, con vigencia opcional.
--     El archivo va al bucket privado `fotos-catalogo` con prefijo propio
--     (`<ws>/proveedores/<proveedor>/tarifarios/…`). Sesión por workspace, como las fotos.
--   · `proveedor_cuentas` + `proveedor_cuentas_historial`: cuentas bancarias, aparte de las
--     tarifas. server-only (solo el servidor, después de revisar el permiso financiero). Una
--     cuenta nace «pendiente»; la verifica OTRA persona (la base lo exige); cualquier cambio de
--     sus datos la devuelve a «pendiente» y cada paso queda en el historial. Motivo: en la base de
--     Airtable hay PDFs de tarifas con cuentas y un «cambio de cuenta principal», camino típico de
--     fraude.
--   · El bucket `fotos-catalogo` acepta además PDF, PNG y WebP, hasta 20 MB (antes solo JPEG de
--     5 MB). Las fotos las sigue guardando el servidor como JPEG ≤ 5 MB (`catalogo-almacen.ts`).
--
-- ESCRIBE en filas existentes una sola cosa: `tipo_proveedor` de cada perfil de antes = su `tipo`
-- (hotel → hotel, actividad → actividad), para poder dejar la columna NOT NULL. No mueve fotos.
--
-- epoca: no-rompe solo agrega columnas, tablas y CHECK más anchos; el código de antes inserta perfiles sin tipo_proveedor y el trigger lo completa
--
-- ⚠️ Aplicar ANTES del merge. Depende de `20261017090000_fotos_perfiles.sql`.
-- Dry-run: sql/proveedores/2026-10-18_dry-run_proveedores.sql
-- Reversa: sql/proveedores/2026-10-18_reversa_proveedores.sql
-- ============================================================================

-- ── 1. La ficha del proveedor sobre `fotos_perfiles` ─────────────────────────

-- El espacio `proveedor`. Sin `if exists`: si el CHECK se llamara distinto, que falle.
alter table public.fotos_perfiles drop constraint fotos_perfiles_tipo_check;
alter table public.fotos_perfiles add constraint fotos_perfiles_tipo_check
  check (tipo in ('hotel', 'actividad', 'proveedor'));

alter table public.fotos_perfiles
  add column tipo_proveedor          text,
  add column pais                    text check (pais is null or pais ~ '^[A-Z]{2}$'),
  add column estrellas               smallint check (estrellas is null or estrellas between 0 and 5),
  add column web                     text check (web is null or (web ~* '^https?://' and length(web) <= 500)),
  add column contacto_nombre         text check (contacto_nombre is null or length(contacto_nombre) <= 200),
  add column celular                 text check (celular is null or celular ~ '^\+[1-9][0-9]{6,14}$'),
  add column celular_original        text check (celular_original is null or length(celular_original) <= 120),
  add column correo                  text check (correo is null or (correo ~* '^[^@[:space:]]+@[^@[:space:]]+\.[a-z]{2,}$' and length(correo) <= 200)),
  add column telefono                text check (telefono is null or length(telefono) <= 120),
  add column direccion               text check (direccion is null or length(direccion) <= 300),
  add column notas                   text check (notas is null or length(notas) <= 20000),
  add column etiquetas               text[] not null default '{}',
  add column tarifas_mayorista       boolean not null default false,
  add column responsable_tarifas_id  uuid references public.staff(id) on delete set null,
  add column origen                  text not null default 'cotizacion'
                                       check (origen in ('cotizacion', 'importacion', 'manual')),
  add column origen_ref              text check (origen_ref is null or length(origen_ref) between 1 and 100),
  add column comprado_via_id         uuid,
  add column updated_by              uuid references public.staff(id) on delete set null;

-- Etiquetas normalizadas (minúscula, sin tildes ni signos, un espacio entre palabras), hasta 30.
alter table public.fotos_perfiles add constraint fotos_perfiles_etiquetas_normalizadas check (
  cardinality(etiquetas) <= 30
  and length(array_to_string(etiquetas, '|')) <= 1500
  and array_to_string(etiquetas, '|') ~ '^([a-z0-9]+( [a-z0-9]+)*)?(\|[a-z0-9]+( [a-z0-9]+)*)*$'
  and array_position(etiquetas, null) is null
);

-- Los perfiles de antes: su tipo de proveedor es su espacio (hotel u actividad).
update public.fotos_perfiles set tipo_proveedor = tipo where tipo_proveedor is null;

alter table public.fotos_perfiles alter column tipo_proveedor set not null;
alter table public.fotos_perfiles add constraint fotos_perfiles_tipo_proveedor_check
  check (tipo_proveedor in ('hotel', 'operador', 'parque', 'transporte', 'lancha', 'actividad', 'mayorista', 'otro'));

-- «Se compra a través de»: otro proveedor del MISMO espacio (llave compuesta), nunca él mismo.
-- Que sea un mayorista lo revisa el código (un CHECK no ve otra fila).
alter table public.fotos_perfiles add constraint fotos_perfiles_id_ws unique (id, workspace_id);
alter table public.fotos_perfiles add constraint fotos_perfiles_comprado_via_fk
  foreign key (comprado_via_id, workspace_id) references public.fotos_perfiles (id, workspace_id)
  on delete set null (comprado_via_id);
alter table public.fotos_perfiles add constraint fotos_perfiles_comprado_via_no_es_el_mismo
  check (comprado_via_id is null or comprado_via_id <> id);

-- Reimportar de Airtable no duplica: un registro de origen es una sola ficha.
create unique index fotos_perfiles_una_por_origen_ref
  on public.fotos_perfiles (workspace_id, origen_ref) where origen_ref is not null;
create index idx_fotos_perfiles_tipo_proveedor
  on public.fotos_perfiles (workspace_id, tipo_proveedor);
create index idx_fotos_perfiles_etiquetas
  on public.fotos_perfiles using gin (etiquetas);
create index idx_fotos_perfiles_responsable_tarifas
  on public.fotos_perfiles (responsable_tarifas_id) where responsable_tarifas_id is not null;
create index idx_fotos_perfiles_comprado_via
  on public.fotos_perfiles (comprado_via_id) where comprado_via_id is not null;

-- El código de antes (y el que crea el perfil desde la tarjeta) no manda `tipo_proveedor`: sale del
-- espacio. Y `tipo` y `clave` no cambian: de ellos cuelgan las fotos y los alias.
create function public.fotos_perfiles_ficha_proveedor()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if tg_op = 'INSERT' then
    if new.tipo_proveedor is null then
      new.tipo_proveedor := case new.tipo when 'hotel' then 'hotel' when 'actividad' then 'actividad' else 'otro' end;
    end if;
  elsif new.tipo is distinct from old.tipo or new.clave is distinct from old.clave
        or new.workspace_id is distinct from old.workspace_id then
    raise exception 'El espacio, la llave y el workspace de un proveedor no cambian (de ellos cuelgan sus fotos)'
      using errcode = 'check_violation';
  end if;
  return new;
end
$fn$;

revoke execute on function public.fotos_perfiles_ficha_proveedor() from public, anon, authenticated;

create trigger fotos_perfiles_ficha_proveedor
  before insert or update on public.fotos_perfiles
  for each row execute function public.fotos_perfiles_ficha_proveedor();

comment on table public.fotos_perfiles is
  'Proveedores del espacio (la ficha). Un hotel o un tour que entra a una cotización crea el suyo; sus fotos viven en fotos_catalogo con la misma clave. tipo = espacio de llaves de las fotos (hotel | actividad | proveedor, no cambia); tipo_proveedor = lo que es para la agencia.';
comment on column public.fotos_perfiles.tipo_proveedor is
  'hotel, operador, parque, transporte, lancha, actividad, mayorista u otro. Se puede corregir; las fotos no se mueven.';
comment on column public.fotos_perfiles.etiquetas is
  'Etiquetas normalizadas (destino, segmento: «familias», «luna de miel», «lujo»). Para segmentar: tipo_proveedor = X and etiquetas @> ''{Y}'' and split_part(clave, ''|'', 2) = ciudad Z.';
comment on column public.fotos_perfiles.celular is 'E.164 (+573001234567) cuando se pudo saber; el original en celular_original.';
comment on column public.fotos_perfiles.origen_ref is 'Id del registro de origen (Airtable rec…) para no duplicar al reimportar.';
comment on column public.fotos_perfiles.comprado_via_id is
  'Se compra a través de (un mayorista): el aviso de vigencia usa sus tarifarios cuando este proveedor no tiene propios.';

-- ── 2. Tarifarios ────────────────────────────────────────────────────────────

create table public.proveedor_tarifarios (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  proveedor_id       uuid not null,
  -- `one://fotos-catalogo/<ws>/proveedores/<proveedor>/tarifarios/<huella>.<ext>`. Nulo mientras el
  -- archivo no se ha subido (la importación de Airtable registra nombre y tamaño; el archivo va aparte).
  ref                text check (ref is null or (ref like 'one://fotos-catalogo/%/proveedores/%/tarifarios/%' and length(ref) <= 300)),
  nombre_archivo     text check (nombre_archivo is null or length(btrim(nombre_archivo)) between 1 and 300),
  bytes              bigint check (bytes is null or bytes between 1 and 200000000),
  mime               text check (mime is null or length(mime) <= 120),
  vigente_desde      date,
  vigente_hasta      date,
  -- La vigencia salió del nombre del archivo («Tarifas 2025»), no la dijo una persona.
  vigencia_inferida  boolean not null default false,
  temporada          text check (temporada is null or length(temporada) <= 120),
  notas              text check (notas is null or length(notas) <= 2000),
  origen             text not null default 'manual' check (origen in ('manual', 'importacion')),
  origen_ref         text check (origen_ref is null or length(origen_ref) between 1 and 400),
  subido_por         uuid references public.staff(id) on delete set null,
  subido_at          timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint proveedor_tarifarios_proveedor_fk foreign key (proveedor_id, workspace_id)
    references public.fotos_perfiles (id, workspace_id) on delete cascade,
  constraint proveedor_tarifarios_fechas check (vigente_desde is null or vigente_hasta is null or vigente_hasta >= vigente_desde),
  constraint proveedor_tarifarios_con_archivo check (ref is not null or nombre_archivo is not null)
);

create index idx_proveedor_tarifarios_proveedor on public.proveedor_tarifarios (proveedor_id);
create unique index proveedor_tarifarios_una_por_origen_ref
  on public.proveedor_tarifarios (workspace_id, origen_ref) where origen_ref is not null;

alter table public.proveedor_tarifarios enable row level security;
revoke all on table public.proveedor_tarifarios from public, anon, authenticated;
create policy proveedor_tarifarios_ws on public.proveedor_tarifarios for all
  using (workspace_id = (select public.current_user_workspace_id()))
  with check (workspace_id = (select public.current_user_workspace_id()));
grant select, insert, update, delete on public.proveedor_tarifarios to authenticated;

comment on table public.proveedor_tarifarios is
  'Tarifarios de cada proveedor (PDF o imagen en el bucket privado fotos-catalogo, prefijo proveedores/). Vigencia opcional: vigente / por vencer (≤30 días) / vencido / sin fechas se calcula en el código.';

-- ── 3. Cuentas bancarias (server-only) ───────────────────────────────────────

-- server-only: cuentas bancarias de proveedores; las lee y escribe el servidor con service_role tras revisar el permiso financiero
create table public.proveedor_cuentas (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  proveedor_id       uuid not null,
  banco              text not null check (length(btrim(banco)) between 1 and 120),
  tipo_cuenta        text not null check (tipo_cuenta in ('ahorros', 'corriente', 'otra')),
  numero             text not null check (numero ~ '^[0-9A-Za-z][0-9A-Za-z -]{2,38}[0-9A-Za-z]$'),
  titular            text not null check (length(btrim(titular)) between 1 and 200),
  titular_documento  text check (titular_documento is null or length(btrim(titular_documento)) between 3 and 40),
  certificado_ref    text check (certificado_ref is null or (certificado_ref like 'one://fotos-catalogo/%/proveedores/%/cuentas/%' and length(certificado_ref) <= 300)),
  estado             text not null default 'pendiente' check (estado in ('pendiente', 'verificada')),
  -- Quien la cargó o la cambió por última vez. `restrict`: el rastro no se pierde al borrar a alguien.
  cargada_por        uuid not null references public.staff(id) on delete restrict,
  cargada_at         timestamptz not null default now(),
  verificada_por     uuid references public.staff(id) on delete restrict,
  verificada_at      timestamptz,
  -- Retirarla no la borra: deja de usarse y queda en el historial.
  retirada_por       uuid references public.staff(id) on delete restrict,
  retirada_at        timestamptz,
  constraint proveedor_cuentas_proveedor_fk foreign key (proveedor_id, workspace_id)
    references public.fotos_perfiles (id, workspace_id) on delete cascade,
  -- El único control duro: la verifica una persona DISTINTA de quien la cargó.
  constraint proveedor_cuentas_verificacion check (
    (estado = 'pendiente' and verificada_por is null and verificada_at is null)
    or (estado = 'verificada' and verificada_por is not null and verificada_at is not null and verificada_por <> cargada_por)
  ),
  constraint proveedor_cuentas_retiro check ((retirada_por is null) = (retirada_at is null))
);

create index idx_proveedor_cuentas_proveedor on public.proveedor_cuentas (proveedor_id);

alter table public.proveedor_cuentas enable row level security;
revoke all on table public.proveedor_cuentas from public, anon, authenticated;

-- server-only: rastro de cada paso de una cuenta bancaria (creada, cambiada, verificada, retirada); lo escribe el trigger
create table public.proveedor_cuentas_historial (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  -- Sin llave foránea a propósito: el rastro sobrevive a la cuenta y al proveedor.
  cuenta_id          uuid not null,
  proveedor_id       uuid not null,
  evento             text not null check (evento in ('creada', 'cambiada', 'verificada', 'retirada')),
  por                uuid references public.staff(id) on delete set null,
  banco              text,
  tipo_cuenta        text,
  numero             text,
  titular            text,
  titular_documento  text,
  certificado_ref    text,
  -- En un cambio: los datos de antes.
  antes              jsonb,
  created_at         timestamptz not null default now()
);

create index idx_proveedor_cuentas_historial_cuenta on public.proveedor_cuentas_historial (cuenta_id, created_at);

alter table public.proveedor_cuentas_historial enable row level security;
revoke all on table public.proveedor_cuentas_historial from public, anon, authenticated;

-- Un cambio de datos la devuelve a «pendiente» (aunque el UPDATE dijera otra cosa). Sin cambio de
-- datos, quien la cargó no cambia: así nadie se pone de cargador para verificar la suya.
create function public.proveedor_cuentas_cambio()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.workspace_id is distinct from old.workspace_id or new.proveedor_id is distinct from old.proveedor_id then
    raise exception 'Una cuenta no cambia de proveedor ni de espacio' using errcode = 'check_violation';
  end if;
  if (new.banco, new.tipo_cuenta, new.numero, new.titular, new.titular_documento, new.certificado_ref)
     is distinct from
     (old.banco, old.tipo_cuenta, old.numero, old.titular, old.titular_documento, old.certificado_ref) then
    new.estado := 'pendiente';
    new.verificada_por := null;
    new.verificada_at := null;
    new.cargada_at := now();
  elsif new.cargada_por is distinct from old.cargada_por then
    raise exception 'Quien cargó la cuenta solo cambia si cambian sus datos' using errcode = 'check_violation';
  end if;
  return new;
end
$fn$;

revoke execute on function public.proveedor_cuentas_cambio() from public, anon, authenticated;

create trigger proveedor_cuentas_cambio
  before update on public.proveedor_cuentas
  for each row execute function public.proveedor_cuentas_cambio();

create function public.proveedor_cuentas_rastro()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
declare
  ev text;
  quien uuid;
  previo jsonb;
begin
  if tg_op = 'INSERT' then
    ev := 'creada';
    quien := new.cargada_por;
  elsif (new.banco, new.tipo_cuenta, new.numero, new.titular, new.titular_documento, new.certificado_ref)
        is distinct from
        (old.banco, old.tipo_cuenta, old.numero, old.titular, old.titular_documento, old.certificado_ref) then
    ev := 'cambiada';
    quien := new.cargada_por;
    previo := jsonb_build_object('banco', old.banco, 'tipo_cuenta', old.tipo_cuenta, 'numero', old.numero, 'titular', old.titular,
      'titular_documento', old.titular_documento, 'certificado_ref', old.certificado_ref, 'estado', old.estado,
      'verificada_por', old.verificada_por);
  elsif new.retirada_at is not null and old.retirada_at is null then
    ev := 'retirada';
    quien := new.retirada_por;
  elsif new.estado = 'verificada' and old.estado is distinct from 'verificada' then
    ev := 'verificada';
    quien := new.verificada_por;
  else
    return null;
  end if;
  insert into public.proveedor_cuentas_historial
    (workspace_id, cuenta_id, proveedor_id, evento, por, banco, tipo_cuenta, numero, titular, titular_documento, certificado_ref, antes)
  values
    (new.workspace_id, new.id, new.proveedor_id, ev, quien, new.banco, new.tipo_cuenta, new.numero, new.titular,
     new.titular_documento, new.certificado_ref, previo);
  return null;
end
$fn$;

revoke execute on function public.proveedor_cuentas_rastro() from public, anon, authenticated;

create trigger proveedor_cuentas_rastro
  after insert or update on public.proveedor_cuentas
  for each row execute function public.proveedor_cuentas_rastro();

comment on table public.proveedor_cuentas is
  'Cuentas bancarias de proveedores. server-only (service_role tras revisar el permiso financiero). Nace pendiente; la verifica otra persona; un cambio de datos la devuelve a pendiente. Rastro en proveedor_cuentas_historial.';
comment on table public.proveedor_cuentas_historial is
  'Rastro de cada cuenta bancaria de proveedor: creada, cambiada (con los datos de antes), verificada, retirada. Lo escribe el trigger proveedor_cuentas_rastro.';

-- ── 4. El bucket privado de las fotos acepta también los tarifarios ─────────

update storage.buckets
   set allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'],
       file_size_limit = 20000000  -- BYTES_MAXIMOS_ARCHIVO en src/lib/proveedores/archivos.ts
 where id = 'fotos-catalogo';
$mig$;

  SELECT count(*) INTO perfiles_despues FROM public.fotos_perfiles;
  SELECT count(*) INTO fotos_despues FROM public.fotos_catalogo;
  SELECT count(*) INTO vista_despues FROM public.fotos_catalogo_por_clave;
  SELECT NOT EXISTS (SELECT 1 FROM public.fotos_perfiles WHERE tipo_proveedor IS DISTINCT FROM tipo) INTO backfill;
  SELECT coalesce((SELECT 'application/pdf' = ANY (allowed_mime_types) AND file_size_limit = 20000000
                     FROM storage.buckets WHERE id = 'fotos-catalogo'), true) INTO bucket;

  SELECT s.workspace_id INTO ws FROM public.staff s WHERE s.is_active
   GROUP BY s.workspace_id HAVING count(*) >= 2 LIMIT 1;
  IF ws IS NOT NULL THEN
    ensayado := true;
    SELECT id INTO s1 FROM public.staff WHERE workspace_id = ws AND is_active ORDER BY id LIMIT 1;
    SELECT id INTO s2 FROM public.staff WHERE workspace_id = ws AND is_active AND id <> s1 ORDER BY id LIMIT 1;
    BEGIN
      INSERT INTO public.fotos_perfiles (workspace_id, tipo, clave, nombre)
        VALUES (ws, 'proveedor', 'dry run mayorista|', 'Dry run mayorista') RETURNING id, tipo_proveedor INTO mayorista, t;
      por_defecto := t = 'otro';
      UPDATE public.fotos_perfiles SET tipo_proveedor = 'mayorista' WHERE id = mayorista;
      INSERT INTO public.fotos_perfiles (workspace_id, tipo, clave, nombre, tipo_proveedor, comprado_via_id)
        VALUES (ws, 'hotel', 'dry run hotel|', 'Dry run hotel', 'hotel', mayorista) RETURNING id INTO hotel;
      via := EXISTS (SELECT 1 FROM public.fotos_perfiles WHERE id = hotel AND comprado_via_id = mayorista);
      BEGIN
        UPDATE public.fotos_perfiles SET clave = 'otra llave|' WHERE id = hotel;
      EXCEPTION WHEN check_violation THEN clave_fija := true;
      END;
      BEGIN
        INSERT INTO public.proveedor_tarifarios (workspace_id, proveedor_id, nombre_archivo, vigente_desde, vigente_hasta)
          VALUES (ws, hotel, 'Tarifas.pdf', DATE '2026-12-31', DATE '2026-01-01');
      EXCEPTION WHEN check_violation THEN fechas := true;
      END;
      INSERT INTO public.proveedor_cuentas (workspace_id, proveedor_id, banco, tipo_cuenta, numero, titular, cargada_por)
        VALUES (ws, hotel, 'Banco dry run', 'ahorros', '0001112223', 'Dry run SAS', s1) RETURNING id INTO cuenta;
      BEGIN
        UPDATE public.proveedor_cuentas SET estado = 'verificada', verificada_por = s1, verificada_at = now() WHERE id = cuenta;
      EXCEPTION WHEN check_violation THEN misma_persona := true;
      END;
      UPDATE public.proveedor_cuentas SET estado = 'verificada', verificada_por = s2, verificada_at = now() WHERE id = cuenta;
      otra_persona := EXISTS (SELECT 1 FROM public.proveedor_cuentas WHERE id = cuenta AND estado = 'verificada');
      UPDATE public.proveedor_cuentas SET numero = '9998887776', cargada_por = s2 WHERE id = cuenta;
      cambio_pendiente := EXISTS (SELECT 1 FROM public.proveedor_cuentas WHERE id = cuenta AND estado = 'pendiente' AND verificada_por IS NULL);
      SELECT count(*) INTO rastro FROM public.proveedor_cuentas_historial WHERE cuenta_id = cuenta;
      RAISE EXCEPTION 'deshacer';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'deshacer' THEN RAISE; END IF;
    END;
  END IF;

  RAISE EXCEPTION '% ya_existia=% perfiles_antes=% perfiles_despues=% fotos_antes=% fotos_despues=% vista_antes=% vista_despues=% backfill=% bucket=% ensayado=% por_defecto=% clave_fija=% via=% fechas=% misma_persona=% otra_persona=% cambio_pendiente=% rastro=%',
    CASE WHEN NOT ya_existia AND perfiles_antes = perfiles_despues AND fotos_antes = fotos_despues
              AND vista_antes = vista_despues AND backfill AND bucket
              AND (NOT ensayado OR (por_defecto AND clave_fija AND via AND fechas AND misma_persona
                                    AND otra_persona AND cambio_pendiente AND rastro = 3))
         THEN 'DRY-RUN OK' ELSE 'DRY-RUN NO CUADRA' END,
    ya_existia, perfiles_antes, perfiles_despues, fotos_antes, fotos_despues, vista_antes, vista_despues, backfill, bucket,
    ensayado, por_defecto, clave_fija, via, fechas, misma_persona, otra_persona, cambio_pendiente, rastro;
END
$dry$;
