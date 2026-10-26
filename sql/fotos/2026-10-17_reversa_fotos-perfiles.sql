-- Reversa de supabase/migrations/20261017090000_fotos_perfiles.sql.
--
-- Quita la vista `fotos_catalogo_por_clave`, las tablas `fotos_perfiles_alias` y `fotos_perfiles`
-- y la columna `fotos_catalogo.orden`. Se pierden los perfiles creados, los nombres confirmados
-- como «el mismo hotel» y el orden que puso la asesora; las FOTOS (`fotos_catalogo`, sus archivos,
-- su principal, su puesto, su categoría y su autorización) no se tocan. Correr SOLO después de
-- revertir el código que las lee (si no, la tarjeta y «Hoteles y tours» dicen «falta aplicar la
-- migración»). Y borrar la fila del ledger:
--   delete from supabase_migrations.schema_migrations where version = '20261017090000';

drop view if exists public.fotos_catalogo_por_clave;
drop table if exists public.fotos_perfiles_alias;
drop table if exists public.fotos_perfiles;
alter table public.fotos_catalogo drop column if exists orden;
