---
name: project-perf-fence-venta-mes-soena
description: PR #978 barrera OFFSET 0 sobre v_venta_mes_comercial en 4 RPC Comercial SOENA; migracion SIN aplicar; origen y seccional con deriva repo-vs-prod
metadata:
  type: project
---

PR #978 (rama perf/fence-venta-mes-soena, 2026-10-01): migracion `20261001140000_perf_fence_venta_mes_soena.sql` reescribe kpis, plan_pago, pagos y ventas `_mes_soena` leyendo la vista desde `(SELECT * ... WHERE workspace_id = p_workspace_id OFFSET 0)`. SIN aplicar ni mergear (la aplica la sesion principal).

**Deriva detectada:** `get_comercial_origen_mes_soena` y `get_comercial_seccional_mes_soena` en produccion NO coinciden con ninguna version del repo (md5 de prosrc). Quedaron fuera; hay que partir de `pg_get_functiondef`.

**Why:** el brief exige copiar desde el cuerpo vivo verificado por md5; el repo no es fuente de verdad para funciones tocadas a mano o por DO dinamico (ej. `20260927000001` reescribio `current_date -> public.hoy_bogota()` en kpis via pg_get_functiondef: el md5 de prod solo cuadra aplicando esa sustitucion al cuerpo del repo).

**How to apply:** antes de reescribir una funcion SQL de ONE, comparar md5(prosrc) contra el repo y buscar DO que reescriban por pg_get_functiondef. En pagos la barrera asume que el negocio de cada cobro es del mismo workspace (query de chequeo en el PR).
