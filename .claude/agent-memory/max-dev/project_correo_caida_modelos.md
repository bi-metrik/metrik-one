---
name: project-correo-caida-modelos
description: Correo inmediato si caen los modelos de los asistentes (§4.1, rama feat/asistentes-correo-caida); qué cuenta como caída, candados, y avisos de cupo/presupuesto pasados a correo
metadata:
  type: project
---

Pieza §4.1 de la spec de asistentes (26-oct), sin migración. `_shared/agente/caida.ts` + `enviarCorreoInterno` en `_shared/correo-interno.ts` (Resend, `RESEND_API_KEY`, nunca lanza).

- **Caída = ningún modelo contestó en el llamado que falló.** `refusal` y «sin llamada (…)» NO cuentan (el proveedor está arriba). Se lee la cola de `traza.uso` después del último `ok:true`, sin los «cancelado: …» del perdedor de un llamado anterior. En público, `falla: corte_total` sin usos también cuenta.
- **Candados:** `agente:caido:<ws>:<ventana30>` + mirar la ventana anterior (si estaba tomada, el incidente sigue) + `agente:caido:<ws>:recordatorio` de 1 h. Si Resend falla se sueltan para reintentar; un 409 de Resend cuenta como enviado.
- `despuesDelTurno` del núcleo ahora recibe `(traza, { turnoId })`; público tiene `alertaCaida(traza, turnoId)` junto a `avisos` (al final de `DepsPublico` chocaba con #1285).
- Conversación de WhatsApp por alias `wa-<10 hex de sha256(ws:phone)>`; la traza se ubica por `turno_id`.
- El asunto lee `traza.rol.clave` sin tipo: cuando entra #1285 el rol aparece solo.
- Aviso del cupo y del presupuesto diario: por correo, ya no dependen de `WA_ADMIN_NOTIFY_PHONE`.

**Why:** el 9-oct cayeron principal y respaldo sin que nadie se enterara; Sabor sale el 29-oct sin respaldo (persona en Chatwoot).
**How to apply:** al tocar el adaptador de un modelo, mantener los motivos `http NNN`, `corte`, `red:` para caídas y `refusal`/`sin llamada` para respuestas; un motivo nuevo de «contestó mal» hay que agregarlo a `respondio()`.
