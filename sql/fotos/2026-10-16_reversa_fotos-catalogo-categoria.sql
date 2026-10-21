-- Reversa de supabase/migrations/20261016221500_fotos_catalogo_categoria.sql.
--
-- Quita la columna `categoria` de `fotos_catalogo` (y su CHECK). Se pierde la categoría de las
-- fotos de hotel elegidas desde la migración; las fotos, sus puestos y la principal no se tocan.
-- Correr SOLO después de revertir el código que lee la columna (si no, la biblioteca dice «falta
-- aplicar la migración»). Y borrar la fila del ledger:
--   delete from supabase_migrations.schema_migrations where version = '20261016221500';

alter table public.fotos_catalogo drop constraint if exists fotos_catalogo_categoria_check;
alter table public.fotos_catalogo drop column if exists categoria;
