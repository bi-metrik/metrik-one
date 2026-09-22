---
name: tres-tarifas-y-tabla-de-vuelos
description: "#815 en producción — la plantilla de Trappvel recibía `itinerarios` y no lo consumía; la tabla de vuelos NO tenía canal entre columnas; `minPresenceAhead` no funciona en el PRIMER hijo de un contenedor"
metadata:
  type: project
---

**PR [#815](https://github.com/bi-metrik/metrik-one/pull/815)** — squash `eac8c637`, los
cuatro checks obligatorios verdes, **desplegado a producción** (Vercel `success`
2026-09-22T18:15:00Z). **Sin migración y sin una sola escritura a producción.** Sigue a
[[documento-cliente-trappvel]] (#800) y [[horas-de-vuelo-trappvel]] (#812).

La plantilla ya estaba encendida (`cotizacion_template_slug = 'trappvel'`), así que **esto
ya lo ve el cliente**.

## ⚠️⚠️ Encender una plantilla propia PIERDE lo que la genérica ya resolvía

`cotizacion-trappvel-pdf.tsx` recibía `itinerarios` desde que existe y **no lo consumía**:
la palabra aparecía dos veces en el archivo y las dos eran comentarios. Antes del SQL del
21-sep una cotización de Trappvel salía con la **genérica**, que sí imprime las tres
tarifas (R7). **El documento recibía tres tarifas armadas y mostraba UNA.**

**How to apply:** al encender una plantilla propia para un workspace, enumerar qué props
consume la genérica y cuáles ignora la nueva. Una prop que no se consume no falla: el
documento sale bien y le falta una sección. Lo mismo aplicaría a `dias` y `sugeridos`.

## ⚠️⚠️ `minPresenceAhead` NO funciona en el PRIMER hijo de su contenedor

Era la causa de que «INVERSIÓN» quedara sola al pie de una página con su tabla en la
siguiente. En `@react-pdf/layout`, `shouldBreak` exige
`breakingImprovesPresence = previousElements.length > 0`: asume que el primer hijo ya está
arriba de la página. Cuando el contenedor arrancó a mitad de página eso es falso, y el
título se queda huérfano.

Y la otra mitad: `minPresenceAhead` solo entra en la rama `!shouldSplit`, o sea que **en un
contenedor alto que se parte tampoco sirve**. Tiene que ir en un nodo que quepa entero.

**El arreglo:** los títulos salen a **hermanos** del envoltorio de página con un
`Fragment` (`createInstances` los aplana, verificado en el código de la librería). Así
tienen hermanos previos y caben solos.

**How to apply:** `minPresenceAhead` pide dos condiciones a la vez — el nodo cabe entero
**y** tiene al menos un hermano antes. Si alguna falla, no hace nada y no avisa.

## ⚠️ La tabla no tenía canal entre columnas, y por eso la ruta tocaba la fecha

El brief lo reportó como desborde. Medido con las métricas de Helvetica: los anchos se
reparten al 100%, así que la caja de una columna **termina donde empieza el texto de la
siguiente**. Con las siete columnas la RUTA tenía **120,3 pt** y
«San Andrés ADZ – Providencia PVA» mide **120,2 pt**: cabía y quedaba pegada.

Se arregló por los dos lados y **las dos cosas hacen falta**: quitar DURACIÓN sube la RUTA
a 138 pt y resuelve ESE caso; el `paddingRight` de 6 pt resuelve la FAMILIA, porque
cualquier ruta que use su columna completa vuelve a tocar a la vecina.

## La referencia manda sobre el diseño escrito de memoria

El itinerario real (`Itinerario_Viaje_Cancun_Ligia_Sanchez.pdf`) tiene **CINCO** columnas:
AEROLÍNEA, RUTA, FECHA, SALIDA, LLEGADA. La §2 de `propuesta-visual.md` decía que traía
DURACIÓN y número de vuelo: **estaba escrita de memoria el 17-sep**. Las dos salieron.

- **ESCALA se queda** aunque no esté en la referencia: §4.1 la pide con nombre propio
  (*«si la escala es en Bogotá o en Panamá»*).
- El **número de vuelo sigue en la plataforma** (`resumenDeLinea`); lo que se retiró es el
  documento del cliente.
- La **duración salió también de la ranura**: nada más la consumía —ni siquiera
  `resumenDeLinea`— así que era trabajo que se le pedía al modelo en cada lectura sin que
  nadie lo viera. Caduca la mitad de [[horas-de-vuelo-trappvel]] que hablaba de la columna
  DURACIÓN; lo que sigue vigente es **por qué no se calcula**.

## El precio por pasajero ahora RECONCILIA contra el total

Se imprimían como dos hechos sueltos y nada comprobaba que el uno explicara al otro: en la
prueba real de Providencia la suma por pasajero quedaba **360.000 por debajo** del total, y
eran los adicionales — `precioPorPasajeroDeItem` reparte `items.precio_venta`, que es el
precio **BASE**, y `valorAdicionales` nunca entró al reparto.

`preciosPorPasajeroDelViaje` devuelve `cubierto`; la plantilla publica `total − cubierto`
**con nombre**. Cierra por construcción **porque sale de restar, no de volver a sumar**.

- ⚠️ `cubierto` es `null` si las líneas **no coinciden** en cuántos viajan (un vuelo para 6
  y un hotel para 4): multiplicar por cualquiera daría un subtotal que no es de nadie, y
  entonces el documento **lo dice** en vez de sugerir que la columna suma.
- ⚠️ La diferencia **no se reparte** entre los viajeros: una maleta la compra alguien
  concreto y prorratearla inventaría quién paga qué.
- ⚠️ `Adulto ×6 … $1.170.000` se lee igual de bien como «seis adultos cuestan 1.170.000».
  Van el unitario («c/u») y el subtotal separados, y la columna derecha **suma el TOTAL**.

## Método

- **Radio del cambio de prompt** por md5 de `construirPrompt()` **con control**: hotel,
  actividad y traslado byte a byte idénticos a `origin/main`; solo vuelo difiere, y su
  diff son **las dos líneas de la duración y nada más**. Como las instrucciones de
  `hora_salida`/`hora_llegada` no cambian un carácter, el **18/18** del #812 sigue valiendo
  **sin re-medir contra las capturas**.
- **R6 byte a byte**: genérica y Termotech idénticas a `origin/main` pasándoles **también**
  las props nuevas, con el control de que sin normalizar SÍ difieren.
- **Tres mutaciones vistas en rojo**: plantilla ignorando `itinerarios` (4 rojas), sin
  reconciliación (2), con DURACIÓN de vuelta (5).
- Artefactos: `proyectos/trappvel/clarity/qa/2026-09-22_formato-del-documento/`.

## Lo que quedó fuera, y por qué

- **Estrellas del hotel**: SÍ están en la referencia (`★★★★★` y «Categoría 5 estrellas») y
  siguen sin leerse en ninguna ranura. Hueco confirmado, no inventado.
- **Fotos y portada ilustrada**: la referencia se construye alrededor de fotos y sin el
  banco el documento no se le va a parecer del todo. Bloqueado por quién aprueba una foto.
- **Nivel de detalle**: su bloque sigue oculto, todo sale en `normal`.
- **El orden de §2** no se movió (sigue incluye → Inversión), igual que en #812.

Relacionado: [[documento-cliente-trappvel]], [[horas-de-vuelo-trappvel]],
[[ranuras-multiples-tres-tarifas]], [[adicionales-por-variante]],
[[mirar-pdf-renderizado]], [[pruebas-por-mutacion]], [[cifras-del-brief-caducan]].
