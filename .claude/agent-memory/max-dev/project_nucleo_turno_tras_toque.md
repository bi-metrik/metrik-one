---
name: nucleo-turno-tras-toque
description: Núcleo conversacional (bandeja WA Trappvel) — tras crear un cliente el modelo tiene un turno (seguirTrasToque); la traza es tipo modelo por el cupo; viaje_nuevo lleva `desde` porque el pedido de un turno anterior no llegaba a la extracción
metadata:
  type: project
---

Desde fix/agente-sigue-tras-crear-cliente (2026-10-08): `trasEjecutar` puede devolver `seguir: true` y la cola corre
`seguirTrasToque` (un turno del modelo con el hecho en el estado y la herramienta `terminar`, que solo existe ahí).
Hoy solo lo pide `crear_cliente`.

**Why:** en vivo (Tatiana, 2026-10-07) el toque «Crear» cerraba el flujo y la solicitud quedaba sin viaje. Mauricio
exige que el MODELO decida si hay algo pendiente (nada de reglas sobre el texto).

**How to apply:**
- La traza de ese turno es `tipo: 'modelo'` (no `toque_propuesta`): `bot_uso_mes` solo suma trazas `modelo`, así que
  con otro tipo los tokens no se cobran. El origen queda en `tras_toque.origen`; quien analice trazas de toques debe
  mirar también `ejecucion` en trazas `modelo`.
- `escritosDelViaje` arranca el tramo de un viaje nuevo en el INICIO DEL TURNO que lo propuso: lo que el comercial dijo
  en turnos anteriores (el pedido antes de dar el cliente) se perdía. `viaje_nuevo.datos.desde` (#n, validado como
  escrito del equipo, guardado como `desdeFila`) lo corrige; sin `desde` el comportamiento es el de antes.
- Si el turno que sigue falla, sale solo la confirmación: nunca `rf.modelo_caido` después de un hecho.
- Relacionado: [[bandeja-hibrida]], [[bot-interpreta-modelo-no-reglas]].
