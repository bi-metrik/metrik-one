---
name: dia-relativo-sugeridos
description: PR #718 mergeado (aeadee74) y migración APLICADA — una línea SIN grupo nunca cae a «no incluidas» (grupoCombinable(null) es false y habría barrido a Termotech); la sugerencia con precio deja el documento sin sumar; y el caso concreto de los dos interruptores
metadata:
  type: project
---

⚠️ **CADUCÓ lo de «sin mergear»:** #718 entró como `aeadee74` y la migración
`20260915000000` está aplicada (medido 2026-09-15). Los dos interruptores ya existen:
ver [[entra-al-precio]] (#728).

**PR [#718](https://github.com/bi-metrik/metrik-one/pull/718)**, rama
`feat/dia-relativo-itinerario-sugeridos` (borrada), **6 checks verdes**. Paso
que cierra la parte de presentación del bloque 3 del
[[pantallazo-ranuras]]. Sin escrituras a producción.

Decisión de Mauricio del 2026-09-14, textual: *«deben vivir superpuestas, solo que si
es itinerario debe darme la opción de poder asignarle un día… En caso de que no tenga
fecha asignada entra al paquete de sugerido»* y *«día relativo, que el itinerario se
arma antes de fijar fechas»*.

## ⛔ La migración NO está aplicada, y el PR espera por eso

`supabase/migrations/20260915000000_items_dia_relativo.sql`: `items.dia_relativo`
(int, `>= 1`) y `items.mostrar_en_sugeridos` (bool, default `true`). Aditivas, cero
filas tocadas. Pointer en
`proyectos/trappvel/clarity/migrations/2026-09-14_dia-relativo-PENDIENTE.sql` (el SQL
**no** está duplicado ahí a propósito).

**No hay pieza de tolerancia y es deliberado** (no se reintroduce la deuda de
`congelar-umbrales.ts`): toda lectura de `items` usa `select('*')`, así que sin la
columna el campo llega `undefined` = sin día = comportamiento de hoy; las escrituras
fallan con `42703`, ruidoso. Orden: aplicar → verificar el ledger → mergear.

## ⚠️⚠️ La trampa que estuvo cerca: `grupoCombinable(null)` es `false`

El brief decía «reusa `RANURAS_COMBINABLES`» para decidir qué cae a sugerido. Escrito
solo con esa función, **una línea SIN grupo pasa el filtro** — y sin grupo están las
**37 líneas** de Termotech, Arca, WMC y Clarity Express (de 41 en toda la base), más el
seguro y el fee de cualquier viaje. Habrían salido impresas como «actividad adicional
NO INCLUIDA» mientras el cliente las paga.

**El criterio correcto exige DECLARAR grupo:** `puedeSerSugerido` pide `grupo` no vacío
**y** no combinable. El grupo es la declaración de que la línea es un componente de un
tipo; sin ella, imprime donde imprime hoy.

Asimetría deliberada, en la dirección segura: sin grupo **sí** puede llevar día (se la
mete al itinerario a propósito) pero **no** puede caer a sugerida (nadie la saca del
precio por omisión). Meter algo de más al itinerario se ve; sacar algo del documento
sin querer, no.

⚠️ La mutación que quita `if (grupo === '') return false` al principio **solo mataba UNA
prueba**. Ese hueco de cobertura es el que destapó que faltaba el caso «viaje que SÍ usa
días + línea sin grupo». Con esa prueba agregada, la mutación mata dos.

## ⚠️⚠️ Con una sugerencia CON PRECIO, el documento NO suma

Medido sobre el PDF renderizado, no razonado. La columna impresa da 4.471.150 y el
Subtotal 5.252.874: **781.609 de diferencia**, que es exactamente lo que cobran las
sugerencias. Porque el día es presentación y `itemsQueAportanAlTotal` no lo mira.

Las dos alternativas se descartaron a propósito y conviene recordar por qué:

| Alternativa | Por qué no |
|---|---|
| Imprimirla **también** en el detalle | El mismo documento diciendo que la línea está y que no está incluida |
| Descontarla del total | Es «arreglarlo solo», que el encargo prohíbe, y le mueve el precio a una cotización ya revisada |

Lo único que lo frena es el **aviso rojo** del editor, pegado a los totales, con la
plata y las dos salidas. Está fijado por prueba de render y por una prueba que mide la
diferencia de 781.609 — para que nadie lo descubra en un documento del cliente.

## ❓ El caso concreto de los DOS interruptores, reportado y NO construido

Una agencia carga «Tour Isla Catalina, $551.724» como sugerencia: quiere que el cliente
**vea el precio** y que **no esté en el total**. Con un solo interruptor no se puede.

Un segundo interruptor (`¿entra al precio?`) lo cerraría. **No se construyó**, por
instrucción. La salida que existe hoy: dejar la sugerencia en cero y poner el precio en
la descripción.

⚠️ El check `mostrar_en_sugeridos` **no es** ese segundo interruptor: es visibilidad en
el documento, no inclusión en el precio. Y por eso el aviso mira también las ocultas —
una que el cliente no ve y sí paga es el caso **peor**, no el mejor.

## El defecto que solo vio el documento renderizado

Sin filtrar las sugerencias de `itemsSinDia`, el traslado se imprimía **DOS veces**: en
«Incluye también» y en «actividades adicionales no incluidas». Ninguna prueba pura lo
veía. Confirma [[mirar-pdf-renderizado]]: mirar la página convence, el volcado prueba.

## Cómo queda repartido el documento

`dias` + `itemsSinDia` son una **PARTICIÓN** de `items`, no algo aparte: `items` sigue
trayendo todo lo que aporta (de ahí salen Subtotal e impuestos) y los dos arreglos solo
dicen cómo se reparte en la página. Una plantilla que los ignore (Termotech) imprime
`items` plano y **no cambia un píxel**.

| Pieza | Archivo |
|---|---|
| Reglas puras (31 pruebas) | `src/lib/cotizaciones/dia-relativo.ts` |
| Server action con guard | `actualizarDiaDeItem` en `itinerario-actions.ts` |
| Partición para el PDF | `cotizacion-pdf-actions.ts` |
| Secciones del documento | `src/lib/pdf/cotizacion-pdf.tsx` |
| Campo, check, badge y aviso | `cotizacion-editor.tsx` |

⚠️ El guard de `actualizarDiaDeItem` **lee el grupo de la BASE**, no del navegador: con
el grupo por parámetro bastaría mandar `grupo: 'tour'` sobre el id de un vuelo.

⚠️ Con itinerarios en propuesta (bloques de alternativas) los días quedan en `null`: el
documento ya está organizado por opciones y meterle días encima daría dos
organizaciones del mismo contenido en la misma página.

## Un ENTERO alcanza, y se evaluó

Un tour de dos días se declara en el día en que **arranca** (es como se lee un
itinerario) y la duración ya tiene sitio en `items.descripcion`. Un hotel de tres
noches es **combinable**: no lleva día nunca. Un rango agregaría una columna, un
invariante y la pregunta de en qué día se imprime lo que abarca tres.

## Medido contra producción (2026-09-14, antes de escribir)

41 items · 20 cotizaciones · 4 con `grupo` (los cuatro `vuelo`, en 2 cotizaciones de
trappvel) · 0 filas en `cotizacion_itinerarios` e `itinerario_opciones` · **0
cotizaciones con día**. Al aplicar, ningún documento cambia.

Relacionado: [[pantallazo-ranuras]], [[aporte-al-total-y-sugeridos]],
[[itinerarios-cotizacion]], [[trappvel-reglas-reunion-15]],
[[leer-texto-de-un-pdf-de-react-pdf]], [[mirar-pdf-renderizado]],
[[pruebas-por-mutacion]], [[medir-antes-de-construir]].
