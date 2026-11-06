---
name: bandeja-reparto-por-operador
description: Viaje en bloqueo — paquetes repartidos por operador (2+ operadores) y desde 5-nov TODOS en una sola ranura compitiendo como opciones; paquete = mismo operador + mismo vuelo
metadata:
  type: project
---

`planDelPegado` (bloqueo-armado.ts) tiene dos reglas. Con 0-1 operadores en la solicitud, la del «paquete
vigente» (SAN ANDRÉS). Con 2+ (`ctx.operadoresSolicitud`), `planConVariosOperadores`: hotel y vuelo con
operador leído van al paquete de ese operador; sin operador, paquete propio (#1430, #1431).

**Desde fix/bloqueo-paquetes-compiten-como-opciones (5-nov, reprueba del viaje 02):** un paquete nuevo NO abre
ranura: `nuevo_paquete.grupo` = la ranura del bloqueo que ya existe (solo el primero la abre). Dentro de la
ranura, un PAQUETE es derivado, no guardado: `paquetesDelBloqueo` agrupa opciones por (grupo, operador, vuelo);
una opción sin `paquete` (recién creada) va al último paquete de su ranura. `elegirTarifaDelPaquete` y
`paquetesConTarifaPorElegir` usan esa agrupación. Aplica también a UN operador con otro vuelo.

**Why:** cada ranura de 1 opción es «fija» en `itemsDelItinerario`: dos ranuras de paquete = una sola tarifa
que suma A + B. D5 (`planDeTarifasDeBloqueo`) solo mira la PRIMERA ranura de paquete. Un bloqueo es un viaje.

**How to apply:** cotizaciones viejas con 2 ranuras de paquete siguen sumando (no hay barrido de datos): la
asesora usa «Juntar como opción de…». Dos hoteles sin operador ni vuelo (varios operadores) quedan como UN
paquete derivado (comparten la pregunta solo si las dos siguen abiertas). La Recomendada = primera opción por
orden (D5), no la más barata. Pendiente natural: leer operador en el vuelo ya está (#1431).
