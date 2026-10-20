-- Dry-run de supabase/migrations/20261019233000_items_proveedor.sql contra producción.
--
-- UN solo statement: cuenta lo que existe; aplica la migración (cuerpo pegado TAL CUAL entre
-- $mig$); ensaya el trigger DENTRO de un subbloque que se deshace; vuelve a contar y aborta con
-- RAISE EXCEPTION. Nada queda escrito: el resultado vuelve en el mensaje del error. Correrlo por
-- MCP execute_sql y después confirmar que no quedó nada:
--   select count(*) from information_schema.columns
--    where table_schema = 'public' and table_name = 'items' and column_name = 'proveedor_id';   -- 0
--
-- Lo que tiene que decir:
--   ya_existia = false
--   items_antes = items_despues (no escribe datos)
--   nulos = true (la columna nace NULL en todas las líneas)
--   Ensayos (solo si hay una línea cuya cotización tiene fichas en su espacio):
--   mismo_ws = true (fijar una ficha del mismo espacio entra),
--   otro_ws = true (una ficha de otro espacio la frena el trigger; true si no hay otro espacio con fichas),
--   borrar = true (borrar la ficha deja la línea sin proveedor y la línea sigue ahí; true si otra
--   tabla no deja borrar la ficha)
-- Si el mensaje no empieza por «DRY-RUN OK», algo no cuadra: NO aplicar.

DO $dry$
DECLARE
  ya_existia      boolean;
  items_antes     bigint;
  items_despues   bigint;
  nulos           boolean;
  ensayado        boolean := false;
  mismo_ws        boolean := false;
  otro_ws         boolean := false;
  borrar          boolean := false;
  linea           uuid;
  ws              uuid;
  ficha           uuid;
  ficha_otro_ws   uuid;
  queda           uuid;
BEGIN
  SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public'
                 AND table_name = 'items' AND column_name = 'proveedor_id') INTO ya_existia;
  SELECT count(*) INTO items_antes FROM public.items;

  EXECUTE $mig$
-- ============================================================================
-- La línea de la cotización guarda su proveedor (Trappvel, decisión de Mauricio del 2026-10-19:
-- «ONE ofrece las tarifas y la persona elige»).
--
--   · `items.proveedor_id`: la ficha del proveedor de la línea (una fila de `fotos_perfiles`). La
--     llena ONE al reconocer la ficha por el nombre leído (como hoy) y la persona la puede fijar o
--     cambiar con el buscador de fichas de la línea, aunque no haya pantallazo. Con ella la línea
--     ofrece las tarifas de la extracción revisada del proveedor, y el IVA del proveedor se decide
--     por id y no por nombre. NULL = como hoy (se resuelve por nombre).
--   · `items` no tiene `workspace_id` (cuelga de `cotizaciones`): que la ficha sea del MISMO espacio
--     que la cotización lo hace cumplir un trigger, no una llave compuesta.
--   · Si se borra la ficha, la línea se queda sin proveedor (`on delete set null`); su costo no se
--     toca (vive en `rubros` y en `items.tarifa_pax`).
--
-- NO escribe datos: una columna que nace NULL, un índice parcial y un trigger. `items` ya tiene RLS
-- y sus grants; la columna los hereda.
--
-- epoca: no-rompe solo agrega una columna NULL; el código de antes no la nombra y lee items con select('*')
--
-- ⚠️ Aplicar ANTES del merge. Depende de `20261017090000_fotos_perfiles.sql` (aplicada).
-- Dry-run: sql/proveedores/2026-10-19_dry-run_items-proveedor.sql
-- Reversa: sql/proveedores/2026-10-19_reversa_items-proveedor.sql
-- ============================================================================

alter table public.items
  add column proveedor_id uuid references public.fotos_perfiles (id) on delete set null;

comment on column public.items.proveedor_id is
  'Ficha del proveedor de la línea (fotos_perfiles). La llena ONE al reconocer la ficha por nombre o la fija la persona con el buscador de la línea. NULL = se resuelve por nombre, como antes. Mismo workspace que la cotización (trigger items_proveedor_mismo_espacio).';

create index idx_items_proveedor on public.items (proveedor_id) where proveedor_id is not null;

-- La ficha tiene que ser del espacio de la cotización. Corre con los permisos de quien escribe: con
-- el cliente de sesión, el RLS ya esconde la ficha de otro espacio y el trigger la rechaza igual.
create function public.items_proveedor_mismo_espacio()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $fn$
begin
  if new.proveedor_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.proveedor_id is not distinct from old.proveedor_id
     and new.cotizacion_id is not distinct from old.cotizacion_id then
    return new;
  end if;
  if not exists (
    select 1
    from public.cotizaciones c
    join public.fotos_perfiles p on p.workspace_id = c.workspace_id
    where c.id = new.cotizacion_id and p.id = new.proveedor_id
  ) then
    raise exception 'El proveedor de la línea tiene que ser una ficha del mismo espacio que la cotización'
      using errcode = 'check_violation';
  end if;
  return new;
end
$fn$;

revoke execute on function public.items_proveedor_mismo_espacio() from public, anon, authenticated;

create trigger items_proveedor_mismo_espacio
  before insert or update of proveedor_id, cotizacion_id on public.items
  for each row execute function public.items_proveedor_mismo_espacio();
$mig$;

  SELECT count(*) INTO items_despues FROM public.items;
  EXECUTE $q$ SELECT NOT EXISTS (SELECT 1 FROM public.items WHERE proveedor_id IS NOT NULL) $q$ INTO nulos;

  SELECT i.id, c.workspace_id INTO linea, ws
    FROM public.items i JOIN public.cotizaciones c ON c.id = i.cotizacion_id
   WHERE EXISTS (SELECT 1 FROM public.fotos_perfiles p WHERE p.workspace_id = c.workspace_id)
   ORDER BY i.created_at DESC NULLS LAST LIMIT 1;
  IF linea IS NOT NULL THEN
    ensayado := true;
    SELECT id INTO ficha FROM public.fotos_perfiles WHERE workspace_id = ws ORDER BY created_at LIMIT 1;
    SELECT id INTO ficha_otro_ws FROM public.fotos_perfiles WHERE workspace_id <> ws ORDER BY created_at LIMIT 1;
    BEGIN
      EXECUTE $q$ UPDATE public.items SET proveedor_id = $2 WHERE id = $1 $q$ USING linea, ficha;
      mismo_ws := true;
      IF ficha_otro_ws IS NOT NULL THEN
        BEGIN
          EXECUTE $q$ UPDATE public.items SET proveedor_id = $2 WHERE id = $1 $q$ USING linea, ficha_otro_ws;
        EXCEPTION WHEN check_violation THEN otro_ws := true;
        END;
      ELSE
        otro_ws := true;
      END IF;
      BEGIN
        EXECUTE $q$ DELETE FROM public.fotos_perfiles WHERE id = $1 $q$ USING ficha;
        EXECUTE $q$ SELECT id FROM public.items WHERE id = $1 AND proveedor_id IS NULL $q$ INTO queda USING linea;
        borrar := queda IS NOT NULL;
      EXCEPTION WHEN foreign_key_violation THEN
        borrar := true;
      END;
      RAISE EXCEPTION 'deshacer';
    EXCEPTION WHEN raise_exception THEN
      IF SQLERRM <> 'deshacer' THEN RAISE; END IF;
    END;
  END IF;

  RAISE EXCEPTION '% ya_existia=% items_antes=% items_despues=% nulos=% ensayado=% mismo_ws=% otro_ws=% borrar=%',
    CASE WHEN NOT ya_existia AND items_antes = items_despues AND nulos
              AND (NOT ensayado OR (mismo_ws AND otro_ws AND borrar))
         THEN 'DRY-RUN OK' ELSE 'DRY-RUN NO CUADRA' END,
    ya_existia, items_antes, items_despues, nulos, ensayado, mismo_ws, otro_ws, borrar;
END
$dry$;
