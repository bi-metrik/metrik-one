---
name: project-activar-plan-whatsapp-temporal
description: «Activar plan» de Valida — #1160 lo mandó a WhatsApp por un 404; la pila #1104→#1107 lo devuelve a /valida/activar y deja el WhatsApp solo como respaldo con la activación cerrada
metadata:
  type: project
---

#1160 (2026-10-14, d1f39037) hizo que «Activar plan» abriera wa.me/573159509103 porque `/suscripcion` da 404
a un espacio de la prueba (sin contrato) y `/valida/activar` aún no estaba en main.

Resolución en la pila (merge de main del 2026-10-14, sin force):
- #1104: `accionDelCorte(esPrueba, espacio)` sigue mandando la prueba al WhatsApp (en #1104 no existe
  `/valida/activar`; si #1104 entra solo a main no vuelve el 404).
- #1107: `accionDelCorte(esPrueba)` → `RUTA_ACTIVAR_PLAN = '/valida/activar'`; se retiró la prop `espacio` de
  page.tsx/valida-client.tsx. `enlaceActivarPlan(razon_social)` queda SOLO en `/valida/activar` cuando
  `activacionAbierta()` es falso (VALIDA_ACTIVACION_ABIERTA apagada), junto al correo.

**Why:** Mauricio quiere que activar genere el cobro con la tarjeta registrada, no un chat.

**How to apply:** con tarjeta registrada (`valida_registros.cobro_estado`), el botón NO cobra al clic:
responde `cobro_al_terminar_prueba` y el cobro sale al día 7 por el cron `valida-cobro-prueba` (Términos
3.5/16.6 «nunca antes»). Si Mauricio pide cobro al clic, es cambio de Términos (Emilio/Vera), no de código.
Ver [[project-valida-alta-autogestionada]].
