-- ============================================================
-- 20260929100100 — Cron del paso de entendimiento de la bandeja de WhatsApp
--
-- ORDEN: DESPUÉS de 20260929100000 y DESPUÉS de desplegar `wa-alerts` con la acción
-- `bandeja_entendimiento` (y `wa-webhook`, que toma la respuesta a «¿cuál contacto?»). Al
-- revés, el cron le pegaría a una función que no conoce la acción (400) y nada avanzaría.
--
-- CADA MINUTO, pero solo llama cuando HAY trabajo: una entrega `con_cliente` sin
-- entendimiento, un entendimiento en error con intentos disponibles, o una respuesta de
-- contacto por resolver. Con la bandeja apagada en todos los workspaces no hay entregas, así
-- que no sale ni una petición.
--
-- Mismo secreto y misma URL que `wa-bandeja-cierre` (20260925200100), leídos del vault.
--
-- Verificación después de aplicar:
--   select jobname, schedule from cron.job where jobname = 'wa-bandeja-entendimiento';
-- ============================================================

select cron.unschedule('wa-bandeja-entendimiento')
where exists (select 1 from cron.job where jobname = 'wa-bandeja-entendimiento');

select cron.schedule(
  'wa-bandeja-entendimiento',
  '* * * * *',
  $cron$
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_FUNCTIONS_URL') || '/wa-alerts',
  body := '{"action":"bandeja_entendimiento"}'::jsonb,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'WA_ALERTS_SECRET')
  )
)
where exists (
  select 1 from public.wa_bandeja_entregas e
  where e.estado = 'con_cliente'
    and not exists (select 1 from public.wa_bandeja_entendimientos x where x.entrega_id = e.id)
)
or exists (
  select 1 from public.wa_bandeja_entendimientos x
  where (x.estado = 'error' and x.intentos < 3 and x.negocio_id is null and x.contacto_id is null)
     or (x.estado = 'esperando_contacto' and x.respuesta_contacto is not null)
);
  $cron$
);
