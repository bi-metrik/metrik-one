---
name: resend-pro-alarma-volumen
description: Resend Pro (26-oct) - avisos a clientes desde avisos.metrikone.co, suprimido/fallido en el webhook, avisos_equipo y contador email.sent; migración 20261026221500 SIN aplicar
metadata:
  type: project
---

PR feat/resend-pro-remitentes-alarma (26-oct-2026), NO mergear hasta verificar DNS de `avisos.metrikone.co` en Resend.

- Reparto de dominios: raíz metrikone.co = auth/sistema/internos; `avisos@avisos.metrikone.co` = avisos al cliente sin
  `remitente_correo` (nombre visible de siempre); `<ws>.metrikone.co` = propio; metrik.com.co = facturación
  (`src/lib/email/remitente-facturacion.ts`, también enlace automático y cobro de prueba de Valida).
- `email.failed` → `fallido` (motivo `resend_failed: <razon>`), `email.suppressed` → `suprimido`; misma guarda
  `estado='enviado'` que el rebote. El backfill sigue sin mapear `suppressed` (a propósito).
- `avisos_equipo` (workspace_id nullable para la alarma): notificar-etapa, avisar-asignacion, alertas-plazo y
  recordatorios/correo-equipo (Next). Sin traza aún: los internos de src/lib (sobrepago, reverso, compliance, aprobación).
- Contador: `resend_contar_enviado(svix_id)` en la base; umbrales, día de corte (1) e incluidos en la fila
  `resend_volumen_config`. Si el correo de alarma falla, `resend_volumen_desmarcar` y reintenta el próximo email.sent;
  el WhatsApp (`WA_ADMIN_NOTIFY_PHONE`) solo acompaña al correo que salió.

**Why:** separar reputación de envío y no pasarse del cupo de 50.000 sin enterarse.
**How to apply:** orden de salida = aplicar migración → desplegar resend-webhook, notificar-etapa, alertas-plazo,
avisar-asignacion → suscribir email.sent/suppressed/failed en Resend → verificar DNS avisos → merge.
