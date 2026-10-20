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
