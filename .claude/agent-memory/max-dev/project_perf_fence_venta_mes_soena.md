---
name: project-perf-fence-venta-mes-soena
description: Barrera OFFSET 0 sobre v_venta_mes_comercial en las 6 RPC _mes_soena (#978 como 20261001140200 + #982 20261001160000, ambas APLICADAS); pagos sigue lento; la "deriva" eran comentarios borrados
metadata:
  type: project
---

PR #978 (rama perf/fence-venta-mes-soena, 2026-10-01): migracion `20261001140200_perf_fence_venta_mes_soena.sql` (nacio como 20261001140000, chocaba con la de tarifas y se renombro en #977) reescribe kpis, origen, plan_pago y seccional `_mes_soena` leyendo la vista desde `(SELECT * ... WHERE workspace_id = p_workspace_id OFFSET 0)`. SQL aplicado en prod; la fila del ledger va con la version 20261001140200.

PR #982 (rama perf/fence-pagos-ventas-soena, 2026-10-01): `20261001160000_perf_fence_pagos_ventas_soena.sql` cubre ventas y pagos (en pagos la vista entra por LEFT JOIN). APLICADA en prod por la sesion principal (md5 verificados, ledger 20261001160000). Su encabezado cita a #978 con el nombre viejo 20261001140000.

md5(prosrc) en prod: ventas `46a343d8...`, pagos `a9f313d9...` (con comentarios); sin lineas `--`: `50be9f8c...` / `662bdda5...`.

Medido 2026-10-01 (JWT SOENA, 11 meses, salida identica): ventas ~9,7 s -> ~0,15 s por mes; pagos SIN mejora (~2 s/mes). En pagos el costo no es la vista: la consulta suelta con workspace literal tarda ~70 ms; sospecha: el join con `guard` impide empujar el filtro de workspace a `v_cobro_valor`. Pendiente aparte.

**La "deriva" repo-vs-prod que #978 dejo fuera NO era logica:** produccion tenia el cuerpo del repo con las lineas de comentario `--` borradas al aplicar. Comparar md5 quitando lineas `--` antes de concluir que hay deriva.

**Why:** el repo no siempre es fuente de verdad para funciones SQL de ONE (ej. `20260927000001` reescribio `current_date -> public.hoy_bogota()` en kpis via pg_get_functiondef), pero un md5 distinto puede ser solo comentarios.

**How to apply:** antes de reescribir una funcion SQL de ONE, comparar md5(prosrc) de prod contra el cuerpo del repo, con y sin lineas `--`; si no cuadra ninguno, partir de `pg_get_functiondef` (pedirlo a la sesion principal). Copiar cuerpos por script, y probar el cambio revirtiendo la linea nueva y recuperando el md5 base.
