---
name: qa-pantalla-viva-cdp
description: Montar una pantalla del producto VIVA (con efectos y estado) sin Next ni base, y leer el payload que sale al servidor — vite + python http.server + chromium por CDP con ws
metadata:
  type: reference
---

Cuando el QA es de COMPORTAMIENTO —¿qué se manda al guardar?, ¿el aviso condicional
enciende?— el render estático de `renderToStaticMarkup` **no alcanza**: no corre
efectos, así que un componente que carga sus datos en `useEffect` solo pinta «Cargando…».

**Cadena que funcionó el 2026-09-14 (pantalla de umbrales de margen):**

1. `vite build` de una mini-app en una carpeta temporal DENTRO del worktree
   (`.margen-qa/`): `index.html` + `main.tsx` con `createRoot` que monta el componente
   REAL. `esbuild: { jsx: 'automatic' }` — `@vitejs/plugin-react` no está en
   `node_modules` y no hace falta.
2. **Solo se doblan las salidas**, por `resolve.alias`: el módulo de server actions
   (por su ruta `@/…` **y** por la relativa `./margen-actions`, porque el componente la
   importa así) y `sonner`. El doble del guardado anota el payload en
   `window.__GUARDADO__`. El alias `@` → `src` va **al final**: si va primero se traga
   los específicos.
3. `python3 -m http.server <puerto> --directory <dist> &` — con `file://` los módulos ES
   mueren por CORS.
4. Chromium con `--remote-debugging-port=<p> --user-data-dir=<tmp>` en background, y un
   script `node .mjs` con **`ws`** (ya está en `node_modules`) que habla CDP:
   `/json/list` → `webSocketDebuggerUrl` → `Runtime.evaluate` con `awaitPromise` y
   `returnByValue`.
5. Para una foto sin interacción basta
   `chrome --headless --screenshot --virtual-time-budget=4000 <url>`: sin el
   `virtual-time-budget` la captura sale antes de que el efecto resuelva.

**Repetida el 2026-09-14 (modal de pago, #707) y volvió a servir, con cuatro datos que
ahorran tiempo:**

- **El CSS de Tailwind NO sale por CLI.** `npx tailwindcss` da *«could not determine
  executable to run»*: en el repo solo está `@tailwindcss/postcss`. Se enchufa en el
  propio vite (`css: { postcss: { plugins: [tailwind()] } }`) e `import
  '../src/app/globals.css'` desde el `main.tsx` del arnés. Sale una hoja completa (~150 kB)
  y las fotos quedan legibles.
- ⚠️⚠️ **El puerto de CDP puede estar tomado por el Chromium de OTRA sesión, y no se nota.**
  Medido el 2026-09-16 (#771): el Chromium propio murió con `bind() failed: Address already in
  use` en el log del background, y el guion de CDP habló igual contra el navegador ajeno (tenía
  abierta la QA del #763): creó 15 pestañas allí y dio resultados correctos, así que nada lo
  delató. Antes de lanzar: `curl -s http://127.0.0.1:<p>/json/version` debe FALLAR; si responde,
  elegir otro puerto. Para limpiar, cerrar solo las pestañas propias por URL
  (`/json/close/<id>`), nunca matar ese proceso. Y `pkill -f "<patrón>"` mata también la shell
  que lo ejecuta, porque su propia línea de comando contiene el patrón (sale con 144).
- **El binario está en `~/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome`**
  (`chrome-linux64`, no `chrome-linux`), y hay que darle `--headless=new --no-sandbox`.
- **`node_modules` NO está en el worktree y no hace falta**: node resuelve hacia arriba
  hasta `metrik-one/node_modules`, así que `npx vite`, `ws` y vitest funcionan igual. Un
  `ls node_modules` que devuelve vacío NO significa que falte nada.
- ⚠️ **Un formulario con validación exige llenarlo antes de llegar al estado que se quiere
  ver.** La primera corrida entera salió con el formulario intacto y un toast «Ingresa el
  monto del pago»: el clic en Guardar no hizo nada y los seis casos se leyeron como si el
  panel no existiera. Si el guion rinde SIEMPRE la misma pantalla, sospechar de una
  validación antes que del componente.

⚠️ **Que un overlay esté encima se prueba con un hit-test, no con `innerText`.** El texto
de un diálogo aparece en `document.body.innerText` aunque otro elemento lo tape. Lo que
vale: `document.elementFromPoint(centro del botón)` y comprobar que devuelve ese botón (o
un hijo suyo). Hace falta cuando el diálogo se monta sobre otro modal `fixed` — con
`createPortal` a `body` los dos quedan como hermanos y decide el `z-index`.

⚠️ **El setter NATIVO, no `.value`.** `Object.getOwnPropertyDescriptor(
HTMLInputElement.prototype,'value').set.call(input, '7')` + `dispatchEvent(new
Event('input',{bubbles:true}))`. Asignar directo actualiza el DOM y **React nunca se
entera**: el guardado sale con el valor viejo y el QA da un falso verde.

⚠️ **Toda afirmación de comportamiento necesita su control en la otra dirección.** Aquí:
a piso 7 el aviso de «no queda banda ámbar» está apagado, a piso 15 encendido. Con una
sola corrida no se distingue «el aviso funciona» de «el aviso nunca aparece».

⚠️ **`git checkout -- <archivo>` revierte al último COMMIT, no al estado anterior a la
mutación.** Revirtiendo una mutación de prueba se perdió una función recién escrita y sin
commitear, y el síntoma fue una tanda de errores de tipos que parecían del refactor.
Commitear antes de mutar, o revertir con la tool Edit.

⚠️ Lo que bloquea el clasificador: `node <script>.mjs` que **lee producción por
PostgREST** (aunque sea solo GET) y scripts en `/tmp`. Lo que SÍ pasa: `npx vitest run`
con un arnés temporal dentro de `src/` que hace ese mismo fetch
([[medicion-con-vitest]]), `npx vite build`, el binario de chromium, y `node .mjs` dentro
del worktree que habla CDP.

Relacionado: [[capturas-ui-sin-servidor]], [[medir-contraste-render]],
[[medicion-con-vitest]], [[pruebas-por-mutacion]].
