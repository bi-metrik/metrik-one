---
name: project-epayco-reversos
description: Reverso de pagos ePayco (estado 6) — ePayco no manda la confirmación del reverso; la conciliación 7d pregunta y anula el cobro; lo que queda para Mauricio
metadata:
  type: project
---

La 390720992 (cobro f5f27bbf) se aprobó y Mauricio la reversó desde el panel de ePayco el 2026-10-22: ePayco NO llamó la confirmación con el estado 6 (en `pasarela_eventos` solo -3 y -1). PR `fix/epayco-reversos` (2026-10-23, sin migración): webhook con estado 6 y paso 7d del cron (`detectarReversosEpayco`, 60 días, tope 80) que consulta y procesa con el mismo id `<ref>-6`. Al detectar: anula el cobro (campos de la anulación manual, `anulado_por` null), mira `facturas_cobro` y manda correo interno; evento en `requiere_revision`.

**Why:** cancelar la suscripción, cerrar el ciclo de Valida o recobrar la cuota es tema de Términos: Mauricio lo decide con Emilio. Por eso el cobro anulado CONSERVA `fecha` (el cron lo trata como cuota cubierta).

**How to apply:**
- La doc oficial solo trae el 6 como devolución; no hay código de «reembolso» ni de contracargo. Si aparece otro, va como `otro`/error, no anula.
- Bold (VOID_APPROVED) sigue en revisión manual a propósito (no se pidió).
- `pasarela_eventos.resultado` tiene CHECK: no hay valor «anulado»; por eso el reverso queda `requiere_revision`.
- `test/tablas-doble.ts` no aplica llaves únicas: la prueba de duplicados envuelve el insert de `pasarela_eventos`.
