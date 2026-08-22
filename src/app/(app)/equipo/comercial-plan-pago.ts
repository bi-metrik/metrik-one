/**
 * El corte del mes por plan de pago, normalizado para la pantalla.
 *
 * Pura y aparte de la server action porque encierra la regla que este frente vino a
 * arreglar, y una regla que decide si una cifra se lee como "no pagó" o como "no aplica"
 * merece pruebas propias:
 *
 *   1. **"Sin declarar" nunca se pliega a plan 2.** `v_negocio_valor` lo hacía con un
 *      `else`, y por eso a un negocio sin plan no podía aparecerle un segundo pago
 *      aunque el dinero entrara.
 *   2. **Los dos planes se muestran siempre**, aunque el mes no tenga ventas de uno.
 *      "Ninguna venta de agosto es 50/50" es un dato; una fila ausente parece un hueco.
 *   3. **Fuera del plan 1, el segundo pago es `null`, no `0`.** En plan 2 el tramo no
 *      existe; sin plan declarado no se sabe si existe. Ninguna de las dos cosas es un
 *      cero medido.
 */

import type { ComercialPlanPagoFila, ComercialPlanPagoMes } from './comercial-types'

/** Fila en cero para un plan que este mes no tuvo ventas. No es lo mismo que faltar. */
export function filaPlanVacia(plan: number | null): ComercialPlanPagoFila {
  return {
    plan_pago: plan,
    ventas: 0,
    valor_sin_iva: 0,
    valor_con_iva: 0,
    primer_pago: 0,
    segundo_pago: plan === 1 ? 0 : null,
    recaudado: 0,
    casos_completos: 0,
    bonificables: null,
    negocio_ids: [],
  }
}

/**
 * Ordena y completa lo que devuelve `get_comercial_plan_pago_mes_soena`.
 *
 * El grupo sin declarar se agrega SOLO si existe: inventarlo cada mes convertiría en
 * ruido el aviso que importa el mes que sí haya negocios sin plan.
 */
export function normalizarCortePlanPago(
  filasCrudas: ComercialPlanPagoFila[],
  totalVentas: number,
): ComercialPlanPagoMes {
  const porPlan = new Map<number | null, ComercialPlanPagoFila>()
  for (const f of filasCrudas) {
    const plan = f.plan_pago === null || f.plan_pago === undefined ? null : Number(f.plan_pago)
    porPlan.set(plan, { ...f, plan_pago: plan, negocio_ids: f.negocio_ids ?? [] })
  }

  const filas: ComercialPlanPagoFila[] = [
    porPlan.get(1) ?? filaPlanVacia(1),
    porPlan.get(2) ?? filaPlanVacia(2),
  ]
  // Un plan que la base devuelva y que no sea 1 ni 2 no se descarta: perder ventas de
  // la tabla es peor que mostrar un plan con nombre inesperado.
  for (const [plan, fila] of porPlan) {
    if (plan !== null && plan !== 1 && plan !== 2) filas.push(fila)
  }
  const sinDeclarar = porPlan.get(null)
  if (sinDeclarar) filas.push(sinDeclarar)

  return { total_ventas: totalVentas, filas }
}
