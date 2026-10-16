-- ============================================================================
-- Perfiles de hotel y de tour para la biblioteca de fotos (Mauricio, 2026-10-16). SOLO ESQUEMA.
--
-- La búsqueda automática de fotos (Wikimedia Commons, Wikidata, la web oficial y el clasificador)
-- se quitó: la biblioteca la arma la agencia. Cada hotel y cada tour que entra a una cotización
-- tiene un PERFIL, y las fotos del perfil entran solas en la propuesta. Este archivo agrega:
--
--   · `fotos_perfiles`: un hotel o un tour del espacio. `clave` es la MISMA llave con que sus fotos
--     viven en `fotos_catalogo` («catalonia puerta del sol|madrid»): las fotos no cambian de lugar.
--     Lo crea ONE la primera vez que el hotel o el tour aparece en una cotización.
--   · `fotos_perfiles_alias`: otro nombre del mismo perfil. «Hotel Catalonia Puerta del Sol
--     Madrid» y «Catalonia Puerta del Sol» dan llaves distintas; cuando la asesora confirma «es el
--     mismo hotel» (o los nombres son iguales sin «hotel», la ciudad, tildes ni signos), la llave
--     nueva queda aquí apuntando al perfil y la próxima vez se reconoce sola. Una llave es de UN
--     solo perfil (índice único) y el alias solo apunta a un perfil del mismo espacio y del mismo
--     tipo (llave foránea compuesta).
--   · `fotos_catalogo_por_clave` (vista, security_invoker): las fotos de cada llave PEDIDA, la
--     propia o la de un alias, en una sola lectura. La propuesta lee de aquí: así reconocer un
--     alias no le suma una ida a la base al PDF.
--   · `fotos_catalogo.orden`: el orden de las fotos de un perfil (la asesora las reordena). Nulo en
--     las que ya existen: se ordenan como hoy (la principal primero, luego el puesto).
--
-- Las tablas las leen y escriben la sesión (`authenticated`) por workspace (RLS con
-- `current_user_workspace_id()`), como `fotos_catalogo`. NO escribe ni corrige ninguna fila
-- existente: las fotos de antes siguen con su llave y la propuesta las encuentra igual.
--
-- epoca: no-rompe solo agrega dos tablas, una vista y una columna nullable; nada que el código de antes use cambia
--
-- ⚠️ Aplicar ANTES del merge: el código nuevo lee la vista y las tablas. Sin ellas la tarjeta y la
-- pantalla «Hoteles y tours» dicen «falta aplicar la migración» y la propuesta sale sin fotos de la
-- biblioteca. Depende de `20261016221500` (categoria) y `20261016233000` (autorización).
-- Dry-run: sql/fotos/2026-10-17_dry-run_fotos-perfiles.sql
-- Reversa: sql/fotos/2026-10-17_reversa_fotos-perfiles.sql
-- ============================================================================

create table public.fotos_perfiles (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  tipo          text not null check (tipo in ('hotel', 'actividad')),
  -- La llave de sus fotos en `fotos_catalogo` (`claveDeFoto`, src/lib/fotos/clave.ts).
  clave         text not null check (length(clave) between 1 and 300),
  -- El nombre como llegó la primera vez: «Catalonia Puerta del Sol».
  nombre        text not null check (length(btrim(nombre)) between 1 and 200),
  ciudad        text check (ciudad is null or length(ciudad) <= 120),
  created_by    uuid references public.staff(id) on delete set null,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  -- Destino de la llave foránea compuesta del alias (mismo espacio, mismo tipo).
  constraint fotos_perfiles_id_ws_tipo unique (id, workspace_id, tipo)
);

create unique index fotos_perfiles_una_por_clave
  on public.fotos_perfiles (workspace_id, tipo, clave);

alter table public.fotos_perfiles enable row level security;
revoke all on table public.fotos_perfiles from public, anon, authenticated;
create policy fotos_perfiles_ws on public.fotos_perfiles for all
  using (workspace_id = (select public.current_user_workspace_id()))
  with check (workspace_id = (select public.current_user_workspace_id()));
grant select, insert, update on public.fotos_perfiles to authenticated;

comment on table public.fotos_perfiles is
  'Hoteles y tours del espacio con fotos en la biblioteca (fotos_catalogo, por la misma clave). Los crea ONE cuando aparecen en una cotización; las fotos del perfil entran solas en la propuesta.';

create table public.fotos_perfiles_alias (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  perfil_id     uuid not null,
  tipo          text not null check (tipo in ('hotel', 'actividad')),
  -- La otra llave que es este mismo perfil: «hotel catalonia puerta del sol madrid|madrid».
  clave         text not null check (length(clave) between 1 and 300),
  nombre        text not null check (length(btrim(nombre)) between 1 and 200),
  ciudad        text check (ciudad is null or length(ciudad) <= 120),
  created_by    uuid references public.staff(id) on delete set null,
  created_at    timestamptz not null default now(),
  constraint fotos_perfiles_alias_perfil_fk foreign key (perfil_id, workspace_id, tipo)
    references public.fotos_perfiles (id, workspace_id, tipo) on delete cascade
);

-- Una llave es de un solo perfil.
create unique index fotos_perfiles_alias_una_por_clave
  on public.fotos_perfiles_alias (workspace_id, tipo, clave);
create index idx_fotos_perfiles_alias_perfil
  on public.fotos_perfiles_alias (perfil_id);

alter table public.fotos_perfiles_alias enable row level security;
revoke all on table public.fotos_perfiles_alias from public, anon, authenticated;
create policy fotos_perfiles_alias_ws on public.fotos_perfiles_alias for all
  using (workspace_id = (select public.current_user_workspace_id()))
  with check (workspace_id = (select public.current_user_workspace_id()));
grant select, insert, delete on public.fotos_perfiles_alias to authenticated;

comment on table public.fotos_perfiles_alias is
  'Otros nombres (llaves) de un perfil de hotel o tour: la asesora confirmó que es el mismo, o el nombre coincide sin «hotel», la ciudad, tildes ni signos. La próxima cotización lo reconoce sola.';

alter table public.fotos_catalogo
  add column orden smallint check (orden is null or orden between 1 and 3);

comment on column public.fotos_catalogo.orden is
  'Orden de la foto en su perfil (1 a 3), el que pone la asesora. NULL en las de antes: la principal primero y luego el puesto.';

-- Las fotos de cada llave pedida: la propia (`clave`) y la de cada alias (`clave` del alias →
-- su perfil → las fotos con la llave del perfil). `clave_pedida` es la llave por la que se
-- pregunta; `clave` sigue siendo la del perfil.
create view public.fotos_catalogo_por_clave with (security_invoker = on) as
  select
    f.id, f.workspace_id, f.tipo, f.clave, f.nombre_clave, f.nombre, f.ciudad, f.ref, f.origen,
    f.fuente_url, f.titulo_fuente, f.autor, f.licencia, f.foco_x, f.foco_y, f.proporcion,
    f.revisada, f.descartadas, f.principal, f.posicion, f.orden, f.imagen_url, f.categoria,
    f.clave as clave_pedida
  from public.fotos_catalogo f
  union all
  select
    f.id, f.workspace_id, f.tipo, f.clave, f.nombre_clave, f.nombre, f.ciudad, f.ref, f.origen,
    f.fuente_url, f.titulo_fuente, f.autor, f.licencia, f.foco_x, f.foco_y, f.proporcion,
    f.revisada, f.descartadas, f.principal, f.posicion, f.orden, f.imagen_url, f.categoria,
    a.clave as clave_pedida
  from public.fotos_perfiles_alias a
  join public.fotos_perfiles p on p.id = a.perfil_id
  join public.fotos_catalogo f
    on f.workspace_id = p.workspace_id and f.tipo = p.tipo and f.clave = p.clave;

revoke all on table public.fotos_catalogo_por_clave from public, anon, authenticated;
grant select on public.fotos_catalogo_por_clave to authenticated;

comment on view public.fotos_catalogo_por_clave is
  'Fotos de la biblioteca por la llave que pide la cotización (la del perfil o la de un alias). security_invoker: respeta el RLS de fotos_catalogo, fotos_perfiles y fotos_perfiles_alias.';
