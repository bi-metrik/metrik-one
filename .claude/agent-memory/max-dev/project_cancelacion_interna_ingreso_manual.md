---
name: project-cancelacion-interna-ingreso-manual
description: Trappvel 2026-09-28 — #949 la cancelación leída ya no sale al cliente; PR 2 ingreso manual (hotel por habitación, traslado) que produce la MISMA lectura que una captura; nada visto en pantalla
metadata:
  type: project
---

**#949** (squash `46470b21`): la cancelación leída de la captura es condición proveedor→agencia.
Salió de `textosDeTarjetaHotel` (PDF y «Así lo ve el cliente», los tres niveles) y de la
descripción impresa en días y opcionales (`sinCancelacionDelProveedor`, quita el segmento
«Cancelación: …» que escribe `resumenDeLinea`). Sigue en la ficha interna. `fichaDeOpcion` y
`resumenDeOpcion` son texto INTERNO de la tarjeta (el brief los creía del cliente).

**PR 2 (ingreso manual)**: `src/lib/cotizaciones/ingreso-manual.ts` arma una `LecturaCruda` con
los slugs de la ranura, la pasa por `evaluarLectura(…, { manual: true })` +
`construirLecturaCasilla`, y entra por bandeja → Aceptar (ruta `lectura-manual`, firma igual).

**Why:** Mauricio pidió una sola lógica: R8, tarifa por pasajero, margen, IVA y documento sin
segunda vía. Alejandra armaba «pantallazos» en Excel por habitación.

**How to apply:**
- ⚠️ `aPagarAgencia` queda `null` A PROPÓSITO: el neto escrito es el `total`. Ponerlo en
  `aPagarAgencia` daría margen del proveedor 0 %. El margen lo pone la cotización.
- La fuente vive en `lectura.manual.fuente`, NUNCA en el campo `proveedor`: en un traslado
  leído, «Proveedor: X» va a la descripción y el PDF la imprime (hueco reportado, sin tocar).
- `manual: true` apaga los avisos «La captura no muestra: …» y el de impuestos no declarados.
- Tarifa niño y «Incluye» van por `HotelPDF.edadNino/incluye` (de `datosManuales`); la tarifa
  niño sale en los tres niveles.
- `retencion.test.ts` salta con «N años» en comentarios de código (no en tests): reescribir.
- Solo COP. Nada se vio en pantalla: formulario, fila «A mano» y tarjeta solo por render estático.

Relacionado: [[project-habitaciones-hotel-r8]], [[project-bandeja-borrador-firmado]],
[[margen-por-item-proveedor]], [[project-tarjeta-opcion-trappvel]].
