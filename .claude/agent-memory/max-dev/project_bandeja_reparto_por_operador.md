---
name: bandeja-reparto-por-operador
description: Viaje en bloqueo con 2+ operadores en la solicitud — la bandeja reparte por operador leído del hotel Y del vuelo (encabezado del pantallazo); 5-nov
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

Segunda vuelta (feat/bloqueo-vuelo-lee-operador, 5-nov): el vuelo YA lee `operador` (encabezado
«tureserva · Salidas en bloqueo» / «aliadostravel · Bloqueos»). Vuelo con operador de la solicitud →
todas las opciones del paquete de ese operador SIN vuelo (el de número más bajo); si no hay, abre uno con
ese operador. Paquete con otro vuelo no se pisa. Sin operador leído: paquete propio como antes. Viaje 02 = 2
paquetes en las 24 órdenes. El prompt cambiado NO se probó contra el modelo: lo prueba Mauricio en ONE.

**How to apply:** asimetría pendiente: el hotel va al paquete del operador de número MÁS ALTO y el vuelo al
sin vuelo de número MÁS BAJO; solo importa con 2+ paquetes del mismo operador. Opcionales sin hacer: «Recomendada», confirmación de «Borrar paquete»
(paquete-bloqueo.tsx), título del aviso de tarifa (`paquetesConTarifaPorElegir`).
