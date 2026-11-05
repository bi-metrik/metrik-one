---
name: bandeja-reparto-por-operador
description: Viaje en bloqueo con 2+ operadores en la solicitud — la bandeja reparte por operador leído del hotel; el vuelo abre su propio paquete (5-nov)
metadata:
  type: project
---

Desde fix/bandeja-bloqueo-reparto-por-operador (QA Trappvel 2026-11-05, viaje 02): `planDelPegado`
(bloqueo-armado.ts) tiene dos reglas. Con 0-1 operadores en la solicitud, la del «paquete vigente» de
siempre (SAN ANDRÉS). Con 2+ (`ctx.operadoresSolicitud`), `planConVariosOperadores`: hotel con operador
leído (validado con `operadorDeLaLectura`) va al paquete de ese operador; sin operador, paquete propio;
un vuelo SIEMPRE abre paquete propio (la lectura del vuelo no trae operador). Viaje 02 da 4 paquetes.

**Why:** el orden de llegada de la detección juntaba Decameron (Aliados) con el vuelo de Avianca (Tu Reserva).
El brief pidió no adivinar: mejor paquetes separados que la asesora junta.

**How to apply:** el siguiente paso natural es leer `operador` también en el pantallazo del VUELO
(PROMPT/ESQUEMA_VUELO_BLOQUEO) para juntar vuelo + hotel solos; eso cambia el prompt y pide arnés real
(lo corre Mauricio). Opcionales sin hacer: «Recomendada», confirmación de «Borrar paquete»
(paquete-bloqueo.tsx), título del aviso de tarifa (`paquetesConTarifaPorElegir`).
