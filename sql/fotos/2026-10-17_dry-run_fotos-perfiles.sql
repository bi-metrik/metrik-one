-- Dry-run de supabase/migrations/20261017090000_fotos_perfiles.sql contra producción.
--
-- UN solo statement: cuenta las filas de `fotos_catalogo`, aplica la migración (cuerpo pegado TAL
-- CUAL entre $mig$), ensaya las reglas nuevas DENTRO de subbloques que se deshacen, vuelve a contar
-- y aborta con RAISE EXCEPTION. Nada queda escrito: el resultado vuelve en el mensaje del error.
-- Correrlo por MCP execute_sql y después confirmar que no quedó nada:
--   select to_regclass('public.fotos_perfiles'), to_regclass('public.fotos_perfiles_alias'),
--          to_regclass('public.fotos_catalogo_por_clave');                          -- null, null, null
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'fotos_catalogo' and column_name = 'orden';  -- 0
--
-- Lo que tiene que decir:
--   ya_existia = false (ni las tablas, ni la vista, ni la columna estaban)
--   filas_antes = filas_despues (no escribe fotos)
--   vista_igual = true (la vista devuelve, por su propia llave, exactamente las fotos de la tabla)
--   invoker = true (la vista quedó con security_invoker)
--   alias_ve = true (un perfil con alias: la vista da sus fotos también por la llave del alias)
--   alias_repetido = true (una llave no puede ser de dos perfiles: la frena el índice único)
--   alias_otro_tipo = true (un alias de «actividad» no apunta a un perfil «hotel»: la frena la llave foránea)
--   orden_fuera = true (orden 4 lo frena el CHECK)
-- (los ensayos con fotos solo corren si hay al menos una foto de hotel o de actividad)
-- Si el mensaje no empieza por «DRY-RUN OK», algo no cuadra: NO aplicar.

DO $dry$
DECLARE
  ya_existia       boolean;
  filas_antes      bigint;
  filas_despues    bigint;
  vista_igual      boolean;
  invoker          boolean;
  alias_ve         boolean := false;
  alias_repetido   boolean := false;
  alias_otro_tipo  boolean := false;
  orden_fuera      boolean := false;
  una              record;
  perfil           uuid;
  n                bigint;
BEGIN
  SELECT to_regclass('public.fotos_perfiles') IS NOT NULL
      OR to_regclass('public.fotos_perfiles_alias') IS NOT NULL
      OR to_regclass('public.fotos_catalogo_por_clave') IS NOT NULL
      OR EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'fotos_catalogo' AND column_name = 'orden')
    INTO ya_existia;
  SELECT count(*) INTO filas_antes FROM public.fotos_catalogo;

  EXECUTE $mig$
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
  $mig$;

  SELECT count(*) INTO filas_despues FROM public.fotos_catalogo;
  SELECT NOT EXISTS (
    (SELECT id, clave FROM public.fotos_catalogo EXCEPT SELECT id, clave_pedida FROM public.fotos_catalogo_por_clave)
    UNION ALL
    (SELECT id, clave_pedida FROM public.fotos_catalogo_por_clave EXCEPT SELECT id, clave FROM public.fotos_catalogo)
  ) INTO vista_igual;
  SELECT coalesce(array_to_string(reloptions, ',') ~ 'security_invoker=(on|true)', false) INTO invoker
    FROM pg_class WHERE oid = 'public.fotos_catalogo_por_clave'::regclass;

  SELECT workspace_id, tipo, clave, nombre, id INTO una
    FROM public.fotos_catalogo WHERE tipo IN ('hotel', 'actividad') LIMIT 1;
  IF una.id IS NOT NULL THEN
    BEGIN
      INSERT INTO public.fotos_perfiles (workspace_id, tipo, clave, nombre)
        VALUES (una.workspace_id, una.tipo, una.clave, una.nombre) RETURNING id INTO perfil;
      INSERT INTO public.fotos_perfiles_alias (workspace_id, perfil_id, tipo, clave, nombre)
        VALUES (una.workspace_id, perfil, una.tipo, 'dry run alias|', 'Dry run alias');
      SELECT count(*) INTO n FROM public.fotos_catalogo_por_clave WHERE clave_pedida = 'dry run alias|' AND id = una.id;
      alias_ve := n = 1;
      BEGIN
        INSERT INTO public.fotos_perfiles_alias (workspace_id, perfil_id, tipo, clave, nombre)
          VALUES (una.workspace_id, perfil, una.tipo, 'dry run alias|', 'Otra vez');
      EXCEPTION WHEN unique_violation THEN alias_repetido := true;
      END;
      BEGIN
        INSERT INTO public.fotos_perfiles_alias (workspace_id, perfil_id, tipo, clave, nombre)
          VALUES (una.workspace_id, perfil, CASE WHEN una.tipo = 'hotel' THEN 'actividad' ELSE 'hotel' END, 'dry run otro tipo|', 'Otro tipo');
      EXCEPTION WHEN foreign_key_violation THEN alias_otro_tipo := true;
      END;
      BEGIN
        UPDATE public.fotos_catalogo SET orden = 4 WHERE id = una.id;
      EXCEPTION WHEN check_violation THEN orden_fuera := true;
      END;
      RAISE EXCEPTION 'deshacer';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'deshacer' THEN RAISE; END IF;
    END;
  END IF;

  RAISE EXCEPTION '% ya_existia=% filas_antes=% filas_despues=% vista_igual=% invoker=% alias_ve=% alias_repetido=% alias_otro_tipo=% orden_fuera=%',
    CASE WHEN NOT ya_existia AND filas_antes = filas_despues AND vista_igual AND invoker
              AND (una.id IS NULL OR (alias_ve AND alias_repetido AND alias_otro_tipo AND orden_fuera))
         THEN 'DRY-RUN OK' ELSE 'DRY-RUN NO CUADRA' END,
    ya_existia, filas_antes, filas_despues, vista_igual, invoker, alias_ve, alias_repetido, alias_otro_tipo, orden_fuera;
END
$dry$;
