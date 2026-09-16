/**
 * Cálculo de los dos planes de la propuesta económica, en un solo lugar.
 *
 * Vivía como helper interno de `propuesta-economica-actions.ts`. Salió de ahí cuando la
 * inicialización de la v1 dejó ese archivo (ver `v1-automatica.ts`): las dos tienen que
 * calcular con la MISMA fórmula, y una copia se desincroniza con el primer ajuste.
 *
 * Puro: no toca DB ni red. Fuera del archivo `'use server'` porque ahí todo export tiene
 * que ser async.
 */

export type CalculoPropuesta = {
  base: number
  plan1_valor: number       // base * (1 - desc1)
  plan1_anticipo: number    // 50% Plan 1
  plan1_exito_iva: number   // 50% Plan 1
  plan2_valor: number       // base * (1 - desc2)
  ahorro_plan1: number      // base - plan1 (vs tarifa plena)
  ahorro_plan2: number      // base - plan2 (vs tarifa plena)
  descuento_pct_plan1: number
  descuento_pct_plan2: number
}

export function calcularPropuesta(
  precioBaseConIva: number,
  descuentoPctPlan1: number,
  descuentoPctPlan2: number,
): CalculoPropuesta {
  const base = Math.round(precioBaseConIva)
  const plan1 = Math.round(base * (1 - descuentoPctPlan1 / 100))
  const plan2 = Math.round(base * (1 - descuentoPctPlan2 / 100))
  return {
    base,
    plan1_valor: plan1,
    plan1_anticipo: Math.round(plan1 / 2),
    plan1_exito_iva: Math.round(plan1 / 2),
    plan2_valor: plan2,
    ahorro_plan1: base - plan1,
    ahorro_plan2: base - plan2,
    descuento_pct_plan1: descuentoPctPlan1,
    descuento_pct_plan2: descuentoPctPlan2,
  }
}
