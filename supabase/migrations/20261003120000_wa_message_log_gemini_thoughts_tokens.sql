-- ============================================================
-- 20261003120000 — wa_message_log: los tokens de razonamiento de Gemini
--
-- Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-03-gemini-3-8-flash.md (punto 4)
--
-- Qué agrega (solo esquema, aditivo, nulo, sin backfill y sin tocar filas):
--   · `wa_message_log.gemini_thoughts_tokens`: `usageMetadata.thoughtsTokenCount` del llamado al
--     intérprete. Los modelos 3.x con `thinkingLevel: LOW` a veces piensan, y ese razonamiento se cobra
--     como salida aunque no aparezca en `gemini_output_tokens` (`candidatesTokenCount`). También se
--     llena en los fallbacks que llegaron con HTTP 200 (MAX_TOKENS): ese razonamiento se cobró igual.
--     Es un número: no lleva texto del mensaje y la purga de 90 días no necesita tocarlo.
--
-- Sin tablas, vistas ni funciones nuevas: los permisos y el RLS no cambian.
--
-- ORDEN: puede ir antes o después del deploy de `wa-webhook`. Si el código llega primero, el insert
-- de la telemetría ve PGRST204/42703 por esta columna y repite la fila sin ella (wa-interprete.ts,
-- `telemetria`): no se pierde la fila de la que depende el tope de llamados por hora.
--
-- Verificación después de aplicar (solo lectura):
--   select column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public' and table_name = 'wa_message_log' and column_name = 'gemini_thoughts_tokens';
--   -- 1 fila: integer, YES.
--
-- Cómo revertir: alter table public.wa_message_log drop column if exists gemini_thoughts_tokens;
-- ============================================================

alter table public.wa_message_log
  add column if not exists gemini_thoughts_tokens integer null;

comment on column public.wa_message_log.gemini_thoughts_tokens is
  'usageMetadata.thoughtsTokenCount del llamado a Gemini (se cobra como salida). Nulo si no hubo respuesta del modelo.';
