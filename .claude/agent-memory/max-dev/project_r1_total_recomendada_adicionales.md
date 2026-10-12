---
name: r1-total-recomendada-adicionales
description: COT-2026-0025 "no tomaba la Recomendada" era falso: la medición por precio_venta omitía item_adicionales (1.882.352); el servidor sí la toma
metadata:
  type: project
---

Riesgo R1 de la cotización integrada (2026-10-12, rama fix/cotizacion-total-recomendada). El servidor SÍ escribe el
total de la Recomendada en COT-0025: 22.213.630 = 20.331.278 (suma de `precio_venta` de la Recomendada) +
1.882.352 de adicionales (1.600.000 de costo al 15 % sobre venta). Reproducido al peso con el caso fijo de C0 sin
actividades + 8 maletas de 200.000 en un vuelo (los de prod no se leyeron: brief prohibía leer por fuera de un SELECT pedido).

**Why:** la sesión principal midió las tarifas sumando `items.precio_venta`; la cascada cobra `precioConAdicionales`.
La cifra del 2026-10-09 (19.837.166) además dejaba fuera ≈ un traslado (494.112).

**How to apply:** ante «el total no es el de la tarifa X», antes de tocar código restar los adicionales de sus
líneas; las cifras de F2 de los criterios de Vera (COT-0012 ≈ 4.036.236) tienen el mismo sesgo. Prueba:
`src/app/(app)/negocios/total-recomendada-adicionales.test.ts`. Relacionado: [[feedback_medir_antes_de_construir]].
