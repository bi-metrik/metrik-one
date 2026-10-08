---
name: segundo-pago-dos-cifras
description: SOE-002 (2026-10-08) — el segundo pago de SOENA son dos cifras con nombre (caja / cohorte) de get_segundo_pago_mes_soena (APLICADA); la serie resta sobrantes con get_segundo_pago_sobrantes_soena (SIN aplicar); umbral $1.000 en DOS funciones
metadata:
  type: project
---

`get_segundo_pago_mes_soena(ws, anio, mes)` (migración `20261008163000`, APLICADA y mergeada en
#1078) es la ÚNICA fuente de las dos cifras de segundo pago en Dirección y Comercial.

Segunda parte (rama `soe-002-equipo-serie`): `get_segundo_pago_sobrantes_soena(ws)` (migración
`20261008193000`, **SIN aplicar al abrir el PR**) lista los abonos a tramo 2 < $1.000 cobro por
cobro; `sinSobrantes` (src/lib/tableros/segundo-pago.ts) los resta en `tableros/page.tsx` de la
serie total (por mes) y de las series por vendedor/seccional (por `cobro_ids`). Sin la función,
la serie va como antes y la nota de la gráfica lo dice (`umbral_sobrantes` ausente). Dry-run en
`sql/soena/2026-10-08_dry-run_segundo-pago-sobrantes.sql` (control: barra limpia = panel).

**Why:** Dirección (caja) y Comercial (cohorte) decían "segundo pago" y daban $2.053.118 vs $29 en
sep-2026. Los $29 eran el sobrante de V0294 que la imputación de `v_cobro_valor` manda a tramo 2
(también V0103 $10, V0447 $3).

**How to apply:**
- Las RPC vivas NO se reescriben (divergen del repo); se crean funciones nuevas y la pantalla
  corrige. Las viejas siguen sumando migajas (kpis, plan_pago, seccional, series).
- ⚠️ La constante $1.000 vive en el CTE `parametros` de LAS DOS funciones: si cambia, cambian ambas.
- Umbral: por COBRO en caja y en la serie, por NEGOCIO (acumulado) en cohorte.
- /equipo NO pinta segundo pago (ni tarjeta, ni perfil, ni VentasDrawer): el brief del 8-oct
  asumía lo contrario. Solo se rotularon los tipos de `segundo_pago` de kpis/porVendedor.
- Medición: la lectura PostgREST de `v_cobro_valor` con la service key pasó el 8-oct (2 sesiones).
