---
name: tableros-cache
description: Caché de 5 min por workspace de las 12 RPC de Tableros/Equipo (#1001, 2026-10-03) — cifras con hasta 5 min de atraso; la guarda se verifica antes de guardar; cómo probar unstable_cache real en vitest
metadata:
  type: project
---

#1001 (`perf/tableros-cache`, sin migración) mete las 12 RPC caras de Tableros/Equipo SOENA en
`unstable_cache` vía `rpcTablero` (`src/lib/tableros/cache-rpc.ts`). Segunda vuelta del plan de
velocidad tras la caída del 2026-10-03; sigue de [[animacion-marca-y-rpc-tableros]].

**Why:** ~13 s de CPU de la base por apertura de `/tableros`. Las RPC dependen solo de
workspace + parámetros (SECURITY DEFINER con guarda `current_user_workspace_id()`).

**How to apply:**
- ⚠️ Tableros y Equipo muestran cifras con **hasta 5 min de atraso** (pagos, etapas). Si alguien
  reporta «no se ve el pago en Tableros», es esto. Metas y política del bono invalidan al guardar
  (`invalidarTablerosWorkspace` → `updateTag`); un escritor NUEVO de algo que lean esas RPC tiene
  que llamarlo también.
- ⚠️ `unstable_cache` es stale-while-revalidate: sin la ventana de 5 min en la llave, la primera
  visita tras horas recibe la cifra de hace horas. No quitar `ventanaActual()`.
- ⚠️ Con service_role la RPC guardada devuelve CEROS, no error. Por eso se pregunta
  `current_user_workspace_id()` antes y después con el mismo cliente; `get_comercial_perfil_soena` no
  lleva `p_workspace_id` y resuelve por sesión: la guarda es lo único que impide guardar datos de B bajo A.
- Probar el `unstable_cache` REAL en vitest: `test/cache-incremental-doble.ts` (pone
  `globalThis.AsyncLocalStorage` y `__incrementalCache`; importarlo ANTES de lo que cargue `next/cache`)
  + `vi.mock('next/cache')` parcial para `updateTag`.
- Para la vuelta de la vista (sin medir aún): `v_venta_mes_comercial` une `v_negocio_bonificable`
  DOS veces (CTE `venta_cero` y join final) y `cobros_neg` agrupa `v_cobro_valor` de TODOS los
  workspaces (el filtro va sobre `n.workspace_id`, no sobre el agrupado). Es vista definer sin grant
  a `authenticated` (server-only): no es fuga.
