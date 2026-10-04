---
name: lista-negocios-paginada
description: /negocios dejó de mandar la lista entera (2026-10-03, perf/lista-negocios-liviana) — el servidor filtra/cuenta y viajan 30 tarjetas; Content-Location rompe los .in() grandes desde Node
metadata:
  type: project
---

`/negocios` se resuelve en el servidor desde el 2026-10-03 (`lib/negocios/vista-lista.ts`, puro; carga en
`cargar-vista-lista.ts`; `GET /api/negocios/lista`). Medido SOENA: props de 773 KB → 42 KB (br 75 → 7 KB).

**Decisiones no obvias:**
- Los cerrados se leen SIEMPRE en el servidor (39 en SOENA): pasarlos a «por demanda» solo ahorraba ~8 %,
  y los contadores, «Todos» y el aviso de coincidencias los necesitan. Lo que se recortó fue el viaje.
- El Excel/Drive ya no recibe los ids del cliente: el botón pide `?solo=ids` con los filtros de la URL.
- Cada filtro = una ida al servidor (antes era local e instantáneo). Si Mauricio dice que filtrar «se
  siente lento», el siguiente paso es cachear el universo por ws unos segundos, no volver a mandarlo.
- Tras una server action (`revalidatePath('/negocios')`) el cliente ADOPTA la vista nueva en render:
  refresca el comienzo y conserva la cola hasta que vuelve la relectura `desde=0&cuantos=<cargadas>`
  (tope 200 en `rangoDePagina`). No la encoge a 30: el scroll saltaba.
- `getNegociosV2` y `getEtapasSegmentador` LANZAN ante un error de Supabase (desde la revisión de
  #1004). Un caller nuevo que esperaba `[]` tiene que atrapar; el export ya devolvía 500.
- ⚠️ Operator con `staffId` null ve TODOS los negocios (`if (role === 'operator' && staffId)`).
  NO se cerró: medido el 2026-10-03, 2 operators de alma-afi sin staff (se autocrea al entrar,
  así que en tiempo de ejecución casi nunca es null). Decidir con Mauricio antes de fallar cerrado.

**Gotcha medido:** PostgREST devuelve la query en `Content-Location`; con 466 uuid son 18 KB y el fetch de
Node corta en 16 KB → `{ error }` que `?? []` vuelve vacío. Desde la torre los costos de la lista daban 0
y la consulta de citas lanzaba. NO verificado si en Vercel pasa igual (¿límite de cabecera mayor?).

**Why:** la página se cortaba siempre en el mismo byte con la red de Claro; criterio de producto de
Mauricio: «funcionar inmediato y en baja conectividad».

**How to apply:** un campo nuevo de la tarjeta va en `DEFECTOS_TARJETA` (si no, no viaja); un filtro nuevo
va en `ParametrosLista` + `leerParametrosLista` + `aplicarFiltros`. Las pruebas de render arman props con
`test/props-lista-negocios.ts`. Relacionado: [[recuperacion-red-iphone]], [[techo-postgrest-1000-filas]].
