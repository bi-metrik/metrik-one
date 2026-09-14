---
name: leer-texto-de-un-pdf-de-react-pdf
description: Cómo medir lo que un PDF de @react-pdf IMPRIME sin recalcularlo — el texto va en HEX, no en cadenas literales, y una etiqueta buscada por subcadena da falsos negativos
metadata:
  type: reference
---

Para comprobar que un documento dice lo que el sistema cree, **el número se lee del
binario**. Recalcularlo desde los ítems hereda el supuesto del código que se quiere
probar: la regla puede estar bien y el PDF imprimir otra cosa, que es exactamente lo
que pasaba con el Subtotal en [[aporte-al-total-y-sugeridos]].

No hace falta ninguna dependencia nueva: **no hay extractor de PDF en el repo**
(`ls node_modules | grep pdf` → solo `pdf-lib` y `@react-pdf/*`).

## El método, en dos pasos

1. **Inflar los flujos.** pdfkit los comprime con Flate. Se buscan los pares
   `stream` / `endstream` en el buffer y se pasan por `inflateSync` de `node:zlib`; el
   que no infla es una fuente o una imagen y se descarta.
2. **Leer los operadores de texto.**

## ⚠️⚠️ El texto va en HEX, no en `(...)`

@react-pdf escribe una línea así:

```
[<53> 0 <7562746f74616c> 0] TJ
```

`53` = `S`, `7562746f74616c` = `ubtotal`. **Un extractor que solo busque `(...)`
devuelve CERO piezas**, y la prueba se lee como «el PDF no imprime Subtotal»: un falso
negativo del instrumento, no del documento. Costó una vuelta entera.

Las fuentes de la plantilla genérica son **Helvetica y Helvetica-Bold** (las estándar
de PDF, sin empotrar), así que el código hexadecimal **es** el código del carácter. Con
una fuente empotrada y subseteada serían glyph ids y esto no valdría.

Hay que recorrer primero los OPERADORES (`[...]TJ` y `<..>Tj` / `(..)Tj`) y concatenar
los trozos de cada uno, para que una palabra partida en kerning no salga separada.

## ⚠️ La etiqueta se busca como PALABRA, no como subcadena

`TOTAL` aparece dentro de `SUBTOTAL`, que es el encabezado de la columna de ítems.
Buscando por subcadena, «el TOTAL del PDF» devolvía el precio del primer ítem.

```
new RegExp(`(?:^|[^A-Za-zÁÉÍÓÚÑ])${etiqueta}\\s*\\$?\\s*([\\d.]{4,})`)
```

Y ojo con las mayúsculas: la plantilla titula los bloques en MAYÚSCULA
(`RECOMENDADA`), así que comparar contra `'Recomendada'` da otro falso negativo. Se
compara sobre `texto.toLowerCase()`.

## La comprobación más fuerte: sumar la columna

Lo que hace el cliente con una calculadora. Se recorta el tramo entre el encabezado y
la fila de totales y se suman los importes que ahí aparecen:

```js
const detalle = texto.slice(texto.indexOf('SUBTOTAL'), texto.indexOf(' Subtotal '))
```

Si esa suma no da el `Subtotal` impreso, el documento no cuadra consigo mismo.

## Montar el arnés

`generateCotizacionPDF` corre entero con un doble de Supabase (el de
`recalcular-totales.test.ts` sirve de base). Dos cosas que hacen falta:

- Doblar `@/lib/pdf/pdf-render-client` con `isPdfRenderConfigured: () => false`, para
  que tome PATH B (@react-pdf) y no el servicio externo.
- El doble tiene que devolver **el error de PostgREST** (`42P01`) para las tablas que
  no existen, no una lista vacía: `bloquesParaPDF` distingue los dos casos.

⚠️ Con UN solo itinerario en la propuesta la plantilla cae a la **tabla plana** y no
titula el bloque (`bloques.length > 1`). Para ejercitar el título hacen falta DOS.

Ejemplo vivo: `src/app/(app)/negocios/cotizacion-alternativas-e2e.test.ts`.

Relacionado: [[mirar-pdf-renderizado]], [[aporte-al-total-y-sugeridos]],
[[pruebas-por-mutacion]].
