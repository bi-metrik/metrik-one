---
name: cartera-vencido-por-cuota
description: PR #934 (2026-09-27) — v_cartera_negocio separa vencido/por vencer en negocios con cuotas; migración SIN aplicar al abrir el PR; wa-alerts y wa-webhook a redesplegar
metadata:
  type: project
---

PR #934: `v_cartera_negocio` gana `con_cronograma, saldo_vencido, saldo_por_vencer, dias_mora`
(migración `20260927120000_cartera_vencido_por_cuota.sql`). Detonante: la alerta W25 decía que
ALMA (A1 26 1) debía $3,6M vencidos a 159 días; era una cuota de $400k con 12 días de mora.

**Why:** la vista contaba vencido = todo el saldo pasados 30 días desde la creación del negocio.

**How to apply:**
- Migración ANTES del merge (los selects piden las columnas nuevas; sin ellas 42703 → cartera $0).
  Después: redesplegar `wa-alerts` y `wa-webhook`.
- "Con cronograma" = algún cobro `tipo_cobro='programado'` sin anular, NO `planes_cobro.activo`
  (W1 26 1 tiene programados sin plan; ALMA tiene plan sin filas en `plan_cobro_cuotas`).
- `cobros.vencido` es pegajoso (no se apaga al pagar): lo que manda es `fecha IS NULL`.
- El `monto` de las cuotas pendientes se muta con pagos parciales: «esperado acumulado − recaudado»
  da otra cifra (A1 26 2: 40k vs 370k). Se usa la suma de cuotas impagas.
- S1 26 2: honorario 12,5M pero el plan solo agenda 10,5M; los 2M sin cuota salen como «por vencer».
- node_modules de la torre está desactualizado (sin pglite): los `*-sql.test.ts` y export-excel fallan
  en local pero pasan en CI.
