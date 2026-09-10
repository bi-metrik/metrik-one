---
name: landing-sustenta
description: La landing de Sustenta está montada en sustenta.metrik.com.co pero NO publicada — dos cierres que hay que quitar a mano, cuatro huecos con dueño, y las decisiones de implementación que no se deducen del código
metadata:
  type: project
---

Montada el 2026-09-10. Repo **`bi-metrik/sustenta-landing`** (privado), proyecto Vercel
**`sustenta-landing`** en el team `metrik-one`, dominio **`sustenta.metrik.com.co`**
enlazado y verificado. Auto-deploy en cada push a `main`, probado con un push real.

**Why:** la página tiene cuatro huecos deliberados y publicarla con los marcadores a la
vista sería peor que no publicarla. Por eso lleva **dos** cierres independientes, y los
dos hay que quitarlos a mano el día que se abra:

1. `ssoProtection.deploymentType = "all"` en Vercel — **no es el default**, el default deja
   el dominio propio público (ver [[landing-estatica-en-metrik]]).
2. `<meta name="robots" content="noindex, nofollow">` en `index.html` **y** `Disallow: /`
   en `robots.txt`.

Los cuatro huecos, marcados en el HTML con comentarios `HUECO n de 4`: `[PRECIO]` y
`[VALOR]` (Carmen con Santiago), la respuesta de «¿Dónde quedan mis datos?» (Emilio), y el
nombre de la concesión, que hoy dice «una concesión vial en Colombia» y no se nombra hasta
que Yessica lo autorice **por escrito**.

**How to apply — decisiones que no se ven en el código:**

- **El copy no se edita en este repo.** La fuente de verdad son los dos artboards de
  `proyectos/metrik/sustenta/`. Hay un comparador mecánico (extraer nodos de texto de los
  tres archivos, comparar conjuntos, con una frase de control que debe salir ausente): 79
  frases únicas en la unión de los dos artboards, ninguna falta y ninguna sobra. Si alguien
  pide cambiar una frase, se cambia en el artboard y se baja.
- **Dos umbrales, con razón distinta.** 760 px: la barra pasa de enlace a botón, el hero se
  centra, las rejillas de tarjetas se abren. 960 px: el recorrido de pantallas pasa a dos
  columnas. Por debajo de 960 la captura va a **ancho completo a propósito**: comprimir un
  pantallazo de 1440 px a ~420 px lo vuelve ilegible, y en ese rango pesa más ver el
  producto que ahorrar scroll. El precio son bloques altos entre 760 y 959; está asumido.
- **La comprobación barata del render es la ALTURA contra el artboard**, medida con el
  mismo chromium: 10076 px contra 10038 del artboard a 1440, y 9023 contra 9015 a 390.
  Menos del 0,4%. Un salto grande ahí delata un bloque mal armado antes de mirar nada.
- **Las capturas se referencian por nombre y se regeneran con un script**
  (`scripts/optimizar-capturas.mjs`): reemplazar los PNG en origen y volver a correrlo no
  toca el marcado. Se usó de verdad el mismo día, cuando la sesión hermana recapturó con el
  lockup corregido: cambiaron los 20 archivos de `assets/capturas`, ninguno se agregó ni se
  borró. ⚠️ Ojo con las capturas: **el lockup «MéTRIK sustenta» y las tildes existen solo
  en la foto**; el producto sigue mostrando «MéTRIK one» (ver
  [[capturas-sustenta-landing]]).
- **La caché de `/assets/capturas/` es de una hora, no de un año**, justamente porque los
  archivos se reemplazan conservando el nombre. Las fuentes sí van `immutable`.
- **Las fuentes van autoalojadas**, los mismos tres binarios que sirve MéTRIK one, con los
  rangos de peso reales de cada archivo (Schibsted arranca en 400, no tiene Light) y
  `font-stretch: 100%` en Martian Mono. El repo los **redistribuye**, así que lleva
  `LICENCIAS-FUENTES.md` con los avisos OFL: es condición de Emilio, la misma que cumple
  `layout.tsx` en el producto.

**Lo que queda abierto y no depende de código:** los cuatro huecos; decidir si el repo pasa
a público como `afi-landing` y `metrik-landing` (se dejó privado porque el contenido no está
liberado); y una imagen de Open Graph, que no se hizo porque la captura disponible no tiene
la proporción ni el encuadre de una tarjeta social.

**El contraste sobre carbón ya está corregido** (commit `8ca4aab`, desplegado el 2026-09-10).
El pie legal y la línea «Te atiende AFI» estaban en `#6E6A62` sobre `#191713` = **3,32:1**,
bajo el 4,5:1 de AA. Diseño lo cambió primero en los artboards y de ahí se bajó al sitio.
Tres cosas que no se deducen del diff:

- **No se escribió el hex: se reusó el token `--gris-claro` (`#A8A29A`) que YA existía** en
  el bloque `:root` y que ya usaba `.cierre__bajada`. Las tres reglas que cambiaron son
  `.cierre__canal`, `.pie__legal` y `.pie__operador` → **7,07:1**.
- **El artboard trae CUATRO elementos en `#A8A29A` y el sitio solo necesitaba tres**: el
  cuarto (`.cierre__bajada`) ya estaba claro en la implementación. El brief decía «tres
  reemplazos» y el artboard decía cuatro; las dos cifras eran ciertas desde su lado.
- **El `#6E6A62` sobre papel y sobre blanco NO se toca**: da 4,77:1 y 5,38:1 y pasa AA. Hoy
  quedan 25 nodos así, todos sobre fondo claro. La otra sección oscura (`.problema`) nunca
  usó gris: va en `--papel`, `--blanco` y `--pino-300`.

Verificado midiendo el render, no el CSS (ver [[medir-contraste-en-el-render]]): 91 nodos
con texto a 1440 y a 390 px, **cero por debajo de AA**, y el HTML que sirve el dominio es
byte a byte el del repo (sha256 idéntico, 38.811 bytes). La protección quedó intacta
(`ssoProtection.deploymentType = "all"`, 302 al SSO sin bypass) y el `noindex` y el
`Disallow: /` siguen ahí: **la página sigue montada y sin publicar**.

Relacionado: [[tokens-pino-profundo]].
