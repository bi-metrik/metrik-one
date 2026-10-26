---
name: rc3-desde-comprobante-upme
description: "SOE-029 (#1276, 26-oct): el RC-3 es UNO por negocio, valor = comprobante_pago_upme.valor_pagado − lo ya acusado, colgado del pago que completa la tarifa; sin comprobante bloquea"
metadata:
  type: project
---

PR **#1276**, rama `fix/soe029-rc3-valor-comprobante-upme`. Sin migración. Regla pura en
`src/lib/siigo/rc3-negocio.ts`, lectura en `rc3-negocio-servidor.ts`. La usan la acción
de Tesorería, `emitirReciboDeCobro` (y por eso también el recibo automático) y el panel.

**Why:** Mauricio, 2026-10-26: «que salga del comprobante UPME». Era lo pactado con SOENA
el 2026-08-07. Antes, `a_tarifa` por pago daba cifras de tarifa confirmada (V0572) y
pedazos (V0633: $45 + $701.767).

**How to apply:**
- ⚠️ El valor ya NO sale de `a_tarifa`. `a_tarifa` solo dice si el pago trae tarifa y
  cuándo se completa. Meta = `min(comprobante, techo_tarifa)` con un piso de $1.000. Sin
  el techo, un comprobante mayor que la tarifa confirmada no se completaría nunca.
- Lo «resuelto» incluye tres cosas: los RC-3 emitidos, la `a_tarifa` de pagos con recibo
  por el TOTAL y la de pagos `recibo_no_aplica`. Si alguien pregunta por qué el valor
  nuevo es menor que «comprobante − RC-3», es por esas dos últimas.
- Los pagos que no son titulares salen como `no_aplica` en el panel, con motivo, no como
  pendientes.
- Las pruebas que emiten pasante mockean `./rc3-negocio-servidor` como passthrough de
  `a_tarifa` (`recibo-por-concepto`, `abono-factura`). Un test nuevo que emita RC-3 tiene
  que hacer lo mismo o sembrar `v_negocio_valor` y `negocio_bloques`.
- El SELECT de impacto está en el cuerpo del PR, solo se ensayó en PGlite.

Relacionado: [[recibo-por-concepto]], [[tarifa-upme-mal-digitada]].
