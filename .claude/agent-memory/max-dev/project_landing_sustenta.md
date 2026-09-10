---
name: landing-sustenta
description: La landing de Sustenta ya es pública en sustenta.metrik.com.co pero NO indexable — el cierre que queda, el hueco que queda, y las decisiones de implementación que no se deducen del código
metadata:
  type: project
---

Montada el 2026-09-10. Repo **`bi-metrik/sustenta-landing`** (**privado, y se queda
privado**), proyecto Vercel **`sustenta-landing`** en el team `metrik-one`, dominio
**`sustenta.metrik.com.co`**. Auto-deploy en cada push a `main`.

## Estado desde el 2026-09-10 tarde: enlace público, sin buscadores

Mauricio la abrió. De los **dos** cierres que llevaba, se quitó uno y el otro se queda:

1. ~~`ssoProtection.deploymentType = "all"`~~ → hoy **`all_except_custom_domains`**, el
   mismo valor que `afi-landing`: el dominio propio responde **200 a cualquiera** y los
   `*.vercel.app` siguen tras el SSO del team. Se eligió eso y no `null` (que es lo que
   tiene `metrik-landing`) porque abre exactamente lo que se pidió y deja los previews
   cerrados. `PATCH /v9/projects/<p> {"ssoProtection": {...}}`, y **la comprobación es
   releer el proyecto**, no el código del PATCH.
2. **`<meta name="robots" content="noindex, nofollow">` en `index.html` y `Disallow: /`
   en `robots.txt` SIGUEN PUESTOS a propósito.** ⚠️ Son una pareja y no se tocan sin que
   Mauricio lo pida: quiere el enlace compartible y todavía **no** quiere que Google la
   liste. El día que se quiera indexar se quitan los dos juntos.

**De los cuatro huecos originales queda UNO:** el nombre de la concesión («una concesión
vial en Colombia»), que no se nombra hasta que **Yessica lo autorice por escrito**. Los
dos de precio y el de datos se cerraron el 2026-09-10 (abajo). Marcado en el HTML con un
comentario `HUECO` (ya no `HUECO n de 4`).

## El cambio de copy del 2026-09-10 (commit `2ed5101`)

Bajado de los artboards, que son la fuente de verdad. Dos cosas:

- **La tarjeta de precio ya no lleva cifras.** Los dos bloques (`[PRECIO]` / `[VALOR]`)
  se funden en uno: rótulo «Cómo se cobra», titular «Cotizamos por CDA» y el texto de que
  los dos números se dan en la llamada de la demostración. Las tres viñetas y el titular
  de la sección no se tocaron. Clases nuevas `.tarjeta-precio__titular` y
  `__texto`; salieron `__cifra`, `__valor`, `__valor--menor`, `__unidad`, `__nota`.
- **Salió la pregunta «¿Dónde quedan mis datos?»**, que arrastraba una nota interna
  dirigida a Emilio. ⚠️ El borde inferior de la lista lo pone `.faq__item:last-child`, no
  un `nth-child`, así que **el que era el último lo conserva solo**: no hubo que tocar CSS.
- ⚠️ **El comentario de la cabecera del `<head>` también nombraba `[PRECIO]` y `[VALOR]`.**
  Un comentario HTML **se sirve**: si el gate es «que no quede nada entre corchetes en el
  HTML servido», hay que reescribir el comentario, no solo el marcado visible.

## How to apply — decisiones que no se ven en el código

- **El copy no se edita en este repo.** La fuente de verdad son los dos artboards de
  `proyectos/metrik/sustenta/`. El comparador mecánico (extraer nodos de texto de los tres
  archivos, comparar conjuntos, con una frase de control que debe salir ausente) da hoy
  **70 frases únicas** en la unión de los dos artboards, ninguna ausente; lo único que
  «sobra» en el sitio es el `<title>`, que los artboards no tienen. Si alguien pide
  cambiar una frase, se cambia en el artboard y se baja.
- **Dos umbrales, con razón distinta.** 760 px: la barra pasa de enlace a botón, el hero se
  centra, las rejillas de tarjetas se abren. 960 px: el recorrido de pantallas pasa a dos
  columnas. Por debajo de 960 la captura va a **ancho completo a propósito**.
- **Los tamaños fluidos se derivan de 390 → 1200 px.** `slope_vw = (max-min)*0.1234568`,
  `intercept = min - (max-min)*0.481481`. Comprobado contra una regla existente
  (14→15 px da `clamp(14px, 13.52px + 0.12vw, 15px)`). Así se calcularon las dos clases
  nuevas sin inventar números.
- **Las capturas se referencian por nombre y se regeneran con un script**
  (`scripts/optimizar-capturas.mjs`). ⚠️ **el lockup «MéTRIK sustenta» y las tildes existen
  solo en la foto**; el producto sigue mostrando «MéTRIK one» (ver
  [[capturas-sustenta-landing]]).
- **La caché de `/assets/capturas/` es de una hora, no de un año**, porque los archivos se
  reemplazan conservando el nombre. Las fuentes sí van `immutable`.
- **Las fuentes van autoalojadas** y el repo las **redistribuye**, así que lleva
  `LICENCIAS-FUENTES.md` con los avisos OFL: condición de Emilio.
- **El contraste sobre carbón ya está corregido** (commit `8ca4aab`): `.cierre__canal`,
  `.pie__legal` y `.pie__operador` pasaron de `#6E6A62` (3,32:1) al token `--gris-claro`
  `#A8A29A` (7,07:1). El `#6E6A62` sobre papel y sobre blanco **no se toca**: 4,77:1 y
  5,38:1, pasan AA. Detalle en [[medir-contraste-en-el-render]].

## Lo que sigue abierto

El nombre de la concesión (Yessica, por escrito) y una imagen de Open Graph, que no se
hizo porque la captura disponible no tiene la proporción ni el encuadre de una tarjeta
social. **El repo se queda privado**: el contenido ya es público por la web, el
repositorio no tiene por qué serlo.

Relacionado: [[landing-estatica-en-metrik]], [[tokens-pino-profundo]].
