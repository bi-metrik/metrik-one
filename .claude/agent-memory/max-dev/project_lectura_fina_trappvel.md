---
name: lectura-fina-trappvel
description: "#784: escala con ciudad, equipaje por el icono resaltado (con cruce de dos respuestas del modelo) y el margen que pone el pantallazo de Decameron; lo que sigue sin cuadrar contra los píxeles"
metadata:
  type: project
---

**PR [#784](https://github.com/bi-metrik/metrik-one/pull/784)** — Entrega A del brief
`proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-17-documento-cliente.md`.
**Sin migración y sin una sola escritura a producción.** Sigue a [[tarifa-por-pasajero]]
(#763) y [[trappvel-pantalla-cotizacion]] (#777).

**Why:** los tres defectos que Alejandra y Daniela chocaron en vivo el 2026-09-16
cotizando de verdad. La Entrega B (documento del cliente y banco de fotos por ciudad)
**no** entró y sigue abierta.

## ⚠️⚠️ El juicio del modelo sobre una IMAGEN no es estable; su descripción lo es más

Medido sobre la MISMA captura (`capturas-proveedor/2026-09-16/3.57.39_PM-3.jpeg`, tarifa
BASIC de Avianca por Amadeus), preguntando directo «¿incluye equipaje de bodega?»:
**`false` en una corrida y `true` en la siguiente, las dos con confianza 0,9**. Contado
por píxeles, de los tres iconos **solo el primero está a color**.

El arreglo es la técnica que ya estabilizó RX1 (`opciones_vistas`): pedir la EVIDENCIA
(`iconos_equipaje`: dibujo y color, en orden) y **cruzarla contra el dictamen del propio
modelo en la misma llamada**. Coinciden → se guarda; se contradicen → **el campo queda
vacío**. Con el cruce: 3 de 3 corridas idénticas en las tres capturas de vuelo.
Vive en `derivarEquipajeDeLosIconos` (`src/lib/ai/extraer-ranura.ts`).

⚠️ **Solo se cruza con EXACTAMENTE tres iconos.** Con uno o dos la posición no dice cuál
es cuál y manda lo que respondió el modelo.

⚠️ **Lo que sigue sin cuadrar:** en la BASIC, `equipaje_mano` sale `true` y el segundo
icono es gris. Las dos respuestas del modelo coinciden ahí, así que el cruce no lo
atrapa. Cumple el criterio literal del brief y contradice a Alejandra («solo lleva
mochila»). `equipaje_bodega`, que era el defecto reportado, sí quedó en `false` y estable.

**How to apply:** para leer un ESTADO VISUAL de una imagen (color, resaltado, tachado),
no preguntar por la conclusión: pedir la descripción y cruzarla. Y contar los píxeles
antes de creerle a cualquiera de las dos.

## El margen que ya trae el pantallazo (Decameron)

`src/lib/cotizaciones/margen-proveedor.ts` (puro). Cuando la captura muestra **lo que
paga el cliente** y **lo que paga la agencia**, el margen está dado: se escribe en
`items.margen_porcentaje` al confirmar, **con la convención de la cotización**.

Números reales: costo 1.818.919, precio 2.029.118 → **10,359%**, y `precioConMargen`
devuelve 2.029.118 **al peso**. Por encima del piso de 5%: el gate no frena.

- ⚠️ **La convención importa y no es cosmética:** `sobre_venta` escribe 10,359 y `markup`
  escribe 11,556. Cruzarlas vende la línea **21.775 pesos por debajo** de lo que el
  proveedor le cobra al pasajero, y nada en pantalla lo delata.
- ⚠️ **Un peso de diferencia NO es comisión** (`DIFERENCIA_MINIMA`): tomarlo dejaría la
  línea al 0,00005% y haría saltar el gate de piso por un error de lectura.
- ⚠️ **Re-leer con una captura de un solo precio RETIRA el margen** que puso la anterior.
  Por eso `TarifaConfirmada.margenProveedor` se guarda: es lo único que distingue «lo
  puso una captura» de «lo puso una persona». Con `precio_manual` no se toca nada.

## El equipaje comprado aparte («+ Otro») YA llegaba al documento

No hizo falta código. **Lo que lo sostiene:** una línea con `grupo` en `null` no puede ser
«sugerida» (`puedeSerSugerido` exige grupo declarado), así que no cae en «actividades
adicionales no incluidas» — la sección de lo que el cliente NO compra. Prueba en
`src/lib/pdf/cotizacion-otro-en-documento.test.ts`, que lee el binario del PDF.

## Escala

`escala_ida` y `escala_regreso` en la ranura de vuelo. La escala **casi nunca está escrita
como tal**: en el banco real la ida son dos filas (`Cúcuta CUC → Bogotá BOG` y `Bogotá BOG
→ Armenia AXM`). La instrucción describe el PATRÓN, no una etiqueta. El regreso que no se
leyó **no** sale como «regreso directo».

## Dónde quedó la QA y los números cerrados

`proyectos/trappvel/clarity/qa/2026-09-17_lectura-fina/` — arnés y las cinco corridas.
Números que no se pueden mover: LATAM adulto **1.907.063** y niño **1.771.063**; Amadeus
2 adultos **1.283.014** e infante **11.337**; Decameron a pagar agencia **1.818.919**.

⚠️ **Inestabilidades vivas, medidas:** `4.06.11_PM` (Bedsonline Cancún) fue aceptada en
una corrida y **rechazada por RX1** en otra. Y en **2 de 8** corridas de `4.01.10_PM` el
modelo inventó un `fecha_regreso` igual a la salida sobre una captura de solo ida
(anterior a este PR, sin tocar).

Relacionado: [[tarifa-por-pasajero]], [[pantallazo-ranuras]], [[trappvel-pantalla-cotizacion]],
[[margen-visible-trappvel]], [[pruebas-por-mutacion]], [[medir-antes-de-construir]].
