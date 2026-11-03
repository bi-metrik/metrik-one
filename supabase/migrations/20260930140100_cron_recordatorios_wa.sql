-- ============================================================
-- 20260930140100 — Cron de los recordatorios programados por WhatsApp
--
-- ORDEN: DESPUÉS de 20260930140000 (las dos tablas). Las dos se pueden aplicar de una: este
-- cron no le pega a `wa-alerts` mientras no haya ningún recordatorio activo, y en el momento
-- de aplicar no hay ninguno (se siembran por SQL, aparte y después).
--
-- Por qué pg_cron y no un cron de Vercel: todo lo sub-diario de ONE ya corre así
-- (`wa-bandeja-cierre`, `wa-bandeja-entendimiento`), con el secreto en el vault de Postgres y
-- no en el comando del job. Las 14 entradas de `vercel.json` son todas diarias, y meter una
-- cada 15 minutos allá habría exigido además copiar `WA_ALERTS_SECRET` a las variables de
-- Vercel, donde hoy no existe: una dependencia nueva que nadie iba a recordar poner, para
-- averiguar solo en producción si el plan acepta la cadencia. Un mecanismo para lo sub-diario.
--
-- CADA 15 MINUTOS, pero solo llama cuando HAY trabajo: algún recordatorio activo. Con la tabla
-- vacía (el estado en que esto se entrega) no sale ni una petición. La guarda es deliberadamente
-- gruesa — «hay alguien a quien recordarle» y no «hay una dosis vencida» — porque la aritmética
-- de la hora de Bogotá vive en la función (`_shared/wa-recordatorios-reglas.ts`), que es donde
-- está probada; duplicarla en SQL sería otra fuente de verdad para lo mismo.
--
-- ⚠️ Corre los 365 días, festivo y domingo incluidos. La decisión del 2026-09-27 (avisos
-- automáticos al cliente solo en día hábil del país del cliente) NO cubre este tipo: un
-- recordatorio que se salta el domingo es el fallo que el módulo vino a evitar. No agregarle
-- aquí ninguna condición de calendario.
--
-- ⚠️ Aunque el job quede registrado, NADA sale hasta que `wa-alerts` tenga `WA_RECORDATORIOS=on`
-- y una plantilla declarada en `WA_ALERT_TEMPLATES`. Ver la cabecera de 20260930140000.
--
-- Mismo secreto y misma URL que `wa-bandeja-entendimiento` (20260929100100), leídos del vault.
--
-- Verificación después de aplicar:
--   select jobname, schedule, active from cron.job where jobname = 'wa-recordatorios';
-- ============================================================

select cron.unschedule('wa-recordatorios')
where exists (select 1 from cron.job where jobname = 'wa-recordatorios');

select cron.schedule(
  'wa-recordatorios',
  '*/15 * * * *',
  $cron$
select net.http_post(
  url := (select decrypted_secret from vault.decrypted_secrets where name = 'SUPABASE_FUNCTIONS_URL') || '/wa-alerts',
  body := '{"action":"recordatorios"}'::jsonb,
  headers := jsonb_build_object(
    'Content-Type', 'application/json',
    'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'WA_ALERTS_SECRET')
  )
)
where exists (select 1 from public.wa_recordatorios where activo);
  $cron$
);
