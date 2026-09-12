---
name: landing-sustenta
description: La landing de Sustenta ya es pública en sustenta.metrik.com.co, NO indexable, sin sector y con la franja de normas — la bajada del hero vive tres veces (el comparador de copy solo ve una) y los nombres de norma son ejemplos, nunca cobertura
metadata:
  type: project
---

Montada el 2026-09-10. Repo **`bi-metrik/sustenta-landing`** (**privado, y se queda
privado**), proyecto Vercel **`sustenta-landing`** en el team `metrik-one`, dominio
**`sustenta.metrik.com.co`**. Auto-deploy en cada push a `main`.

## Estado desde el 2026-09-10 noche: pública, sin buscadores y SIN SECTOR

1. `ssoProtection = {"deploymentType": "all_except_custom_domains"}`. ✅ **El README ya lo
   dice bien** (commit `864edb9`, 2026-09-10): decía `null`, que es falso y habría abierto
   las URL por despliegue si alguien lo "restauraba". La comprobación es releer el
   proyecto, nunca el README ni el cuerpo del PATCH.
   ⚠️ Y el matiz que costó: ese valor abre **producción**, o sea el dominio propio **y el
   alias `sustenta-landing.vercel.app`** — la página tiene DOS direcciones públicas. Lo que
   queda cerrado son las URL `<proyecto>-<hash>-metrik-one.vercel.app`, una por deploy.
   Detalle en [[landing-estatica-en-metrik]].
2. **`<meta name="robots" content="noindex, nofollow">` + `Disallow: /` en `robots.txt`
   SIGUEN PUESTOS a propósito.** Son una pareja y se quitan juntos el día que Mauricio
   quiera indexar.
3. **La página ya no habla de un sector** (commit `3ea7b1d`, decisión de Mauricio): sirve a
   cualquier empresa que reciba auditorías, no solo a CDAs. El gate desde entonces es que
   en el HTML **servido** no quede `CDA`, `Supertransporte` ni `UIAF`.

4. **Franja «La norma la pones tú.»** (commit `2a40f58`, 2026-09-10), entre «Qué es
   Sustenta» y el recorrido: nueve nombres de norma como fichas (SARLAFT, SAGRILAFT, PTEE,
   SST, BASC, RUC, ISO 9001/45001/39001). ⚠️⚠️ **Son EJEMPLOS de lo que el cliente carga,
   nunca cobertura.** Regla `cerebro/reglas/cautela-afirmacion-marco-normativo`. Lo que la
   protege es el propio copy («Sustenta no viene con una norma adentro. Cargas la tuya»),
   así que **cualquier reescritura que le meta un verbo de logro la rompe**.

**Hueco que queda: uno.** El nombre de la concesión («una concesión vial en Colombia»), que
no se nombra hasta que **Yessica lo autorice por escrito**. Marcado con un comentario `HUECO`.

## ⚠️ El gate de copy normativo NO puede prohibir la raíz de la palabra

Al construirlo, prohibir `garantiz` y `certific` a secas dio tres falsos positivos, y los
tres eran copy **preexistente y correcto**: la pregunta que **niega** la garantía («¿Me
garantiza pasar la visita?» → «No, y desconfía de quien lo prometa»), el rótulo de público
«Empresas certificadas» y «auditorías de recertificación». Prohibir la raíz habría exigido
borrar la única frase que protege legalmente a la página.

Lo que sí funciona, y quedó en `gate_normas.py` del scratchpad: **(a)** fórmulas que son
promesa en cualquier contexto («cumple con», «certificado en», «norma precargada»…) sobre
las tres capas —HTML crudo, texto visible y `title`+`meta`—; **(b)** cero raíces de logro
**dentro de la franja nueva**; **(c)** que el conteo de cada raíz en toda la página **no
suba** respecto del commit anterior (`git show <ref>:index.html`), que es la forma directa
de afirmar «no agregué ninguno»; y **(d)** las frases preexistentes verbatim, para que
nadie las reescriba en silencio. Con tres controles: una versión sucia sembrada tiene que
caer por las tres vías.

⚠️ **Y el aviso del propio código no puede citar los literales prohibidos**: el comentario
HTML decía «no se escribe "cumple con"…» y hacía que el grep encontrara la prohibición
dentro del aviso que la prohíbe. Se redacta sin usarlos.

## ⚠️⚠️ La bajada del hero vive TRES veces, y el comparador solo ve una

`<p class="lede">`, `<meta name="description">` y `<meta property="og:description">` llevan
**el mismo texto**. El comparador mecánico de copy extrae **nodos de texto visible**, así
que las dos del `<head>` son su punto ciego: da verde con «Supertransporte» todavía
sirviéndose en el `<head>`. El gate sí las ve, porque mira el HTML servido entero.

Es la misma familia que el comentario de la cabecera que nombraba `[PRECIO]` y `[VALOR]`:
**un `<head>` se sirve**. Regla: al cambiar una frase del hero, contar cuántas veces está
en el archivo antes de reemplazar, y declarar el número esperado en el script de edición.
En el cambio de sector fueron **3 de un solo reemplazo** y 1 de los otros catorce.

## Lo que NO cambia aunque cambie el sector

- **«En operación con una concesión vial en Colombia.»** se queda: es prueba real y no ata
  el producto a un sector.
- **Las capturas siguen mostrando un caso SARLAFT** (la barra lateral dice «Segmentación
  SARLAFT»), porque es donde hay operación. Decisión, no pendiente.

## How to apply — decisiones que no se ven en el código

- **El copy no se edita en este repo.** La fuente de verdad son los dos artboards de
  `proyectos/metrik/sustenta/` (`Main.dc.html` y `Mobile.dc.html`), y **los dos se editan
  juntos**: se comprobó que ninguno se quedó con la versión vieja. El comparador (extraer
  nodos de texto de los tres archivos, comparar conjuntos, con una frase de control que
  debe salir ausente) da **70 frases** en la unión de los dos artboards; lo único que
  «sobra» en el sitio es el `<title>`, que los artboards no tienen.
- ⚠️ **El brief de un cambio de copy puede nombrar frases que ya no existen.** El encargo
  del cambio de sector pedía cambiar «facturación del CDA» en la tarjeta de ONE: esa frase
  no estaba ni en los artboards ni en el sitio (los dos dicen «clientes, cotizaciones y
  facturación, sin un segundo sistema…»). Se comprueba con un grep antes de buscarla a mano.
- **Un cambio «solo de texto» se prueba contando etiquetas**: `len(re.findall(r"<[a-zA-Z/!][^>]*>"))`
  antes y después tiene que dar idéntico (415). Si se movió, no era solo texto.
- **Una sección PORTADA se prueba contra el render del artboard, no a ojo.** Se le pone un
  `id` a una **copia** del artboard, se sirven los dos por HTTP (para que `/assets/fonts`
  resuelva; con `file://` la fuente cae al fallback y el ancho cambia) y se fotografía el
  mismo recorte. En la franja de normas el alto salió **idéntico**: 516 px a 1440 y 474 px
  a 390. ⚠️ El diff de píxeles no da cero por antialiasing: hay que **barrer el
  desplazamiento** (dy de −4 a +4) — si la curva tiene forma de V con mínimo en un dy, es
  medio píxel de redondeo; si no baja, es maquetación distinta.
- ⚠️ **El scratchpad es COMPARTIDO y los puertos también.** Un `python3 -m http.server 8899`
  falló al bindear porque otra sesión ya lo tenía con **otro** sitio, y el screenshot salió
  contra la página ajena diciendo «selector sin nodo», que se lee como un error de CSS
  propio. Comprobar `readlink /proc/<pid>/cwd` del servidor **y** que el sha256 de lo
  servido sea el del archivo, antes de creerle a la primera medición.
- **Dos umbrales, con razón distinta.** 760 px: la barra pasa de enlace a botón, el hero se
  centra, las rejillas se abren. 960 px: el recorrido de pantallas pasa a dos columnas.
- **Los tamaños fluidos se derivan de 390 → 1200 px.** `slope_vw = (max-min)*0.1234568`,
  `intercept = min - (max-min)*0.481481`.
- **La caché de `/assets/capturas/` es de una hora, no de un año**, porque los archivos se
  reemplazan conservando el nombre. Las fuentes sí van `immutable`.
- **Las fuentes van autoalojadas** y el repo las **redistribuye**: lleva `LICENCIAS-FUENTES.md`
  con los avisos OFL (condición de Emilio).
- **El contraste sobre carbón ya está corregido** (`8ca4aab`). El `#6E6A62` sobre papel y
  sobre blanco **no se toca**. Detalle en [[medir-contraste-en-el-render]].

Relacionado: [[landing-estatica-en-metrik]], [[capturas-sustenta-landing]], [[tokens-pino-profundo]].
