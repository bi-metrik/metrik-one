---
name: bandeja-wa-solicitudes
description: Bandeja de solicitudes por WhatsApp para Trappvel (2026-09-25) — llave modules.bandeja_solicitudes_wa, dos migraciones SIN aplicar con orden estricto, y las decisiones que el brief pidio justificar
metadata:
  type: project
---

PR `feat/trappvel-bandeja-wa-solicitud` (2026-09-25), SIN mergear: trae migración. Lo que un
comercial reenvía al bot queda completo en `wa_bandeja_mensajes`, agrupado en `wa_bandeja_entregas`.

**Why:** Trappvel deja Airtable; esta es la materia prima del paso de entendimiento (siguiente
encargo). Ver [[wa-bot-sin-bandeja-trappvel]] para por qué el bot no servía tal cual.

**How to apply:**
- Orden: `20260925200000` (tablas + RPC) → deploy `wa-webhook` y `wa-alerts` → `20260925200100`
  (cron cada minuto, solo llama si hay entregas abiertas). Encender la llave es lo ÚLTIMO y lo
  bloquea la autorización de datos de Emilio.
- Llave de FUNCIÓN de Clarity en `workspaces.modules` (no módulo): `catalogo.test.ts` exige
  clasificarla, ya está en `MODULOS.clarity.funciones`.
- No es `contacto_interacciones`: exige `contacto_id NOT NULL` y alimenta la atribución de marketing.
- Agrupar y deduplicar vive en SQL (candado por remitente + índice único parcial de «abierta»),
  probado con PGlite en `src/lib/bandeja-wa/bandeja-sql.test.ts`.
- Coexistencia con gastos: reenvío → bandeja siempre; gasto a medias o texto «gasto …» → bot.
- La respuesta a «¿De qué cliente es?» = primer escrito/audio NO reenviado en 24 h sin entrega
  abierta. Sin esto, la respuesta abría otra entrega y volvía a preguntar (bucle).
- Sin verificar: nombre `WA_ALERTS_SECRET` en el vault; si `wa_identify_user.user_id` es perfil o
  staff (la función no está en el repo; se buscan las dos). `document`/`video`/`sticker` siguen
  descartándose antes de `processMessage` (un PDF reenviado se pierde).
