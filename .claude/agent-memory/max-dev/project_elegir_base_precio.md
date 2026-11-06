---
name: elegir-base-precio
description: Bandeja pregunta «¿es el total o por persona?» cuando solo falta base_precio fuera del hotel (Trappvel, 6-nov); lecturas firmadas por respuesta, sin re-llamar al modelo
metadata:
  type: project
---

Fuera del hotel (vuelo GDS, traslado, actividad, tren, otro) un RX2 donde SOLO falta `base_precio` ya no
rechaza: la ruta `leer-captura` devuelve `eleccionBase` con una lectura FIRMADA por cada valor del enum, y la
fila (`fase: 'eligiendo_base'`) solo toma la elegida (`elegirBasePrecio`). Con 1 pasajero se toma total sin
preguntar. Hotel sigue con #1441 (total con aviso). Rama fix/elegir-base-precio, 6-nov.

**Why:** Mauricio (6-nov): en vuelos NO suponer total (cotizar a la mitad); cada llamada al modelo gasta cuota
de producción, así que elegir no puede volver a leer.

**How to apply:** el patrón «juzgar la misma cruda con cada respuesta y firmar N lecturas» sirve para otras
preguntas sin re-lectura. Gotcha encontrado: `por_pax` sin `pax` en la captura multiplicaba ×1 (el
`multiplicador` usa `pax`); ahora va por los pasajeros de la línea como `por_persona`. En el doble de igualdad,
`confirmarTarifaPorPasajero` tras `aceptar-captura` falla con «Falta decir a cuántos pasajeros» (el item no trae
negocio): verificar la casilla guardada en `tarifa_pax`, no el confirmado. Ver [[hotel-precio-sin-base]].
