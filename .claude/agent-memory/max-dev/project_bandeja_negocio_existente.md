---
name: bandeja-negocio-existente
description: La bandeja WA carga en un negocio existente (2026-09-30) — migración 20260930100000 SIN aplicar, conflicto en `_conflictos`, y cómo se prueba el ejecutor Deno con vitest
metadata:
  type: project
---

PR `feat/bandeja-wa-negocio-existente` (2026-09-30), SIN mergear: trae migración. Orden:
`20260930100000` → merge + deploy `wa-alerts` y `wa-webhook`. La migración redefine el cron
`wa-bandeja-entendimiento` (inocuo antes del deploy). La llave `bandeja_solicitudes_wa` sigue apagada.

**Why:** la segunda y tercera conversación con el cliente (donde se completa la solicitud) no tenían
dónde caer: el bot siempre creaba negocio nuevo.

**How to apply:**
- El conflicto vive en `data._conflictos[slug]`, NO en `_sugeridos`: meterlo ahí hacía que «Confirmar»
  confirmara el valor VIEJO. «Usar» es una edición normal (pasa por guards y corrección); el servidor
  suelta la marca al cambiar el valor (`soltarConflictosEditados`, en los dos caminos de guardado).
- En negocio existente el `default` cuenta como valor (a diferencia de `fusionarSugeridos`).
- «Sin negocios abiertos → solo NUEVO» solo pasa si la LÍNEA no tiene abiertos: el remitente sin
  negocios propios ve los de todos (así lo pide el brief).
- ⚠️ El ejecutor `wa-entendimiento.ts` SÍ se prueba en vitest: definir `globalThis.Deno` antes de un
  `await import(...)`, `vi.mock('./wa-respond.ts')`, `vi.stubGlobal('fetch')` y una base en memoria
  que aplica filtros (`wa-carga-ejecucion.test.ts`). Corrige [[probar-handler-wa-bot]] para módulos
  cuyo único problema es `Deno.env` al cargarse.
- Un test en `src/` NO puede importar un módulo de `_shared` que importe con `.ts` (tsc TS5097):
  comparar por texto, como hace la paridad de niveles.
Relacionado: [[entendimiento-bandeja-wa]], [[bandeja-wa-solicitudes]].
