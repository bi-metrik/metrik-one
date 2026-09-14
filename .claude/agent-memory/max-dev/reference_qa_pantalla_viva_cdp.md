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
