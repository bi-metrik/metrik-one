-- Reversa de supabase/migrations/20261016233000_fotos_catalogo_autorizacion.sql.
--
-- Quita `autorizada_por`, `autorizada_at` y `procedencia` de `fotos_catalogo` (y sus CHECK). Se
-- pierde el registro de quién autorizó cada foto subida desde la migración; las fotos, sus puestos,
-- su categoría y la principal no se tocan. Correr SOLO después de revertir el código que las
-- escribe (si no, guardar una foto dice «falta aplicar la migración»). Y borrar la fila del ledger:
--   delete from supabase_migrations.schema_migrations where version = '20261016233000';

alter table public.fotos_catalogo drop constraint if exists fotos_catalogo_autorizada_con_fecha;
alter table public.fotos_catalogo drop constraint if exists fotos_catalogo_procedencia_check;
alter table public.fotos_catalogo drop column if exists procedencia;
alter table public.fotos_catalogo drop column if exists autorizada_at;
alter table public.fotos_catalogo drop column if exists autorizada_por;
