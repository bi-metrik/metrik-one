---
name: ingresos-wa-one
description: Bot ONE registra ingresos (2026-10-21, feat/wa-ingresos-one) — solo cuotas programadas pendientes, copia de confirmarPagoCobroProgramado con prueba de equivalencia, soporte en cobros.soporte
metadata:
  type: project
---

PR feat/wa-ingresos-one (2026-10-21), sin migración, independiente de #1230 (los dos tocan `one/dominio.ts`,
`one/reglamento.ts` y suben la versión a 3: el que se mergee segundo resuelve y sube a 4).

**Why:** Mauricio «dale con los ingresos»; caso real Dimpro $400.000 propuesto como gasto.

**How to apply:**
- Solo marca CUOTAS PROGRAMADAS pendientes (`tipo_cobro = 'programado'`, sin fecha). Un pago no programado NO tiene un
  camino común en la app (el anticipo es por modelo SOENA/bloques), por eso el bot lo manda a la app.
- La escritura es `_shared/confirmar-cobro-programado.ts`, copia de `src/lib/cobros/confirmar-cobro-programado.ts`;
  `src/lib/cobros/confirmar-cobro-programado-copia.test.ts` exige las mismas consultas. Cambiar una = cambiar la otra.
- No se pone `fuente` (la manual no la pone y la leen las reglas de anulación).
- Parcial = confirmar la cuota con el monto real (como la pasarela); el faltante NO quedó verificado en `cuotasConEstado`.
Relacionado: [[bandeja-adjuntos-trappvel]], [[wa-soporte-pdf-agente]].
