---
name: equipaje-por-iconos
description: "#792 mergeado: el equipaje sale del estado del icono y la captura se AMPLÍA antes de mandarla; las dos sospechas del brief eran falsas y el error era la descripción del modelo"
metadata:
  type: project
---

**PR [#792](https://github.com/bi-metrik/metrik-one/pull/792)**, squash `efe3660f`, mergeado
el 2026-09-18. Brief: `proyectos/trappvel/clarity/docs/diseno/brief-max-2026-09-18-equipaje-por-iconos.md`.
**Sin migración y sin una sola escritura a producción.** Cierra el «lo que sigue sin
cuadrar» de [[lectura-fina-trappvel]].

## ⚠️⚠️ Un cruce NO atrapa un error que comparten las dos respuestas

Las dos sospechas del brief se midieron contra el modelo vivo **con el código de `main`**
(3 corridas de `3.57.39_PM-3`, guardadas en `viejo.json`) y **las dos eran falsas**:

- devolvió **exactamente 3 iconos**, no 6 ni 12 → el conteo nunca mató el cruce;
- devolvió **`a_color` / `a_color` / `gris`** → los tres caen en el vocabulario del
  servidor → el cruce **sí corrió**.

La causa real: **el modelo DESCRIBIÓ mal el segundo icono**. La maleta de cabina es gris
oscuro y la llamó `a_color`; su dictamen decía lo mismo, así que el cruce confirmó el error
y lo guardó con confianza 0,9.

**How to apply:** antes de creerle a un diagnóstico sobre por qué falló una lectura de
modelo, guardar la EVIDENCIA cruda y volver a medir el camino viejo. Reconstruirlo costó
una hora que el registro de QA habría ahorrado.

## ⚠️⚠️ A un icono de 20 px se le dan MÁS PÍXELES; ninguna redacción lo arregla

Gemini trocea la imagen en teselas de 768 px, así que en un pantallazo de 1600 el icono
queda diminuto. Medido, cinco corridas por configuración sobre la misma captura:

| Configuración | Aciertos |
|---|---|
| prompt con `estado` de dos valores, imagen tal como llega | 2 de 3 |
| prompt con color concreto + `estado`, imagen tal como llega | 3 de 5 |
| lo mismo, **imagen ampliada** | **5 de 5** |

`conMasPixeles` (en `extraer-ranura.ts`) amplía hasta **3.072 px de lado, tope ×2**, nunca
para PDFs, **conservando el formato** (un PNG recomprimido a JPEG mete artefactos en la
letra chica) y **devolviendo la original si `sharp` falla**. Costo: +1 a +2,5 s por llamada.
`sharp` pasó de dependencia transitiva de Next a **declarada** en `package.json`.

⚠️ **Probar redacciones hasta que el número cuadre es cómo se cuela una lectura falsa.** En
el camino se escribió en el prompt «lo normal es que el primero esté encendido y los demás
apagados» — un prior que empuja al modelo a la respuesta esperada. Se quitó antes de medir.

## Las reglas que quedaron en el lector

- `iconos_equipaje` pide **color concreto + estado**, y las dos se cruzan: «gris oscuro» +
  «encendido» deja el icono sin leer. El **tono se mira antes que el adjetivo** («azul
  oscuro» es un color, «gris oscuro» no) — el modelo devolvió las dos formas en el banco.
- La terna repetida se **colapsa por período** en el servidor.
- ⚠️ **Hueco antes que mentira:** si hay iconos y NO son una terna limpia (no son tres, o
  un estado es ambiguo), los **tres** campos quedan vacíos. Antes ahí mandaba el dictamen
  del modelo, que es el que puso los tres en `true`.
- ⚠️ **Sin fila de iconos no se toca nada:** «incluye 1 maleta de 23 kg» escrito en la
  pantalla sigue siendo un dato válido, y ahí el único que leyó es el modelo.
- El resumen dice la exclusión con todas las letras: «Solo artículo personal (sin equipaje
  de mano ni de bodega)».

## ⚠️ Pedirle TODAS las filas repetidas metió más ruido del que quitó

Se probó: la fila aparece 4 veces en esa captura y pedir todas convertiría la repetición en
un cruce. Medido, el modelo devolvió **18 iconos en 6 filas**, dos de ellas inventadas
(todas grises, para tramos sin iconos). Resultado: hueco donde había respuesta. Se volvió a
«devuelve UNA sola fila»; el colapso queda como defensa, no como mecanismo.

## Dónde quedó la QA

`proyectos/trappvel/clarity/qa/2026-09-18_equipaje-iconos/` — siete corridas y el `LEEME.md`
con la tabla. El arnés (`arnes-banco-real.test.ts.txt`) ahora registra `iconosEquipaje`
crudo. **5 corridas idénticas** de `3.57.39_PM-3` en configuración de producción.

⚠️ **Números cerrados verificados otra vez** (2 pasadas del banco completo): LATAM
**1.907.063** y **1.771.063**; Amadeus **1.283.014** y **11.337**; Decameron **1.818.919** y
**2.029.118** (margen 10,359%).

## ⚠️ Hallazgo abierto: Altos Ushuaia trae el margen servido y nadie lo toma

`4.03.08_PM` muestra el precio grande (**799.016,38**) y un globo con «Precio neto
**687.154,09**» y «Descuento (14%)». Ese neto **es lo que paga la agencia**, y hoy
`total_a_pagar_agencia` sale vacío. En **1 de 6** corridas el modelo tomó el neto como
precio del cliente. No lo introduce este PR: la ambigüedad está en la captura.

Relacionado: [[lectura-fina-trappvel]], [[tarifa-por-pasajero]], [[pantallazo-ranuras]],
[[medir-antes-de-construir]], [[pruebas-por-mutacion]].
