---
name: project-atajo-bot-anterior-roles
description: Con rol activo del asistente, «gasto …»/«bot …» ya no caen al bot anterior (que atiende por cargo operator); cerrado 30-oct
metadata:
  type: project
---

El bot anterior (wa-parse + OPERATOR_ALLOWED_INTENTS) atiende por CARGO (`operator` registra gastos y actividades), no por el rol del asistente. Hasta el 30-oct, una asesora de Trappvel (rol sin plata) que escribía «gasto …» era soltada por `atenderConRolDeViajes` y la bandeja la mandaba al bot anterior por el prefijo. Mauricio: «cierra el atajo».

Ahora, con un rol activo en la bandeja, el agente atiende «gasto …» y «bot …» con ese rol (si no tiene la función, responde su alcance: `alc.plata`). Sin modelo: el prefijo recibe RF_ROL_NO_LEIDO; lo demás sigue a la bandeja como antes. Sin roles (turno `hoy`): igual que antes.

**Why:** cualquier `return false` del agente con rol deja al webhook seguir a la bandeja y de ahí al bot anterior con los permisos del cargo.
**How to apply:** al tocar wa-agente, no agregar `return false` en el camino con rol para mensajes con prefijo del bot. Abierto: el dominio ONE (`atenderConAgenteOne`) con rol aún cae al bot de siempre si el núcleo falla (catch / sin modelo). Tests: `_shared/wa-agente-atajo-roles.test.ts`.
