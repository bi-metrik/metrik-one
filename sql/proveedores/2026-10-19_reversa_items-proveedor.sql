-- Reversa de supabase/migrations/20261019233000_items_proveedor.sql.
--
-- SE PIERDE: qué ficha de proveedor tiene cada línea (la reconocida por nombre vuelve sola al abrir
-- la cotización; la que fijó una persona con el buscador, no). El costo de las líneas NO se toca:
-- vive en `rubros` y en `items.tarifa_pax` (con el origen de la tarifa elegida). Correr SOLO después
-- de revertir el código que la nombra. Y borrar la fila del ledger:
--   delete from supabase_migrations.schema_migrations where version = '20261019233000';

drop trigger if exists items_proveedor_mismo_espacio on public.items;
drop function if exists public.items_proveedor_mismo_espacio();
drop index if exists public.idx_items_proveedor;
alter table public.items drop column if exists proveedor_id;
