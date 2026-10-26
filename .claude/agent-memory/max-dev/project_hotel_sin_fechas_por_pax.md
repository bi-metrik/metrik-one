---
name: hotel-sin-fechas-por-pax
description: COT-2026-0004 (Trappvel, 23-oct) — pantallazos 2A y 2A+1N del mismo hotel sin fechas quedaban sueltos; R8 exigía fechas LEÍDAS; fix sin migración en fix/agrupar-pantallazos-hotel-por-pax; datos se rehacen re-pegando
metadata:
  type: project
---

Las fechas «del viaje» (7.4, `lectura-pantallazo.ts`) van a `campos` con «(del viaje)» pero NO a `identidad`
(`lectura-casilla.ts`: `delItem` ⇒ null). Todo lo que compare por `claveOpcionHotel` ve esas capturas sin fechas.
Desde el fix (26-oct): `mismaOpcionHotel` decide por hotel y las fechas solo separan si las dos se leyeron;
`esPar` acepta el par único cuando la de solo adultos es `referencia` (tipo de habitación en otro idioma);
`lugaresDeHotelCompatibles` compara «zona / ciudad» por partes, sin países grandes.

**Why:** Alejandra lo reportó como regresión; no hubo commit culpable: cambió la entrada (tarjetas sin fechas,
lector posiblemente Haiku desde #1217, sin poder verificarlo sin las imágenes).

**How to apply:** el subagente puede leer prod por PostgREST GET con la service key (fetch propio, solo GET) para ver
`items.tarifa_pax`; sin MCP. Relacionado: [[cotizacion-reverificacion-d]], [[migracion-haiku-55]].
