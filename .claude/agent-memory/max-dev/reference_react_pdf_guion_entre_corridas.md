---
name: react-pdf-guion-entre-corridas
description: Una negrita seguida de puntuación pegada imprime un guion que no existe en el texto del PDF; sale del límite entre corridas, no de partir palabras, y hyphenationCallback NO lo evita
metadata:
  type: reference
---

Medido el 2026-09-07 en la declaración juramentada de SOENA (PR #545),
`@react-pdf/renderer` 4.3.2.

## El síntoma

```jsx
<Text>… marca <Text style={bold}>{linea}</Text>, adquirido el …</Text>
```

Si el renglón corta justo en ese límite, el PDF imprime **`S05 MAX 2027-`** al final
de la línea y **`, adquirido`** al principio de la siguiente. **El guion está en el
TEXTO del PDF**, no solo en el dibujo: un copiar y pegar se lo lleva. Sobre una cédula
o un número de factura eso se lee como un error de transcripción — en un documento que
se firma bajo juramento, no es cosmético.

⚠️ **Solo se manifiesta cuando el renglón corta ahí**, o sea con unos datos sí y con
otros no. Un render de prueba con datos de ejemplo no lo atrapa.

## Por qué, y por qué `hyphenationCallback` no sirve

En `node_modules/@react-pdf/textkit/lib/textkit.js`:

- `wordHyphenation` arma las sílabas **por corrida de texto** (recorre
  `attributedString.runs` y hace `split(/([ ]+)/g)` dentro de cada una).
- `getNodes` marca como punto de separación silábica **todo límite cuya sílaba
  siguiente no sea un espacio**: `const hyphenated = syllables[index + 1] !== ' '`,
  y ahí mete un `linebreak.penalty(hyphenWidth, …)`, que es lo que dibuja el guion.

O sea: «2027» (última sílaba de la corrida en negrita) y «,» (primera de la siguiente)
son sílabas contiguas sin espacio → el motor cree que es **una palabra partida**.

**`hyphenationCallback` no lo toca**, ni en el `<Text>` contenedor ni en el anidado:
ese guion no sale de partir una palabra, sale del límite entre corridas. Se probó en
los dos sitios y el guion siguió.

## El arreglo

**No crear el límite: la puntuación va DENTRO de la negrita.**

```jsx
<B>{`${linea},`}</B> adquirido el …
```

Dos detalles que hacen falta:

- El texto se pasa como **UNA sola plantilla** (`{`${x},`}`), no como dos hijos:
  dos hijos vuelven a ser dos corridas.
- Un espacio (o un salto de línea de JSX, que colapsa a espacio) **sí** convierte el
  límite en un corte normal. Lo que rompe es la puntuación pegada.
- Consecuencia asumida: la coma queda en negrita. A 10 pt no se nota.

Lo mismo aplica a cualquier `<Text>` anidado que empiece con puntuación — en ese PR
un `{dos && <Text>, expedida a nombre de …</Text>}` tenía el mismo defecto y se pasó a
interpolación de cadena, sin abrir corrida.

## La guarda

El defecto no se puede fijar con un render, así que la prueba **lee la fuente** y exige
la regla:

```ts
const pegadas = [...fuente.matchAll(/<\/B>[,.;:)]/g)]
expect(pegadas).toEqual([])
```

⚠️ Ojo con el falso positivo: el ejemplo dentro del comentario que documenta la regla
también coincide. Redactar el comentario sin la secuencia literal.

## Aparte, y esto SÍ lo arregla `hyphenationCallback`

La separación silábica **inglesa** sobre palabras españolas: se midió `Envi-gado` y
`jura-mento`. Va como **prop de cada `<Text>`** —`Font.registerHyphenationCallback` es
global del proceso y cambiaría todos los demás PDF de la app— y deja pasar los tokens
larguísimos (`palabra.length > 40`) para que no se salgan de la caja.

Relacionado: [[mirar-pdf-renderizado]], [[pruebas-por-mutacion]].
