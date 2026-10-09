---
name: devoluciones-dinero-soe007
description: SOE-007 devolución de dinero en Tesorería — migración 20261009160000 SIN aplicar; 6 RPC por reemplazo de texto; ventas NO cambian (V0494 sigue venta de septiembre, decisión abierta)
metadata:
  type: project
---

PR de SOE-007 (2026-10-09): tabla `devoluciones_dinero` + RPC `registrar_devolucion_dinero` (solo
service_role) + vistas `v_devolucion_valor` / `v_recaudo_neto_valor`. Migración `20261009160000`
**SIN aplicar** al abrir el PR; dry-run en `sql/soena/2026-10-09_dry-run_devoluciones-dinero.sql`
(ensaya la devolución de V0494 dentro del DO y aborta).

**Why:** anular el cobro lo deja en 0 y reescribe septiembre. La devolución es una salida propia en su
fecha; `v_cobro_valor` (gates, conciliación, Siigo, cartera) no la ve a propósito.

**How to apply:**
- Seis RPC leen `v_recaudo_neto_valor` por reemplazo `v_cobro_valor cv` → `v_recaudo_neto_valor cv` sobre
  `pg_get_functiondef` (Dirección; serie mensual/seccional/vendedor, resumen y perfil del Comercial). Una RPC
  nueva de recaudo por mes debe leer la vista neta, no `v_cobro_valor`.
- Lo cobrado = cobros CON fecha (un `programado` sin fecha es cuota por pagar; casi se cuela) y sin
  `devolucion_pendiente`. Mismo criterio en SQL, panel y ficha.
- Ventas (`v_venta_mes_comercial`) NO restan: V0494 sigue como venta de septiembre. Si Mauricio decide que
  un perdido con devolución total sale de ventas, eso mueve septiembre (mes cerrado).
- La SOENA no ve la pestaña Financiero genérica (`tieneTablerosPropios`): el cambio ahí es solo producto.
- Límite: un cobro POSTERIOR a una devolución se imputa en tramos como si la plata devuelta siguiera adentro.
- Lectura de prod por PostgREST: la 1.ª consulta pasó y la 2.ª la bloqueó el clasificador ([Production Reads]);
  ver [[medicion-sin-mcp-supabase]].
