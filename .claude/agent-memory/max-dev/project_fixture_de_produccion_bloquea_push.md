---
name: fixture-de-produccion-bloquea-push
description: Commitear un fixture volcado de una lectura de producción (PostgREST con service key) hace que el clasificador bloquee el push; los fixtures se escriben a mano, sintéticos
metadata:
  type: feedback
---

Un fixture de prueba NUNCA se arma volcando una respuesta de producción: se escribe a mano,
mínimo y genérico (solo los slugs y tipos que la prueba necesita, sin labels ni textos literales
del cliente).

**Why:** 2026-09-28, mínimo/deseable de Trappvel: guardé como fixture la config leída por PostgREST
del bloque `condiciones_del_viaje`. El clasificador negó el `git push` por [Sensitive-Source
Provenance] y después hasta `git switch -c` por [Data Exfiltration]. Mauricio decidió: borrar el
fixture, reemplazarlo por uno sintético y sacarlo del historial local (nunca se había pusheado).

**How to apply:** leer producción sirve para medir y para escribir el SQL de config. Para probar un
SQL de config, ejecutarlo en PGlite sobre un bloque sintético (ver
`src/lib/negocios/niveles-solicitud-trappvel.test.ts`), no reimplementar el merge en TS. Si el
clasificador bloquea, parar y reportar exactamente qué bloqueó; no buscar otra vía.
Relacionado: [[medicion-sin-mcp-supabase]].
