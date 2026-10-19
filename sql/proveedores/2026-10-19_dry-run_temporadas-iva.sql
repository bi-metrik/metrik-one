-- Dry-run de supabase/migrations/20261019120000_proveedores_temporadas_iva.sql contra producción.
--
-- UN solo statement: cuenta lo que existe; aplica la migración (cuerpo pegado TAL CUAL entre
-- $mig$); ensaya las reglas nuevas DENTRO de un subbloque que se deshace; vuelve a contar y aborta
-- con RAISE EXCEPTION. Nada queda escrito: el resultado vuelve en el mensaje del error. Correrlo
-- por MCP execute_sql y después confirmar que no quedó nada:
--   select to_regclass('public.temporadas_agencia'), to_regclass('public.proveedor_extracciones');  -- null, null
--   select count(*) from information_schema.columns where table_schema = 'public'
--      and ((table_name = 'fotos_perfiles' and column_name in ('departamento', 'destino', 'iva_declarado', 'iva_incluido', 'tarifa_canal', 'tarifas_solicitadas_at', 'tarifas_solicitadas_por'))
--        or (table_name = 'cotizaciones' and column_name in ('costos_con_iva', 'viajero_residente'))
--        or (table_name = 'items' and column_name = 'iva_costo_pct'));                               -- 0
--
-- Lo que tiene que decir:
--   ya_existia = false
--   perfiles_antes = perfiles_despues, items_antes = items_despues, cot_antes = cot_despues (no escribe datos)
--   nulos = true (las columnas nuevas nacen NULL en todas las filas)
--   Ensayos (solo si hay un perfil de proveedor en algún workspace):
--   rango = true (un rango válido entra), fechas = true (hasta < desde lo frena el CHECK),
--   anio = true (un rango cuyo año no es el de su «desde» lo frena el CHECK),
--   canal = true (una tarifa_canal desconocida la frena el CHECK),
--   iva = true (un iva_costo_pct de 50 lo frena el CHECK; null si no hay ítems),
--   extraccion = true (una extracción del proveedor entra),
--   extraccion_ws = true (la misma extracción con otro workspace la frena la llave compuesta)
-- Si el mensaje no empieza por «DRY-RUN OK», algo no cuadra: NO aplicar.

DO $dry$
DECLARE
  ya_existia        boolean;
  perfiles_antes    bigint;
  perfiles_despues  bigint;
  items_antes       bigint;
  items_despues     bigint;
  cot_antes         bigint;
  cot_despues       bigint;
  nulos             boolean;
  ensayado          boolean := false;
  rango             boolean := false;
  fechas            boolean := false;
  anio              boolean := false;
  canal             boolean := false;
  iva               boolean := null;
  extraccion        boolean := false;
  extraccion_ws     boolean := false;
  perfil            uuid;
  ws                uuid;
  otro_ws           uuid;
  item              uuid;
BEGIN
  SELECT to_regclass('public.temporadas_agencia') IS NOT NULL
      OR to_regclass('public.proveedor_extracciones') IS NOT NULL
      OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'fotos_perfiles' AND column_name = 'departamento')
    INTO ya_existia;
  SELECT count(*) INTO perfiles_antes FROM public.fotos_perfiles;
  SELECT count(*) INTO items_antes FROM public.items;
  SELECT count(*) INTO cot_antes FROM public.cotizaciones;

  EXECUTE $mig$
-- ============================================================================
-- Fichas, temporadas e IVA de los proveedores (Trappvel, decisiones de Mauricio del 2026-10-19).
--
--   · `fotos_perfiles` (la ficha del proveedor) gana:
--       - `departamento` y `destino` («Caribe - Cartagena», «Eje Cafetero»): la ciudad ya existía y
--         es el MUNICIPIO donde se duerme o se presta el servicio. Cambiar la ciudad no cambia la
--         llave (`clave`, trigger de 20261018150000): el código guarda un alias con la llave nueva
--         en `fotos_perfiles_alias`, para que la cotización no cree una ficha duplicada.
--       - `iva_declarado` (el proveedor cobra IVA), `iva_incluido` (sus precios ya lo traen) y
--         `tarifa_canal` (neta o comisionable): las dos preguntas de la solicitud de tarifas y lo
--         que decide la casilla «Calcular con IVA» de la cotización. NULL = no se sabe todavía.
--       - `tarifas_solicitadas_at/_por`: cuándo y quién le pidió las tarifas por última vez.
--   · `temporadas_agencia`: el calendario propio de la agencia (alta, media, baja por fechas y por
--     año), para elegir la tarifa cuando el hotel no trae fechas. Se arma una vez al año copiando
--     el anterior (lo hace el código).
--   · `cotizaciones.costos_con_iva` (la casilla; NULL = nadie la ha tocado, manda el valor por
--     defecto) y `cotizaciones.viajero_residente` (NULL = se asume residente).
--     `items.iva_costo_pct`: el IVA que se le suma al costo de ESA línea (19 cuando la casilla
--     está encendida y su proveedor declara IVA). El costo se sigue guardando SIN IVA (rubros y
--     `subtotal`); el IVA se suma al leer (`src/lib/cotizaciones/iva-costo.ts`).
--   · `proveedor_extracciones`: lo que devuelve el motor de extracción de tarifarios (esquema 0.2:
--     expediente + tarifario + datos_ficha), por proveedor. server-only.
--
-- NO escribe datos: solo columnas que nacen NULL, una tabla vacía y otra server-only vacía.
--
-- epoca: no-rompe solo agrega columnas nulas y tablas nuevas; el código de antes no las nombra y `items` se lee con select('*')
--
-- ⚠️ Aplicar ANTES del merge: la lista y la ficha de proveedores las nombran. Depende de
-- `20261018150000_proveedores.sql` (ya aplicada).
-- Dry-run: sql/proveedores/2026-10-19_dry-run_temporadas-iva.sql
-- Reversa: sql/proveedores/2026-10-19_reversa_temporadas-iva.sql
-- ============================================================================

-- ── 1. La ficha: ubicación, IVA y canal ──────────────────────────────────────

alter table public.fotos_perfiles
  add column departamento            text check (departamento is null or length(btrim(departamento)) between 1 and 120),
  add column destino                 text check (destino is null or length(btrim(destino)) between 1 and 120),
  add column iva_declarado           boolean,
  add column iva_incluido            boolean,
  add column tarifa_canal            text check (tarifa_canal is null or tarifa_canal in ('neta', 'comisionable')),
  add column tarifas_solicitadas_at  timestamptz,
  add column tarifas_solicitadas_por uuid references public.staff(id) on delete set null;

create index idx_fotos_perfiles_destino
  on public.fotos_perfiles (workspace_id, destino) where destino is not null;

comment on column public.fotos_perfiles.ciudad is
  'Municipio donde se duerme o se presta el servicio (una ciudad por ficha; un proveedor en dos ciudades = dos fichas). Cambiarla no mueve la llave: el código guarda un alias con la llave nueva.';
comment on column public.fotos_perfiles.destino is
  'Agrupación comercial de la agencia: «Caribe - Cartagena», «Eje Cafetero», «Internacional - España».';
comment on column public.fotos_perfiles.iva_declarado is
  'El proveedor cobra IVA. Con viajero residente, la casilla «Calcular con IVA» de la cotización nace encendida. NULL = no se sabe.';
comment on column public.fotos_perfiles.iva_incluido is
  'Sus precios ya traen el IVA (el costo se guarda SIN IVA: hay que descontarlo al cargar). NULL = no se sabe.';
comment on column public.fotos_perfiles.tarifa_canal is
  'neta (el precio es el costo de la agencia) o comisionable (al precio se le descuenta la comisión). NULL = no se sabe.';

-- ── 2. Calendario de temporadas de la agencia ────────────────────────────────

create table public.temporadas_agencia (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  -- El año al que pertenece el rango: el de su «desde» (un rango puede cruzar al año siguiente).
  anio          smallint not null check (anio between 2020 and 2100),
  temporada     text not null check (temporada in ('alta', 'media', 'baja')),
  desde         date not null,
  hasta         date not null,
  -- «Semana Santa», «Vacaciones de mitad de año». Semana Santa se recalcula al copiar el año.
  nombre        text check (nombre is null or length(btrim(nombre)) between 1 and 120),
  created_by    uuid references public.staff(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint temporadas_agencia_fechas check (hasta >= desde and hasta - desde <= 366),
  constraint temporadas_agencia_anio check (extract(year from desde)::int = anio)
);

create index idx_temporadas_agencia_ws_anio on public.temporadas_agencia (workspace_id, anio, desde);

alter table public.temporadas_agencia enable row level security;
revoke all on table public.temporadas_agencia from public, anon, authenticated;
create policy temporadas_agencia_ws on public.temporadas_agencia for all
  using (workspace_id = (select public.current_user_workspace_id()))
  with check (workspace_id = (select public.current_user_workspace_id()));
grant select, insert, update, delete on public.temporadas_agencia to authenticated;

comment on table public.temporadas_agencia is
  'Calendario de temporadas de la agencia (alta, media, baja por fechas, por año). Elige la tarifa de un hotel que no trae fechas. Si dos rangos se pisan, manda alta sobre media sobre baja.';

-- ── 3. IVA de los costos en la cotización ────────────────────────────────────

alter table public.cotizaciones
  add column costos_con_iva     boolean,
  add column viajero_residente  boolean;

comment on column public.cotizaciones.costos_con_iva is
  'La casilla «Calcular con IVA». NULL = nadie la ha tocado: nace encendida si algún proveedor de la cotización declara IVA y el viajero es residente.';
comment on column public.cotizaciones.viajero_residente is
  'El viajero reside en Colombia (paga IVA del hotel). NULL = se asume residente.';

alter table public.items
  add column iva_costo_pct numeric(5,2) check (iva_costo_pct is null or (iva_costo_pct > 0 and iva_costo_pct <= 30));

comment on column public.items.iva_costo_pct is
  'IVA (%) que se suma al costo de esta línea al leerla. El costo (rubros, subtotal) se guarda SIN IVA. Lo escribe la casilla «Calcular con IVA» según el proveedor de la línea.';

-- ── 4. Extracciones del motor de tarifarios (server-only) ────────────────────

-- server-only: la salida del motor de extracción (puede citar datos bancarios de los PDF); la escribe y la lee el servidor con service_role filtrando por workspace
create table public.proveedor_extracciones (
  id                   uuid primary key default gen_random_uuid(),
  workspace_id         uuid not null references public.workspaces(id) on delete cascade,
  proveedor_id         uuid not null,
  esquema_version      text not null check (esquema_version ~ '^[0-9]+\.[0-9]+$'),
  -- La versión de la instrucción del motor («v8») y el modelo que extrajo.
  instruccion_version  text check (instruccion_version is null or length(btrim(instruccion_version)) between 1 and 40),
  modelo               text check (modelo is null or length(btrim(modelo)) between 1 and 120),
  expediente           jsonb not null,
  tarifario            jsonb,
  datos_ficha          jsonb,
  -- Los archivos que leyó (nombres), para saber qué cubre sin abrir el JSON.
  archivos             text[] not null default '{}',
  estado               text not null default 'borrador' check (estado in ('borrador', 'revisada', 'descartada')),
  creada_por           uuid references public.staff(id) on delete set null,
  created_at           timestamptz not null default now(),
  revisada_por         uuid references public.staff(id) on delete set null,
  revisada_at          timestamptz,
  constraint proveedor_extracciones_proveedor_fk foreign key (proveedor_id, workspace_id)
    references public.fotos_perfiles (id, workspace_id) on delete cascade,
  constraint proveedor_extracciones_tamano check (
    octet_length(expediente::text) + coalesce(octet_length(tarifario::text), 0) + coalesce(octet_length(datos_ficha::text), 0) <= 3000000
  ),
  constraint proveedor_extracciones_revision check ((revisada_por is null) = (revisada_at is null))
);

create index idx_proveedor_extracciones_proveedor on public.proveedor_extracciones (proveedor_id, created_at desc);

alter table public.proveedor_extracciones enable row level security;
revoke all on table public.proveedor_extracciones from public, anon, authenticated;

comment on table public.proveedor_extracciones is
  'Salida del motor de extracción de tarifarios por proveedor (esquema 0.2: expediente + tarifario + datos_ficha). server-only. Una fila por corrida; la vigente es la última no descartada.';
$mig$;

  SELECT count(*) INTO perfiles_despues FROM public.fotos_perfiles;
  SELECT count(*) INTO items_despues FROM public.items;
  SELECT count(*) INTO cot_despues FROM public.cotizaciones;
  SELECT NOT EXISTS (SELECT 1 FROM public.fotos_perfiles WHERE departamento IS NOT NULL OR destino IS NOT NULL OR iva_declarado IS NOT NULL OR tarifa_canal IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM public.cotizaciones WHERE costos_con_iva IS NOT NULL OR viajero_residente IS NOT NULL)
     AND NOT EXISTS (SELECT 1 FROM public.items WHERE iva_costo_pct IS NOT NULL)
    INTO nulos;

  SELECT id, workspace_id INTO perfil, ws FROM public.fotos_perfiles ORDER BY created_at LIMIT 1;
  IF perfil IS NOT NULL THEN
    ensayado := true;
    SELECT id INTO otro_ws FROM public.workspaces WHERE id <> ws LIMIT 1;
    BEGIN
      INSERT INTO public.temporadas_agencia (workspace_id, anio, temporada, desde, hasta, nombre)
        VALUES (ws, 2027, 'alta', DATE '2027-03-21', DATE '2027-03-28', 'Semana Santa');
      rango := true;
      BEGIN
        INSERT INTO public.temporadas_agencia (workspace_id, anio, temporada, desde, hasta) VALUES (ws, 2027, 'baja', DATE '2027-05-10', DATE '2027-05-01');
      EXCEPTION WHEN check_violation THEN fechas := true;
      END;
      BEGIN
        INSERT INTO public.temporadas_agencia (workspace_id, anio, temporada, desde, hasta) VALUES (ws, 2026, 'baja', DATE '2027-05-01', DATE '2027-05-10');
      EXCEPTION WHEN check_violation THEN anio := true;
      END;
      BEGIN
        UPDATE public.fotos_perfiles SET tarifa_canal = 'publica' WHERE id = perfil;
      EXCEPTION WHEN check_violation THEN canal := true;
      END;
      SELECT id INTO item FROM public.items LIMIT 1;
      IF item IS NOT NULL THEN
        iva := false;
        BEGIN
          UPDATE public.items SET iva_costo_pct = 50 WHERE id = item;
        EXCEPTION WHEN check_violation THEN iva := true;
        END;
      END IF;
      INSERT INTO public.proveedor_extracciones (workspace_id, proveedor_id, esquema_version, expediente)
        VALUES (ws, perfil, '0.2', '{"archivos": []}'::jsonb);
      extraccion := true;
      IF otro_ws IS NOT NULL THEN
        BEGIN
          INSERT INTO public.proveedor_extracciones (workspace_id, proveedor_id, esquema_version, expediente)
            VALUES (otro_ws, perfil, '0.2', '{}'::jsonb);
        EXCEPTION WHEN foreign_key_violation THEN extraccion_ws := true;
        END;
      ELSE
        extraccion_ws := true;
      END IF;
      RAISE EXCEPTION 'deshacer';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'deshacer' THEN RAISE; END IF;
    END;
  END IF;

  RAISE EXCEPTION '% ya_existia=% perfiles_antes=% perfiles_despues=% items_antes=% items_despues=% cot_antes=% cot_despues=% nulos=% ensayado=% rango=% fechas=% anio=% canal=% iva=% extraccion=% extraccion_ws=%',
    CASE WHEN NOT ya_existia AND perfiles_antes = perfiles_despues AND items_antes = items_despues AND cot_antes = cot_despues AND nulos
              AND (NOT ensayado OR (rango AND fechas AND anio AND canal AND coalesce(iva, true) AND extraccion AND extraccion_ws))
         THEN 'DRY-RUN OK' ELSE 'DRY-RUN NO CUADRA' END,
    ya_existia, perfiles_antes, perfiles_despues, items_antes, items_despues, cot_antes, cot_despues, nulos,
    ensayado, rango, fechas, anio, canal, iva, extraccion, extraccion_ws;
END
$dry$;
