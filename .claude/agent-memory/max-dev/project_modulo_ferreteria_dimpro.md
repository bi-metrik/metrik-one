---
name: modulo-ferreteria-dimpro
description: Módulo Ferretería (piloto Marketplace dimpro) — #917 ventas→negocio con migración SIN aplicar (escribe datos); liquidación mensual 50/50; una llave de módulo nueva toca TRES listas SQL
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
`reglas.ts` (margen = ganancia / precio, fracción). Gotcha del React Compiler: calcular algo con `vigente`
ANTES del `useMemo` que lo tiene de dependencia rompe el lint (`preserve-manual-memoization`); va DESPUÉS.
Orden por columna llegó en #916 (`orden.ts` + `orden-tabla.tsx`).

**2026-09-24, PR #917 (SIN mergear, migración `20260925120000` SIN aplicar, escribe datos):** cada venta
es un negocio de ONE en la línea Ferretería de dimpro (Vendido→Entregado→Pagado, etapas marcadas por
`config_extra.ferreteria_paso`). El negocio sale por las acciones de la app vía `negocios-puerto.ts`
(crearNegocio, cambiarEtapaNegocioConGate, completarNegocio, registrarPagoEnNegocio, agregarResponsable).
La parte de MeTRIK es MENSUAL, no por venta (Mauricio: 50/50 con signo, sin piso, sin arrastre; negativa =
MeTRIK aporta a Dimpro) — `liquidacion.ts`. Abierto con Mauricio: el mes sale de `fecha_venta`, no del pago.
- dimpro tiene `business` (= Clarity) pero no `clarity` como llave: `REQUISITO.clarity` mira `business`.
- `cambiarEtapaNegocioConGate` solo escribe `activity_log` si hay `staffId`; el soporte de MeTRIK en dimpro
  no tiene staff activo, así que sus avances no dejan fila (un UPDATE por SQL tampoco: no hay trigger).
