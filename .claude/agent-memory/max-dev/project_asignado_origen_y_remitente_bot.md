---
name: asignado-origen-y-remitente-bot
description: wa_identify_user sin user_id dejaba al remitente del bot sin staff en todo workspace; asignado_origen + asignado_etapa_id (20261026090000 APLICADA 2026-10-26, con ledger)
metadata:
  type: project
---

Hasta el 2026-10-26 el bot de WhatsApp NUNCA identificó al staff que escribe: `wa_identify_user` no devuelve
`user_id` y `wa-identificar.ts` lo leía de ahí. `staffIdDelRemitente` daba null en todos los workspaces. Arreglado
resolviendo el staff por `phone_whatsapp` (rama feat/trappvel-asignado-por-y-panel-solicitud).

**Why:** todo lo que dependía del remitente estaba apagado en producción sin que nadie lo viera (gastos sin
`created_by`, timeline sin autor, «Quien te escribe no es del equipo comercial» en el prompt del agente, viajes del
bot sin `assigned_by`). Al encenderlo cambian comportamientos ya «probados» con null: ver la lista en el PR.

**How to apply:**
- La migración 20261026090000 (asignado_origen + asignado_etapa_id + trigger) ya está APLICADA (2026-10-26); iba ANTES del merge y del deploy de
  wa-webhook: el upsert de `asignarResponsableCon` escribe las columnas y sin ellas el responsable no queda.
- `asignado_etapa_id` no estaba en el brief (solo `asignado_origen`): se agregó para nombrar la etapa en el detalle.
- El rol del remitente sigue roto (la RPC no lo devuelve): todo staff no principal = operator. No se tocó.
- Los dobles de RPC deben copiar la forma de `src/types/database.ts` ([[feedback-doble-hace-cumplir-llaves]]).
