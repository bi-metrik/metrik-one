---
name: r1-total-recomendada-adicionales
description: «La cotización no toma el total de su Recomendada» (R1) era falso: la medición por precio_venta omitía item_adicionales; el servidor sí la toma
metadata:
  type: project
---

Riesgo R1 de la cotización integrada (2026-10-12, rama fix/cotizacion-total-recomendada). En una cotización de
Trappvel el `valor_total` parecía no ser el de la Recomendada. Lo era: total de la principal = suma de `precio_venta`
de sus líneas + los adicionales de esas líneas. La medición sumó solo `precio_venta`. Confirmado en producción por
la sesión principal (un adicional de maletas en un vuelo).

**Why:** la cascada cobra `precioConAdicionales`; `items.precio_venta` es solo la línea.

**How to apply:** ante «el total no es el de la tarifa X», antes de tocar código restar los adicionales de sus
líneas; las cifras F2 de los criterios de Vera tienen el mismo sesgo. Prueba (cifras inventadas):
`src/app/(app)/negocios/total-recomendada-adicionales.test.ts`. Sin datos de la cliente en el repo, ni siquiera
totales o el consecutivo: el clasificador negó el push la primera vez por eso. Relacionado:
[[feedback_medir_antes_de_construir]], [[fixture-de-produccion-bloquea-push]].
