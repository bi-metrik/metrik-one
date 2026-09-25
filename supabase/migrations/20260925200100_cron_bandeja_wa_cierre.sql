-- ============================================================
-- 20260925200100 — Cron que cierra por inactividad las entregas de la bandeja de WhatsApp
--
-- ORDEN: se aplica DESPUÉS de desplegar `wa-alerts` con la acción `bandeja_cierre`, y después
-- de la migración 20260925200000. Al revés, cada minuto con una entrega abierta el cron le
-- pegaría a una función que no conoce la acción (responde 400) y la entrega no se cerraría.
--
-- POR QUÉ CADA MINUTO: la ventana de inactividad es de minutos (5 por defecto). Un cron diario
-- dejaría al comercial esperando la pregunta hasta el otro día.
--
-- POR QUÉ NO CUESTA NADA MIENTRAS NADIE LO USE: el `where exists` hace que el cron solo llame
-- a la función cuando HAY una entrega abierta. Con la bandeja apagada en todos los workspaces
-- no sale ni una petición.
--
-- AUTENTICACIÓN: mismo perfil de llamador que los demás crons de `wa-alerts` (un cron interno
-- que manda WhatsApp), mismo secreto (`WA_ALERTS_SECRET`), leído del vault y no escrito en el
-- comando: `cron.job` es una tabla legible.
--
-- ⚠️ SIN VERIFICAR al escribir esto (no hubo lectura del vault): que el secreto del vault se
-- llame exactamente `WA_ALERTS_SECRET`, como dice el comentario de `wa-alerts/index.ts`.
-- Comprobar antes de aplicar:
--   select name from vault.decrypted_secrets where name in ('WA_ALERTS_SECRET', 'SUPABASE_FUNCTIONS_URL');
--     -> las dos filas
--
-- Verificación después de aplicar:
--   select jobname, schedule from cron.job where jobname = 'wa-bandeja-cierre';
-- ============================================================

select cron.unschedule('wa-bandeja-cierre')
where exists (select 1 from cron.job where jobname = 'wa-bandeja-cierre');

select cron.schedule(
  'wa-bandeja-cierre',
  '* * * * *',
  $cron$
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_FUNCTIONS_URL') || '/wa-alerts',
  body := '{"action":"bandeja_cierre"}'::jsonb,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'WA_ALERTS_SECRET')
  )
)
where exists (select 1 from public.wa_bandeja_entregas where estado = 'abierta');
  $cron$
);
