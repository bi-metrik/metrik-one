-- ============================================================
-- Cron diario de `alertas-plazo`
--
-- 13:00 UTC = 8:00 en Bogota: el aviso esta en la bandeja cuando operaciones abre
-- el correo, no a media tarde cuando el dia ya se repartio.
--
-- POR QUE DIARIO Y NO CADA HORA: la condicion que evalua cambia una vez al dia
-- (un dia habil mas). Correr mas seguido no adelanta ningun aviso.
--
-- El secreto viaja desde el vault, no escrito en el comando: `cron.job` es una
-- tabla legible y un secreto ahi es un secreto publicado. Mismo patron que los
-- crons de wa-alerts, corregido el 2026-08-31.
-- ============================================================

select cron.unschedule('alertas-plazo-diario')
where exists (select 1 from cron.job where jobname = 'alertas-plazo-diario');

select cron.schedule(
  'alertas-plazo-diario',
  '0 13 * * *',
  $cron$
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_FUNCTIONS_URL') || '/alertas-plazo',
  body := '{}'::jsonb,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'NOTIFICAR_ETAPA_SECRET')
  )
);
  $cron$
);
