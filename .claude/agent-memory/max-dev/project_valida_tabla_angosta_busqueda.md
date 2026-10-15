---
name: valida-tabla-angosta-busqueda
description: metrik-valida PR #64 (2026-10-15) — entradas_busqueda angosta para buscar_candidatos_por_nombre; 0038/0039 SIN aplicar; poblar antes de 0039; enable_seqscan=off obligatorio; tokens societarios descartados
metadata:
  type: project
---

PR bi-metrik/metrik-valida#64 (rama `perf/entradas-buscables-y-candidatos`), SIN mergear y SIN aplicar al 2026-10-15.
0038 crea `entradas_busqueda` (texto buscable por fila, triggers de sentencia sobre `entradas_lista`) y
`poblar_entradas_busqueda`; 0039 cambia las dos RPC por nombre y aborta si el poblado no termino.
Plan con reversa: `db/maintenance/0038_0039_tabla_angosta_busqueda.sql`.

**Why:** el costo era el rechequeo trigram sobre la fila ancha (raw ~880 B): ~61 k paginas (~480 MB) del heap
tienen alguna fila buscable, contra 320 MB de shared_buffers. Mover el historial NO servia: `matches.entrada_id`
es FK ON DELETE SET NULL y reporte//v/[hash] leen entradas viejas por embed.

**How to apply:**
- Orden en prod: 0038 → `poblar_entradas_busqueda(5000)` hasta 0 → compuerta EXPLAIN → 0039. Fuera de 05:15–05:30 UTC.
- `set enable_seqscan = off` en las RPC NO es decorativo: funcion SQL con SET = plan generico, y sin el texto el planner recorre la tabla angosta entera (la prueba lo exige).
- Excluir tokens societarios («s a s», «ltda»…) en candidatos PIERDE matches: 20 de 441 consultas de empresas, 32 filas. No reintentar.
- El export de entradas de listas a local lo bloquea el clasificador de PII: los barridos van en SQL de solo lectura en prod devolviendo solo conteos y consulta_id (`scratchpad/perf/barrido.sql` de esa sesion).
- Paso 6 opcional pendiente: dropear los 4 GIN trigram de entradas_lista/aliases una semana despues de 0039.
- Relacionado: [[valida-latencia-masiva]].
