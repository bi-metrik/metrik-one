---
name: icono-app-pino
description: PR #602 (sin mergear) reemplaza el favicon de create-next-app por el isotipo oficial; el .ico gana precedencia sobre el .svg, y la geometria fiteada NO coincide con la que declara el generador de marca
metadata:
  type: project
---

**PR #602, `feat/favicon-pino`, los 4 checks obligatorios en verde, SIN MERGEAR.**
Paso 4 del despliegue de `cerebro/decisiones/2026-09-07_rediseno-visual-pino-profundo.md`,
continuacion del #601.

**Why:** el #601 recoloreo `icon.svg` y dejo intacto `src/app/favicon.ico` desde el
Sprint 0 (`af3d118`). Ese `.ico` es el **triangulo de Vercel** de `create-next-app`.

## ⚠️⚠️ Next declara el `.ico` ANTES que el `.svg`, y en varios navegadores gana el `.ico`

Es la razon de que el icono viejo siguiera a la vista con el deploy correcto. Se ve
en el HTML que emite `npm run build` (`.next/server/app/index.html`), no en el fuente:

```
<link rel="icon" href="/favicon.ico" sizes="256x256" type="image/x-icon"/>
<link rel="icon" href="/icon.svg"    sizes="any"     type="image/svg+xml"/>
```

**Se REEMPLAZA el `.ico`, no se borra.** El navegador pide `/favicon.ico` aunque no
exista el `<link>` (Chrome, Safari, todo bot de vista previa): borrarlo no quita la
peticion, la convierte en 404. Reemplazandolo, **el resultado deja de depender de una
regla de precedencia que no controlamos**, porque los dos candidatos son correctos.
Regla general para cualquier par de assets que compitan: preferir que las dos ramas
sean correctas antes que apostarle a cual gana.

## ⚠️ La geometria del icono NO sale del generador: sale de fitear contra el PNG

`logo-export-pino.html` declara la celda del app icon como caja 180 / cuerpo 96 /
radio 34. **Los PNG de `png-one/` (2026-09-08) son posteriores y no salieron de ahi.**
Ajustando por RMSE contra `metrik-icono-512.png`: **cuerpo 100 y radio 39,75 sobre
caja 180** (0,5556 y 0,2208 de la caja). Con los numeros del HTML el icono queda mal.
**Manda el asset, no el generador** — y no existe en el repo de marca ningun script
que genere `png-one/`.

- `icon.svg` rasterizado a 512 contra el oficial: **RMSE 1,5/255**.
- Control con el icono anterior por el mismo criterio: **131,2**. Sin ese control el
  1,5 no probaria nada.

## Que quedo, y el detalle que se repite

- `favicon.ico`: contenedor con los PNG oficiales de **16, 32 y 64** pegados byte a
  byte (`scripts/generar-favicon-ico.mjs`, verifica sha256 al escribir). 25.931 → 2.949
  bytes. **Next lee la entrada mas grande** y publica `sizes="64x64"`; un `.ico` de
  puras entradas PNG lo parsea sin problema.
- `icon.svg`: contorno tomado de `marca/pino/svg/isotipo.svg` (lo genera
  `vectorizar.py` desde Schibsted Grotesk 700). Antes era `<text font-family="system-ui">`
  con el sufijo en **peso 300**, el peso que Schibsted Grotesk no tiene.
- `apple-icon.png` (180) y `manifest.ts` con 192 y 512 desde `public/icons/`. **Los
  iconos del manifest NO van en `app/`**: la convencion `app/iconN.png` agregaria otro
  `<link rel="icon">` peleando por la pestana, y el manifest necesita una URL.
- El contenedor **lleva su propio fondo carbon con el isotipo NEGATIVO adentro**, asi
  que se lee sobre pestana clara y oscura. **No** se metio `prefers-color-scheme` en el
  SVG: dejaria la pestana con un mosaico claro mientras `apple-icon` y el manifest
  siguen en carbon, o sea tres superficies con iconos distintos.

## Lo que NO se hizo, explicito

- **Sin QA en pantalla.** Todo se verifico rasterizando y midiendo; nadie abrio un
  navegador ni anclo ONE en un celular.
- **El manifest no declara `maskable`**: el asset llena la caja con su propia esquina
  redondeada y una mascara mas agresiva mostraria el transparente de las esquinas.
- **`name` y `description` del manifest repiten los de `layout.tsx`** sin nada que los
  mantenga juntos (dos cadenas; se dejo comentario en vez de montar un modulo).
- **Sin 48px en el `.ico`**: `png-one/` no publica ese tamano y reescalar dejaria de
  ser el asset oficial.
- **`public/next.svg` y `public/vercel.svg`** siguen ahi, tambien de `create-next-app`.

Relacionado: [[tokens-pino-profundo]], [[verificar-assets-visuales]],
[[pruebas-por-mutacion]].
