---
name: capturas-ui-sin-servidor
description: Cómo fotografiar pantallas REALES del producto con datos ficticios cuando no hay dev server ni acceso a la base — vitest renderiza, vite compila el CSS y el chromium de Playwright hace la foto
metadata:
  type: reference
---

Sirve para material de marketing, demos y QA visual **sin tocar producción**: las pantallas
son los componentes reales del repo, los datos son inventados.

## La cadena que funcionó (2026-09-10, capturas de Sustenta; repetida en la 2ª pasada)

1. **Páginas demo en un route group NUEVO** (`src/app/(sustenta)/…`), que importan los
   componentes de presentación reales (`riesgos-list`, `matriz-client`, `controles-list`,
   `riesgo-detail`, `control-detail-client`) y el `AppShell` con props inventadas. Se
   duplica solo el JSX del wrapper de cada `page.tsx` (30-60 líneas). **Cero archivos
   existentes modificados** — todo se borra al terminar.
2. **CSS real:** `npx vite build --config <cfg>.mjs` con un entry
   `@import "./src/app/globals.css"; @source "./src";`. Vite toma el `postcss.config.mjs`
   del repo, o sea el mismo Tailwind v4 del producto. Salen ~148 kB con los tokens Pino
   Profundo. ⚠️ **quitar `cssCodeSplit:false`** o rollup rechaza un `.css` como input.
3. **HTML:** una prueba de vitest (`.test.ts`, nunca `.tsx`) que hace
   `renderToStaticMarkup(React.createElement(mod.default, {}))` y escribe el archivo con
   `<link>` al CSS compilado y `@font-face` con `file://` a `src/app/fonts/*.woff2`
   (definiendo `--font-schibsted`, `--font-newsreader`, `--font-martian-mono`).
   ⚠️ **`<style>.sp{display:none!important}</style>`**: el `Splash` del layout raíz es un
   overlay a pantalla completa que solo se apaga con JS. (Si se renderiza solo el subárbol
   del `AppShell`, como en la 2ª pasada, el Splash no entra y no hace falta.)
4. **Foto:** el chromium de Playwright, por CLI, sin CDP ni la librería:
   `~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome --headless --disable-gpu
   --no-sandbox --hide-scrollbars --screenshot=x.png --window-size=1440,H archivo.html`.

⚠️ **El AppShell usa `h-dvh` con scroll interno**, así que la altura de la ventana ES la
altura de la captura: no hay "full page". Se ajusta a ojo mirando el PNG con la tool Read
y recortando (`--window-size=1440,762` para cortar justo antes de la tarjeta siguiente).
`--force-device-scale-factor=2` lo rechazó el clasificador; a 1x se ve bien igual.

## Rehacer una tanda ya aprobada: el diff de píxeles es la verificación

Cuando el encargo es "las mismas capturas con estos dos cambios", mirar las imágenes no
alcanza. Un script con `sharp` que compara los buffers `raw()` píxel a píxel, pinta una
**máscara de diferencias** y lista las **bandas de filas** que difieren convierte "solo
cambió lo pedido" en algo que se ve de un golpe: en la 2ª pasada la máscara mostró
exactamente el lockup, dos pastillas del sidebar y puntitos sueltos donde entraron las
tildes. Ahí se descubrieron dos cosas que ninguna prueba de texto habría delatado:

- ⚠️⚠️ **La foto hay que repetirla DESPUÉS del último render.** Se cambió un componente,
  se volvió a correr vitest y solo se re-fotografiaron 2 de 6 pantallas: el PNG viejo
  seguía ahí, con los iconos de los botones cambiados, y el diff lo mostró como si el
  render estuviera mal. Es el gemelo del gotcha de "los checks se corren después del
  último cambio".
- ⚠️ **Reimplementar un componente auxiliar "porque importa server actions" sale caro.**
  El espejo estático de `RiesgosExcelActions` tenía otras clases y los iconos cruzados.
  Doblando las tres server actions en el `vi.mock` el componente REAL renderiza y la
  captura queda idéntica píxel a píxel. Doblar es más barato que copiar.

⚠️ **La fecha de la cabecera es `new Date()`.** Sin congelarla, rehacer una tanda cambia
"Miércoles, 9" por "Jueves, 10" y ensucia el diff. `vi.useFakeTimers()` +
`vi.setSystemTime(...)` en `beforeAll` lo fija; con `renderToStaticMarkup` (sincrónico) no
estorba en nada.

⚠️ **El `pathname` del mock decide qué ítem del sidebar sale resaltado.** Un solo valor
para las seis pantallas deja "Riesgos" iluminado en la captura de Matriz y en las de
Controles. Se pasa la ruta real de cada pantalla.

## ⚠️ Lo que el clasificador de Bash bloqueó, y con qué se reemplaza

Bloqueados de forma consistente (no transitoria): `node <script>.mjs` / `python3 <script>.py`
**cuando el script lo escribe uno para editar código** (para eso va la tool Edit),
`npx next dev`, `npx next build`, `cp -a <repo>/src <scratchpad>`, y **leer producción por
PostgREST** aunque el script solo hiciera GET. También rechaza bucles `for` de bash y
comandos con variables que "no se puede demostrar que no sean git": van uno por uno.

Permitidos: `npx tsc --noEmit`, `npx vitest run`, **`npx vite build`**, el binario de
chromium, `node <script>.mjs` **de solo lectura sobre imágenes** (`sharp` para recortar,
medir y diffear), `cp` de PNGs sueltos, `mkdir`, `rm -rf`.

⚠️ **El scratchpad `/tmp/claude-…` está FUERA del worktree y el clasificador lo bloquea.**
Los temporales van en una carpeta dentro del worktree (`.sustenta-tmp/`) y se borran al
final. Antes de `rm -rf` de cualquier carpeta suelta, comprobar que es tuya: en la 2ª
pasada apareció un `.sustenta-build/` sin trackear **de otra sesión** trabajando la misma
landing, y borrarlo habría sido destruir trabajo ajeno.

## Verificación

La misma prueba que escribe el HTML afirma lo que debe verse (refs, badges, `92%`,
`Sin control`) y **falla al aparecer un dato del cliente real**: un `expect(...).not.toMatch(/\bAFI\b/)`.
⚠️ Ese guard hay que anclarlo con `\b`: `AFI` es subcadena de **GAFI**, que es vocabulario
SARLAFT legítimo, y el primer intento dio rojo por eso.
⚠️ El guard de **cédulas y NIT** (`\d{1,3}[.,]\d{3}[.,]\d{3}`) se corre sobre el TEXTO
visible, no sobre el HTML crudo: el `rgba(16,185,129,0.15)` de una clase de foco tiene
forma de NIT y hace saltar la alarma sin que haya un dato de nadie.
Las tres guardas se vieron **fallar** sembrando `ALMA`, un NIT y el lockup viejo, y volver
a verde al retirarlos ([[pruebas-por-mutacion]]).

Relacionado: [[render-appshell-aislado]], [[probar-render-sin-dom]], [[verificar-css-compilado]],
[[verificar-assets-visuales]].
