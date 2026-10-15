-- ============================================================================
-- Catálogo de fotos de la propuesta de viaje (PR 4 del plan del 2026-10-14,
-- `proyectos/trappvel/clarity/diseno/propuesta-emocional/max.md` §2.5). SOLO ESQUEMA.
--
-- Una foto por (workspace, tipo, clave) que se reusa entre cotizaciones:
--   · tipo `ciudad`    → clave = la ciudad normalizada («barcelona»)
--   · tipo `hotel`     → clave = «<hotel>|<ciudad>» normalizados
--   · tipo `actividad` → clave = «<actividad>|<ciudad>» normalizados (la ciudad puede ir vacía)
-- `nombre_clave` es el nombre normalizado solo: la propuesta busca un plan opcional por su
-- nombre cuando no sabe su ciudad.
--
-- De dónde sale la foto (`origen`):
--   · `wikimedia`: sugerencia automática de Wikimedia Commons por nombre + ciudad. Solo
--     licencias CC0, CC BY y CC BY-SA (el CHECK lo hace cumplir), con autor, licencia y la
--     página del archivo: el documento imprime la línea de crédito.
--   · `asesora`: la subió una persona (o la cambió por la sugerida). Sin crédito.
-- `revisada`: una persona la vio y la dejó (subirla o confirmarla). La sugerida nace sin revisar.
-- `descartadas`: archivos de Commons que alguien rechazó («Otra foto»), para no volver a
-- proponerlos.
--
-- El archivo vive en el bucket PRIVADO nuevo `fotos-catalogo` del proyecto de ONE, bajo
-- `<workspace_id>/<tipo>/<huella>.jpg`, referenciado como `one://fotos-catalogo/<ruta>`. Lo
-- escribe y lo lee SOLO el servidor con el cliente de servicio, después de que la acción
-- revisó la sesión y el workspace (como `ve-documentos`, `src/lib/almacenamiento/one.ts`): el
-- bucket no tiene policies para `authenticated` ni `anon`.
--
-- La tabla la lee y escribe la sesión (`authenticated`) por workspace. No escribe ni corrige
-- ninguna fila existente. Sin esta migración aplicada, la propuesta sale como hoy (el código
-- trata la tabla ausente como catálogo vacío).
-- ============================================================================

create table public.fotos_catalogo (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  tipo          text not null check (tipo in ('ciudad', 'hotel', 'actividad')),
  clave         text not null check (length(clave) between 1 and 300),
  nombre_clave  text not null check (length(nombre_clave) between 1 and 200),
  -- Lo que la persona reconoce: «Sagrada Familia», «H10 Metropolitan», «Barcelona».
  nombre        text not null check (length(btrim(nombre)) between 1 and 200),
  ciudad        text check (ciudad is null or length(ciudad) <= 120),
  ref           text not null check (ref like 'one://fotos-catalogo/%'),
  origen        text not null check (origen in ('wikimedia', 'asesora')),
  -- Wikimedia Commons: la página del archivo, su título, el autor y la licencia corta
  -- («CC BY-SA 4.0», «CC BY 2.0 de» para una adaptada a un país). NC y ND no entran.
  fuente_url    text check (fuente_url is null or fuente_url like 'https://commons.wikimedia.org/%'),
  titulo_fuente text check (titulo_fuente is null or length(titulo_fuente) <= 300),
  autor         text check (autor is null or length(autor) <= 200),
  licencia      text check (licencia is null or licencia ~ '^(CC0( 1\.0)?|CC BY(-SA)?( [0-9.]+)?( [a-z]{2,3})?)$'),
  -- Encuadre (fracciones del ancho y del alto) y ancho/alto del archivo guardado.
  foco_x        numeric check (foco_x is null or foco_x between 0 and 1),
  foco_y        numeric check (foco_y is null or foco_y between 0 and 1),
  proporcion    numeric check (proporcion is null or proporcion > 0),
  revisada      boolean not null default false,
  descartadas   text[] not null default '{}',
  created_by    uuid references public.staff(id) on delete set null,
  updated_by    uuid references public.staff(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Una foto de Commons sin autor, licencia o fuente no se puede imprimir con su crédito.
  constraint fotos_catalogo_wikimedia_con_credito check (
    origen <> 'wikimedia'
    or (fuente_url is not null and autor is not null and licencia is not null)
  )
);

create unique index fotos_catalogo_una_por_clave
  on public.fotos_catalogo (workspace_id, tipo, clave);
create index idx_fotos_catalogo_nombre
  on public.fotos_catalogo (workspace_id, tipo, nombre_clave);

alter table public.fotos_catalogo enable row level security;
revoke all on table public.fotos_catalogo from public, anon, authenticated;
create policy fotos_catalogo_ws on public.fotos_catalogo for all
  using (workspace_id = (select public.current_user_workspace_id()))
  with check (workspace_id = (select public.current_user_workspace_id()));
grant select, insert, update, delete on public.fotos_catalogo to authenticated;

comment on table public.fotos_catalogo is
  'Fotos de ciudad, hotel y actividad por workspace, reusadas entre cotizaciones por la propuesta de viaje. Archivo en el bucket privado fotos-catalogo (solo servidor). Las de Wikimedia Commons llevan autor y licencia (CC0, CC BY, CC BY-SA) para la línea de crédito.';

-- El bucket privado de los archivos. Sin policies: lo usa solo el cliente de servicio.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'fotos-catalogo',
  'fotos-catalogo',
  false,
  5000000,  -- BYTES_MAXIMOS_CATALOGO en src/lib/fotos/catalogo-almacen.ts
  array['image/jpeg']
)
on conflict (id) do nothing;
