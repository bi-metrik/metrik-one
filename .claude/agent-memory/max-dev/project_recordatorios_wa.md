---
name: recordatorios-wa
description: Recordatorios programados por WhatsApp con confirmación y escalamiento (PR #966, apagado) — 2 migraciones SIN aplicar; disparo por pg_cron; el webhook no leía `type: 'button'`
metadata:
  type: project
---

PR #966 (2026-09-30), checks verdes, SIN mergear. Capacidad genérica nueva: `wa_recordatorios` +
`wa_recordatorio_eventos` (una fila por dosis), acción `recordatorios` de `wa-alerts`, pg_cron
`wa-recordatorios` cada 15 min, confirmación por botón de plantilla en `wa-webhook`.

**Why:** el encargo daba por hecho que no había envío por plantilla en ONE. Falso: `sendTemplate` y
el registro `WA_ALERT_TEMPLATES` existen en `_shared/wa-respond.ts` / `wa-plantillas.ts` desde el
frente de `wa_envios`. Lo que de verdad faltaba era el ledger de adherencia y la lectura del
webhook `type: 'button'` (la respuesta rápida de una PLANTILLA no llega como
`interactive.button_reply`, y caía en el `return null` de «tipo no soportado»).

**How to apply:**
- **Orden**: aplicar `20260930140000` (tablas) y `20260930140100` (cron) ANTES del merge — las dos
  de una: el cron no llama a `wa-alerts` mientras no haya un recordatorio activo. Después del
  merge, desplegar `wa-alerts` y `wa-webhook`. No hace falta ninguna variable nueva en Vercel.
- **Festivos NO aplican a este tipo**: corre los 365 días, así que NO pasa por `enviarAlerta` (que
  aplica día hábil desde el 2026-09-27 y tope de 2 por persona). Si alguien lo «unifica» con las
  alertas, rompe el producto. Ver [[avisos-dia-habil]].
- **Doble bandera**: `WA_RECORDATORIOS=on` Y plantilla declarada para el intent `recordatorio`. Sin
  plantilla NO degrada a texto libre a propósito (fuera de la ventana Meta responde 131047 y cuenta
  el fallo; el ledger habría dicho que la dosis salió). La plantilla la somete Yuto; el payload del
  botón tiene que ser `rec_ok` si es estático, o `rec_ok:<id de dosis>` si es variable.
- **El disparo sub-diario en ONE va por pg_cron, no por `vercel.json`** (decisión de Mauricio,
  2026-09-30, al revisar este PR): los 14 crons de Vercel son todos diarios, el secreto vive en el
  vault de Postgres y no hay que copiar `WA_ALERTS_SECRET` a Vercel. Un cron de Vercel además solo
  se registra en el deploy de producción, así que si el plan no acepta la cadencia solo se sabría
  mergeando. Patrón a copiar: `20260929100100`, con guarda «solo si hay trabajo».
- Idempotencia por reclamo (`update ... where <marca> is null returning`), no por lectura previa; si
  Meta rechaza, `enviado_at` NO se revierte (reintentar cada 15 min hace que Meta cuente fallos).
- Privacidad: lo único que viaja a Meta es `etiqueta`, texto neutro. Nada clínico en tabla, logs,
  pruebas ni PR.
