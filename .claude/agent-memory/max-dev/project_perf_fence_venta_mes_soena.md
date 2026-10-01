---
name: project-perf-fence-venta-mes-soena
description: PR #978 barrera OFFSET 0 sobre v_venta_mes_comercial en kpis/origen/plan_pago/seccional SOENA; migracion SIN aplicar; pagos y ventas con deriva repo-vs-prod
metadata:
  type: project
---

PR #978 (rama perf/fence-venta-mes-soena, 2026-10-01): migracion `20261001140200_perf_fence_venta_mes_soena.sql` (nacio como 20261001140000, chocaba con la de tarifas y se renombro en #977) reescribe kpis, origen, plan_pago y seccional `_mes_soena` leyendo la vista desde `(SELECT * ... WHERE workspace_id = p_workspace_id OFFSET 0)`. SQL aplicado en prod; la fila del ledger va con la version 20261001140200.

**Deriva repo-vs-prod:** origen, seccional, pagos y ventas `_mes_soena` en produccion NO coinciden con el repo. origen/seccional entraron desde `pg_get_functiondef` de prod (lo paso la sesion principal). pagos y ventas quedaron FUERA: deriva a reconciliar aparte.

**Why:** el repo no es fuente de verdad para funciones SQL de ONE tocadas a mano o por DO dinamico (ej. `20260927000001` reescribio `current_date -> public.hoy_bogota()` en kpis via pg_get_functiondef: el md5 de prod solo cuadra aplicando esa sustitucion al cuerpo del repo).

**How to apply:** antes de reescribir una funcion SQL de ONE, comparar md5(prosrc) de prod contra el repo; si no cuadra, partir de `pg_get_functiondef` (pedirlo a la sesion principal, Max no lee prod en estos encargos).
