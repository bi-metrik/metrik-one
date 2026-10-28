---
name: reglas-margen-cotizacion
description: Trappvel 2026-10-27 (feat/cotizacion-reglas-margen) — colchón de vuelo, descuento por hotel, 0 % lo demás, puntos extra, descuentos sobre el total y margen global; migración reglas_margen aplicada; SQL de config SIN aplicar
metadata:
  type: project
---

Brief `proyectos/trappvel/clarity/briefs/2026-10-27_brief-max-reglas-de-margen-cotizacion.md`. Núcleo en
`src/lib/cotizaciones/reglas-margen.ts` y `totales.ts › conReglas`. Sin `params.reglas` la cascada es idéntica (C0 verde).

- Migración `20261027150000_cotizaciones_reglas_margen.sql` (columna jsonb) YA aplicada (28-oct). SQL de config
  `sql/trappvel/2026-10-27_reglas-margen-PENDIENTE.sql` (reglas + piso 12/aviso 12) SIN aplicar; va después del deploy. Solo cotizaciones NUEVAS nacen con reglas (se copian al crear); los borradores viejos siguen planos.
- Puntos extra viven en `precioConAdicionales` (por tarifa), NUNCA en `precioLinea` (va a `items.precio_venta`). Toda
  cascada sobre TODAS las opciones usa `paramsPorOpcion` (sin puntos ni descuentos). El PDF toma el precio de cada línea
  de su bloque (`reglasDelDocumento`).
- Descuento de hotel en `%` = puntos de margen (15−3 = 12, como pide el brief); el cliente ve pesos. Comisión de la
  Pública en `tipoTarifa.comisionPct`: con ella entra al margen global; sin ella sale de la base (no aprueba en falso).
- Con reglas el recargo fijo no se ofrece y `aplicarRecargo` lo rechaza.
- `−` (U+2212) no existe en WinAnsi: en @react-pdf usar `–` (gotcha del 2026-10-27).
- 2026-10-28 (fix/margen-global-y-aviso-hotel): el margen que se pinta junto al total y en «Tarifas» sale de UNA
  función, `por-pasos-vista.ts › margenDelEncabezado` (con reglas = global, no `margenRealPct`). Sin tarifas que vayan
  al cliente, «Tarifas» mide el total (`delTotal`). Toda frase de «bajo el mínimo» se arma con `causas-margen.ts`
  (hotel con su opción vs. 10 %, global como siempre); no escribir otra a mano.
- Abierto: hotel con precios de fila a mano no recibe descuento ni puntos; cotizaciones viejas con `piso_margen_pct`
  null pasan a medirse contra 12 tras el SQL; QA en navegador real sin hacer.

**How to apply:** antes de tocar margen/total de viaje, leer `reglas-margen.ts`. Relacionado: [[tarifa-publica-neta]],
[[margen-recargo-configurables-trappvel]], [[pruebas-por-mutacion]].
