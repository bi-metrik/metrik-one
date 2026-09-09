-- ============================================================
-- 20260909213743 — `suscripciones.pasarela` acepta 'wompi'
--
-- POR QUE:
--   El CHECK que trajo el PR #577 se escribio con la decision de pasarela ABIERTA y
--   solo admite 'manual', 'bold' y 'epayco'. La decision ya se tomo y es **Wompi**
--   (cerebro/decisiones/2026-09-09_wompi-exige-cuenta-bancolombia-sas.md): Bold no
--   cobra recurrente y Wompi si. Tal como quedo, la tabla rechazaria la unica
--   pasarela que se va a usar.
--
--   `planes_cobro.pasarela` ya aceptaba 'wompi' desde antes de #577 (valor heredado).
--   Esto alinea la tabla nueva con la que ya existia.
--
-- ⚠️ ESTA MIGRACION YA ESTA APLICADA EN PRODUCCION (2026-09-09, por SQL directo, con
--    dry-run previo). El archivo la espeja para que el repo y la base digan lo mismo:
--    sin el, quien reconstruya el esquema desde las migraciones obtiene un CHECK sin
--    'wompi'. En el ledger figura como version 20260909213743, nombre
--    `suscripciones_pasarela_acepta_wompi`.
--
-- DDL puro: `suscripciones` esta vacia (0 filas), ninguna fila puede violar el CHECK.
-- Se nombra el constraint explicitamente porque el original nacio dentro del CREATE
-- TABLE y Postgres le puso `suscripciones_pasarela_check`; un `drop ... if exists` con
-- un nombre supuesto es un fallo mudo (deja el viejo vivo y agrega el nuevo al lado),
-- el mismo patron que ya documenta 20260909000001_avisos_cliente_acuses_resend.
-- ============================================================

alter table public.suscripciones drop constraint suscripciones_pasarela_check;

alter table public.suscripciones add constraint suscripciones_pasarela_check
  check (pasarela in ('manual', 'wompi', 'bold', 'epayco'));

comment on column public.suscripciones.pasarela is
  'manual (Fase 1: se confirma el pago a mano) | wompi (pasarela elegida para el cobro recurrente; requiere cuenta de ahorros o corriente Bancolombia a nombre de la SAS) | bold (link de pago por cuota + webhook, sin cobro recurrente) | epayco (cargo por token).';
