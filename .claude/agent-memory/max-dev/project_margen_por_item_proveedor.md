---
name: margen-por-item-proveedor
description: "#794: el neto LEÍDO manda y la comisión solo rellena (cruzar contra el neto le quitaría el margen a Decameron); cuarto OrigenMargen; el número de la captura se guarda SIEMPRE y por eso retirar un margen se decide comparando, no por la marca"
metadata:
  type: project
---

**PR [#794](https://github.com/bi-metrik/metrik-one/pull/794)** — brief
`proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-19-margen-por-item.md`.
**Sin migración y sin una sola escritura a producción:** lo que había que guardar ya vive en
`items.tarifa_pax` (jsonb). Sigue a [[lectura-fina-trappvel]] (#784) y
[[tarifa-por-pasajero]] (#763).

## ⚠️⚠️ El neto ESCRITO manda; cruzarlo contra la comisión le quita el margen a Decameron

`src/lib/cotizaciones/costo-agencia.ts` (puro). El brief pedía derivar el neto de la
comisión «y validarlo contra la resta: si los dos caminos no dan lo mismo, no se escribe
margen». Aplicado contra el neto leído eso **rompe el único caso que hoy funciona**, y está
medido: Decameron trae las tres cifras —neto 1.818.919, comisión 187.288 y 9,23%— y
`2.029.118 − 187.288 = 1.841.830`, que **no** es el neto (faltan 22.911 sin concepto, el
hallazgo 7.1).

La regla que quedó, y el orden importa:

1. **Neto escrito → es el costo.** Leído, nunca recalculado.
2. **Sin neto, la comisión lo deriva.** Manda la de PLATA; el porcentaje viene redondeado en
   pantalla y arrastraría ese redondeo al costo.
3. **El cruce se aplica entre las dos formas de la MISMA comisión** (plata contra
   porcentaje), con tolerancia `max(1, 1% de la comisión)` — «14%» sobre 799.016,38 da
   111.862,2932 contra los 111.862,29 impresos, y con igualdad exacta se abstendría sobre
   una captura que dice la verdad.

**Abstenerse nunca es regresión:** la línea queda heredando el margen de la cotización, que
es el comportamiento de siempre. El motivo viaja en `LecturaCasilla.alertas`.

## ⚠️ Guardar el número SIEMPRE cambia quién puede retirarlo

`confirmada.margenProveedor` antes se descartaba si la línea tenía `precio_manual`. Ahora se
guarda siempre (la condición dura del brief: lo que dijo la captura no se pierde). Efecto
colateral que hubo que cerrar: `loPusoUnaCaptura` miraba **la existencia** de esa marca para
decidir si una captura nueva de un solo precio retira el margen. Con la marca siempre
presente, eso le habría borrado a una persona su decisión. Ahora se decide **comparando el
número escrito** contra el de la captura, con el mismo `origenDelMargen` que usa la
pantalla. `ItemLeido` ganó `margenPorcentaje` para poder preguntarlo.

## Las dos puertas escriben el MISMO campo

`margenParaPrecio` (`precio-item.ts`) es la inversa de `precioConMargen`. La casilla «Precio
al cliente» del editor despeja el margen contra `costoDeVentaLinea` (el costo CON su parte
de administrativos, que es contra lo que la cascada aplica el margen) y escribe
`margen_porcentaje`. **Se descartó `precio_manual`:** así la línea deja de reaccionar a un
cambio de costo y el margen mostrado queda al día con un precio que ya no le corresponde.

`OrigenMargen` gana `'proveedor'` («lo trae el pantallazo»), separado de `'propio'` con
`MISMO_MARGEN = 0.005` — la casilla tiene `step="0.01"`, así que toda edición real se ve y
el ruido de coma flotante del `numeric` no.

## Medido contra el banco real (4 pasadas completas + 18 de Ushuaia)

`proyectos/trappvel/clarity/qa/2026-09-19_margen-por-item/`.

- **Ushuaia `4.03.08_PM`:** `total_a_pagar_agencia` era **null en 6 de 6** corridas de la
  línea base y es **687.154,09 en 18 de 18**. Margen **14,000%**, costo por adulto
  343.577,05 (antes 399.508,19, o sea el precio al público).
- **La ambigüedad del brief se cierra:** en la línea base una pasada leyó el neto **como si
  fuera el precio** (`total = 687.154,09`). Con dos casillas descritas, `precio_total` fue
  799.016,38 en las 18.
- **9 de 10 capturas idénticas** a la línea base, campo por campo. Números cerrados
  intactos: LATAM 1.907.063 / 1.771.063 · Amadeus 1.283.014 / 11.337 · Decameron 1.818.919 y
  10,3591%.

## ⚠️ `base_precio` se cae solo a veces, y es PRE-EXISTENTE

En capturas de hotel el modelo lo deja en `null` y RX2 rechaza pidiendo captura nueva.
Medido: **1 de 32** lecturas de hotel con el prompt de `main`, **2 de 46** con el de este PR
(3,1% contra 4,3%). El modo de fallo es el seguro — no deja entrar un número equivocado.

Aun así `base_precio` se movió para quedar **pegado a `precio_total`** en las cuatro ranuras
(antes quedaba detrás de los tres campos nuevos): es el campo que dice qué representa ese
precio. Tras el reorden, Ushuaia dio **8 de 8** aceptadas e idénticas.

**How to apply:** antes de culpar a un cambio de prompt por una inestabilidad, contar la
tasa en las corridas VIEJAS. Aquí la conclusión fácil («lo rompí yo») era falsa y se
descartó con dos conteos.

Relacionado: [[lectura-fina-trappvel]], [[tarifa-por-pasajero]], [[pantallazo-ranuras]],
[[margen-visible-trappvel]], [[pruebas-por-mutacion]], [[medir-antes-de-construir]],
[[cifras-del-brief-caducan]].
