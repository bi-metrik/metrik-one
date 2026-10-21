-- Reversa de supabase/migrations/20261019120000_guardar_reparto_comercial.sql.
--
-- Quita la función. No toca datos: las porciones que el comercial guardó con ella son
-- cobros normales (`split_json.origen = 'comercial'`) y siguen ahí. Correr SOLO después de
-- revertir el código que la llama (`guardarRepartoComercialCore` en
-- src/lib/actions/conciliacion-actions.ts): sin la función, el comercial no puede repartir
-- y la pantalla dice «falta aplicar la migración». Y borrar la fila del ledger:
--   delete from supabase_migrations.schema_migrations where version = '20261019120000';

drop function if exists public.guardar_reparto_comercial(text, numeric, jsonb, date, text, text);
