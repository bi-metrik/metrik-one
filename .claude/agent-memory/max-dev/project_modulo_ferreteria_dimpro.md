---
name: modulo-ferreteria-dimpro
description: Módulo Ferretería (piloto Marketplace dimpro, PR #905) — migración 20260924235500 SIN aplicar y con escritura de datos; tokens del endpoint sin emitir; una llave de módulo nueva toca TRES listas SQL
metadata:
  type: project
---

PR #905 (rama `feat/ferreteria-dimpro`, 2026-09-24) crea el módulo `ferreteria` para dimpro: 8 tablas
`ferreteria_*`, pantalla `/ferreteria` y endpoint `/api/ferreteria/[recurso]` con `Bearer fer_...`.

⚠️ Al cerrar la sesión: la migración `20260924235500_modulo_ferreteria.sql` **no estaba aplicada** y el PR
**no estaba mergeado**. La migración escribe datos (fila en `workspace_modulos` + `modules.ferreteria`),
así que va ANTES del merge. Ningún token emitido: `scripts/emitir-token-ferreteria.ts ... --apply`.

**Why:** mergear a main despliega al instante; sin la migración la pantalla y el endpoint fallan.

**How to apply:**
- Una llave de módulo nueva exige ampliar `workspace_modulos_modulo`, `catalogo_servicios_modulo` y el
  arreglo de `proyectar_modulos` en la MISMA migración: `catalogo.test.ts` lee la última que los define.
- `authenticated` solo lee `ferreteria_*`; toda escritura pasa por `src/lib/ferreteria/nucleo.ts`
  (service_role). No dar grant de escritura: el piso del precio dejaría de ser obligatorio.
- El endpoint necesita el corte temprano en el middleware (`/api/ferreteria/`): en un subdominio el
  `!user` lo mandaría a `/login` con un 307.
- Las pruebas PGlite no corren con el `node_modules` del repo principal (le falta pglite): se corren con
  un config de vitest en el scratchpad que alias-a pglite instalado aparte. Ver [[indice-referencias]].

**2026-09-24, PR #911 (mergeado):** `GET publicaciones` agregado (catálogo para el cron, cron y agente,
ordenado por código, sin descripción/etiquetas, sin migración). `RECURSOS` en `api.ts` ahora mapea a una
LISTA de métodos: un recurso puede tener GET y POST. Gotcha de bootstrap: el worktree trae
`node_modules/.vite`, así que `rmdir node_modules` falla y `ln -s` crea el symlink ADENTRO; los binarios
resuelven igual por el `node_modules` del padre, el symlink no hace falta para vitest/tsc/next build.

**2026-09-24, margen y foto (sin migración):** `margenPorVenta(ganancia, precio)` y `formatoMargen` en
`reglas.ts` (margen = ganancia / precio, fracción). La tabla NO ordena columnas. Gotcha del React Compiler:
calcular algo con `vigente` ANTES del `useMemo` que lo tiene de dependencia rompe el lint
(`preserve-manual-memoization`); va DESPUÉS.
