---
name: devoluciones-dinero-soe007
description: SOE-007 devolución de dinero — 20261009160000 APLICADA; 20261009210000 (venta reembolsada sale de ventas + indicador de reembolsos) APLICADA; cómo se midió prod sin MCP
metadata:
  type: project
---

**1ª parte (#1091, migración `20261009160000`, aplicada 2026-10-09):** tabla `devoluciones_dinero` + RPC
`registrar_devolucion_dinero` (solo service_role) + vistas `v_devolucion_valor` / `v_recaudo_neto_valor`. Seis RPC de
recaudo leen la vista neta por reemplazo `v_cobro_valor cv` → `v_recaudo_neto_valor cv` sobre `pg_get_functiondef`.

**2ª parte (rama `feat/soe-007-reembolsos-indicadores`, migración `20261009210000`, aplicada 2026-10-09 antes del merge):**
decisión de Mauricio (2026-10-09): devuelto ≥ cobrado → el negocio NO es venta y sale de `v_venta_mes_comercial`,
también del mes cerrado de su venta. Parcial no saca. Indicador `get_reembolsos_mes_soena` (por fecha de devolución,
sin IVA) en Dirección y Comercial. Dry-run `sql/soena/2026-10-09_dry-run_venta-reembolsada.sql`; un test PGlite lo
corre entero con los uuid de SOENA/V0494.

**Why:** la devolución es una salida en su fecha (no anular el cobro); y la venta reembolsada «no generó ingreso».

**How to apply:**
- Una RPC nueva de recaudo por mes lee `v_recaudo_neto_valor`; una de ventas lee `v_venta_mes_comercial` y ya hereda
  la exclusión. «Ingresos primer pago» de Dirección es CAJA: septiembre no cambia; la devolución resta en su mes.
- `v_venta_mes_comercial` es definer (reloptions null): reescribirla con `create or replace` sin WITH está bien, pero
  la migración aborta si algún día trae reloptions. `pg_get_viewdef(oid, true)` de PG17 da el WHERE final como
  `WHERE cn.negocio_id IS NOT NULL OR vz.negocio_id IS NOT NULL;`, igual en PGlite 0.5.8 y en prod (17.6).
- Medir prod (2026-10-09): la Management API `/database/query/read-only` con el `sbp_` de `.credentials.md` PASÓ; corre
  como `supabase_read_only_user`, que NO tiene EXECUTE en las RPC de tablero (42501) pero sí lee vistas, y admite un
  `DO … RAISE EXCEPTION` de solo lectura con `execute format(...)` sobre la definición viva reemplazada: así se simula
  la vista nueva sin crear nada.
- La tasa de cancelación cuenta perdidos por `updated_at`, no por `closed_at` (2 de 13 perdidos de SOENA caen en otro
  mes). No se tocó; es hallazgo para el reporte.
- Límite: un cobro POSTERIOR a una devolución se imputa en tramos como si la plata devuelta siguiera adentro.
