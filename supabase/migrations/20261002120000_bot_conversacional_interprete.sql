-- ============================================================
-- 20261002120000 — Bot de WhatsApp: el intérprete conversacional (apagado)
--
-- Encargo: proyectos/trappvel/clarity/docs/diseno/brief-max-2026-10-02-bot-conversacional.md
-- Diseño:  proyectos/trappvel/clarity/docs/diseno/yuto-bot-conversacional-2026-10-02.md (§1, §8)
--
-- Qué agrega (solo esquema, aditivo, todo nulo, sin backfill y sin tocar filas):
--   1. `wa_bandeja_mensajes.interpretacion`: lo que decidió el intérprete sobre un escrito del
--      comercial ({accion, viaje_id | nuevo | candidatos, con_contenido, evidencia, modelo}). La
--      escribe el intérprete con un UPDATE por `wa_message_id` después de registrar el mensaje
--      (la función `wa_bandeja_registrar_mensaje` NO cambia). `armarSegmentos` la usa primero; nula
--      (interruptor apagado o fallback) = el reparto de siempre, que relee el texto.
--   2. `wa_message_log`: la telemetría del intérprete, una fila por escrito que pasa por él:
--      · `interprete_accion`: la acción EJECUTADA tras el validador (`bandeja.contenido`, `bot.gasto`…).
--        Las filas `bandeja.%` no cuentan para el tope de 30 por hora (`checkInboundLimit`);
--      · `interprete_propuesta`: lo que propuso el modelo (acciones con su evidencia);
--      · `interprete_rechazo`: nulo si se aceptó tal cual; si no, el código de la regla (`V4_estado`…);
--      · `interprete_resultado`: atendido | fallback_timeout | fallback_http | fallback_esquema |
--        fallback_encabezado (el modelo no supo y el código de hoy tiene la lista exacta).
--
-- Sin tablas, vistas ni funciones nuevas: los permisos y el RLS de las dos tablas no cambian.
-- PENDIENTE CONOCIDO: la purga de 90 días de `wa_message_log` (20260915060000) anonimiza `phone` y
-- `message_preview`, pero no sabe de `interprete_propuesta`, que lleva la evidencia literal (un trozo
-- del escrito). Esta migración es solo aditiva a propósito; sumar esa columna a la purga es un cambio
-- de la función de purga y va aparte, ANTES de encender el interruptor en un workspace de cliente.
--
-- ORDEN: esta migración ANTES del deploy de `wa-webhook` y de `wa-alerts`. El código nuevo lee
-- `wa_bandeja_mensajes.interpretacion` y filtra `wa_message_log.interprete_accion`: sin las columnas,
-- PostgREST responde 42703. El interruptor (`config_extra.bot_conversacional`) queda apagado en todos
-- los workspaces: nadie lo enciende en esta migración.
--
-- Verificación después de aplicar (solo lectura):
--   select table_name, column_name, data_type, is_nullable from information_schema.columns
--    where table_schema = 'public'
--      and ((table_name = 'wa_bandeja_mensajes' and column_name = 'interpretacion')
--        or (table_name = 'wa_message_log' and column_name like 'interprete_%'))
--    order by 1, 2;
--   -- 5 filas, todas is_nullable = YES.
-- ============================================================

alter table public.wa_bandeja_mensajes
  add column if not exists interpretacion jsonb null;

comment on column public.wa_bandeja_mensajes.interpretacion is
  'Decisión del intérprete conversacional sobre este escrito ({accion, viaje_id|nuevo|candidatos, con_contenido, evidencia, modelo}). Nula = el reparto relee el texto como siempre.';

alter table public.wa_message_log
  add column if not exists interprete_accion text null,
  add column if not exists interprete_propuesta jsonb null,
  add column if not exists interprete_rechazo text null,
  add column if not exists interprete_resultado text null;

comment on column public.wa_message_log.interprete_accion is
  'Acción ejecutada por el intérprete tras el validador (bandeja.contenido, bot.gasto…). Las bandeja.% no cuentan para el tope de 30 por hora.';
comment on column public.wa_message_log.interprete_propuesta is
  'Lo que propuso el modelo del intérprete: las acciones con su evidencia literal.';
comment on column public.wa_message_log.interprete_rechazo is
  'Nulo si el validador aceptó la propuesta tal cual; si no, el código de la regla (V1_evidencia, V4_estado…).';
comment on column public.wa_message_log.interprete_resultado is
  'atendido | fallback_timeout | fallback_http | fallback_esquema | fallback_encabezado.';
