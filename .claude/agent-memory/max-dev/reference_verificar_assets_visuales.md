---
name: verificar-assets-visuales
description: sharp ya esta en node_modules y rasteriza SVG — sirve para medir un asset contra el oficial en vez de mirarlo; y los <link> de icono se leen del HTML prerenderizado del build, no del fuente
metadata:
  type: reference
---

## `sharp` esta disponible y rasteriza SVG

`metrik-one/node_modules/sharp` existe (lo trae Next para optimizar imagenes) y
**convierte SVG a raster**, asi que se puede comparar un SVG contra un PNG oficial
pixel a pixel sin instalar nada. En la torre **no hay** ImageMagick, `magick`,
`icotool`, `png2ico`, `rsvg-convert`, `inkscape`, ni Pillow en el `python3` del
sistema — comprobado el 2026-09-09. `pngjs` tambien esta.

```js
import sharp from '.../node_modules/sharp/lib/index.js'
const crudo = await sharp(Buffer.from(svg)).resize(512, 512).ensureAlpha().raw().toBuffer()
```

**How to apply:** cuando haya que reproducir un asset oficial (icono, logo, sello),
no ajustar los numeros a ojo. Rasterizar el candidato al tamano del oficial, calcular
el RMSE sobre fondo blanco (componiendo por alfa) y **barrer los parametros**
(escala, radio, offset) buscando el minimo. Si el minimo cae en el borde del rango
que se barrio, el rango estaba mal y hay que ampliarlo — paso con el radio.

⚠️ **El RMSE bajo solo vale con un control que de alto.** El icono anterior por el
mismo criterio dio 131/255 contra el 1,5 del candidato: sin ese segundo numero, un
1,5 podria significar «coinciden» o «el arnes compara la imagen consigo misma».

Para medir bounding boxes de tinta dentro de un PNG (donde arranca la M, donde la
linea) basta recorrer el `raw()` con un predicado de color. **Ojo con el antialias**:
un umbral de alfa >128 estira la caja ~1px por lado y ese px arruina un ajuste fino.
Por eso conviene fitear por diferencia global y no por bordes medidos.

## Los `<link rel="icon">` se leen del HTML que emite el build

`npm run build` deja HTML prerenderizado en `.next/server/app/*.html` para las
paginas estaticas (`index.html`, `registro.html`, `onboarding.html`, `_not-found.html`).
Ahi estan los `<link>` que Next genera de verdad, con su orden y su `sizes`:

```
grep -o '<link rel="[^"]*\(icon\|manifest\)[^"]*"[^>]*>' .next/server/app/index.html
```

Y para comprobar que lo que se sirve son los bytes que uno puso, no una version
reprocesada: `.next/static/media/<nombre>.<hash>.<ext>` y
`.next/server/app/<ruta>.body` deben tener el **mismo md5 que el archivo del repo**.
En el #602 los tres (repo, `static/media`, `.body`) coincidieron con el PNG oficial
del monorepo de marca: byte identico de punta a punta.

## Un `.ico` es un contenedor, se arma y se lee sin librerias

Cabecera `ICONDIR` de 6 bytes (`reservado=0`, `tipo=1`, `n`) + una `ICONDIRENTRY`
de 16 bytes por imagen (`ancho`, `alto`, paleta, reservado, planos, bpp, `bytes`,
`offset`). El campo de ancho en **0 significa 256**. Se puede embeber PNG tal cual
(lo leen todos los navegadores desde IE11), y eso permite **probar que el `.ico`
contiene el asset oficial**: se re-extrae la entrada y se compara con `cmp`. Con
entradas BMP/DIB esa prueba no existe. `sizes` que publica Next sale de la entrada
**mas grande**.

Las medidas reales de un PNG estan en el chunk IHDR: `readUInt32BE(16)` y
`readUInt32BE(20)`. No confiar en el nombre del archivo.

## ⚠️ El preview de Vercel esta detras de SSO: no se puede verificar con curl

`curl -L <preview>/favicon.ico` devuelve **HTTP 200 con `text/html` y ~340 kB**: es la
pagina de login de Vercel, no el asset. Un 200 ahi no prueba nada. La verificacion
equivalente es contra los bytes del build local, que es lo que el deploy sirve.

Relacionado: [[icono-app-pino]], [[mirar-pdf-renderizado]], [[pruebas-por-mutacion]].
