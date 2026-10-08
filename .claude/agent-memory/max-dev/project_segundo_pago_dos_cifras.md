---
name: segundo-pago-dos-cifras
description: SOE-002 (2026-10-08) — el segundo pago de SOENA son dos cifras con nombre (caja por fecha de pago / cohorte por mes de venta) de una RPC nueva; umbral de migajas $1.000; migración SIN aplicar al abrir el PR
metadata:
  type: project
---

`get_segundo_pago_mes_soena(ws, anio, mes)` (migración `20261008163000`) es la ÚNICA fuente de las
dos cifras de segundo pago en Dirección y Comercial. **Migración SIN aplicar** al abrir el PR: la
aplica la sesión principal ANTES del merge (el front la llama; sin ella Dirección cae a la cifra
vieja y el KPI de caja del Comercial no se pinta). Dry-run en `sql/soena/2026-10-08_dry-run_segundo-pago-dos-cifras.sql`.

**Why:** Dirección (`get_directivo_soena`, caja) y Comercial (`v_venta_mes_comercial.segundo_pago`,
cohorte) decían "segundo pago" y daban $2.053.118 vs $29 en sep-2026. Los $29 eran el sobrante de
V0294 que la imputación de `v_cobro_valor` manda a tramo 2 (también V0103 $10, V0447 $3).

**How to apply:**
- No se reescribieron las RPC vivas a propósito: `get_directivo_soena` ya fue reescrita por
  reemplazo de texto en prod (20261007184500) y el subagente no tiene `pg_get_functiondef`. Las
  RPC viejas siguen sumando migajas (serie mensual/seccional/vendedor, kpis, plan_pago,
  seccional); la pantalla sobreescribe sus `segundo_pago` desde la lista de la RPC nueva.
- La serie "Primer vs segundo pago recibido por mes" es caja y NO aplica el umbral (rotulado).
- Umbral: por COBRO en caja, por NEGOCIO (acumulado) en cohorte. Constante en el CTE `parametros`,
  viaja como `umbral_migaja`.
- Ventas totales de Dirección = 1er pago + recibido con umbral (baja $32 en sep vs la RPC).
- En esta sesión: Management API bloqueada y la 2ª lectura PostgREST (`v_venta_mes_comercial`)
  negada [Production Reads]; la caja se re-midió al peso con `v_cobro_valor`, la cohorte no.
