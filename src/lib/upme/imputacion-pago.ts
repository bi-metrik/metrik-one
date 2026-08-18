/**
 * Como se imputa UN pago: honorario primero, despues la tarifa.
 *
 * ── La regla, y por que ────────────────────────────────────────────────────
 *
 * Decision de Mauricio (2026-08-18): **primero honorario, siempre. Sin eso no detona lo
 * demas.** El cliente contrata un servicio; la tarifa UPME es plata de terceros que
 * SOENA recauda y gira. Si un pago se aplicara primero a la tarifa, un cliente podria
 * tener la tarifa cubierta y el honorario en cero, es decir el proceso arrancado sin
 * que el servicio este pago.
 *
 * ⚠️ **Esto invierte lo que hacia `repartirPagoTarifaHonorario`**, que cubria la tarifa
 * primero. Habia DOS reglas conviviendo sobre la misma plata: el motor imputaba tarifa
 * primero y la vista del P&L (`v_cobro_valor`) imputaba en escalones honorario, tarifa,
 * honorario. Medido sobre los 111 cobros de SOENA el 2026-08-18, la diferencia era de
 * **$24,7M**: la regla vieja llamaba tarifa a $53,3M y la vista a $28,4M. Este modulo
 * adopta la de la vista, que es la que Mauricio confirmo, para que quede UNA sola.
 *
 * ── Los escalones ──────────────────────────────────────────────────────────
 *
 * Son los mismos tres de `v_negocio_valor`, en este orden:
 *
 *   1. **tramo1** = el honorario que el plan exige por adelantado (plan 1 = mitad,
 *      plan 2 = todo).
 *   2. **tarifa**  = la tarifa UPME confirmada (pasante).
 *   3. **tramo2**  = el resto del honorario (plan 1 = la otra mitad, plan 2 = nada).
 *
 * Lo que pase de los tres es `excedente`: un sobrepago, que no es ingreso ni es tarifa.
 * La vista lo cuenta como recaudo de terceros y aqui se reporta aparte para que el
 * caller no lo confunda con honorario.
 *
 * Puro: no toca DB ni red.
 */

/** Los tres escalones de un negocio, en el orden en que se llenan. */
export interface EscalonesNegocio {
  /** Honorario exigido por adelantado segun el plan. */
  techoTramo1: number
  /** Tarifa UPME confirmada (pasante). 0 si no se confirmo o no se contrato. */
  techoTarifa: number
  /** Resto del honorario. 0 en pago unico. */
  techoTramo2: number
}

export interface ImputacionPago {
  /** Honorario del anticipo. */
  a_tramo1: number
  /** Tarifa UPME (pasante). */
  a_tarifa: number
  /** Resto del honorario. */
  a_tramo2: number
  /** Lo que sobra despues de cubrir los tres escalones. */
  excedente: number
  /** Atajo para quien solo necesita las dos bolsas: `a_tramo1 + a_tramo2 + excedente`. */
  honorario: number
  /** Atajo: igual a `a_tarifa`. Es lo que va al cobro `tipo_cobro='pasante'`. */
  pasante: number
}

/**
 * Los escalones de un negocio a partir de su precio y su plan.
 *
 * Espeja `v_negocio_valor`: plan 1 parte el honorario por la mitad, cualquier otro plan
 * (o ninguno) lo exige completo por adelantado.
 */
export function escalonesDelNegocio(
  precioHonorario: number,
  tarifaUpme: number,
  plan: 1 | 2 | null,
): EscalonesNegocio {
  const precio = num(precioHonorario)
  const tarifa = num(tarifaUpme)
  if (plan === 1) {
    const mitad = precio / 2
    return { techoTramo1: mitad, techoTarifa: tarifa, techoTramo2: precio - mitad }
  }
  return { techoTramo1: precio, techoTarifa: tarifa, techoTramo2: 0 }
}

/**
 * Imputa un pago sobre los escalones, contando lo que el negocio ya cubrio antes.
 *
 * `consumidoAntes` es la suma de lo ya recaudado del negocio: sin eso, el segundo pago
 * se imputaria como si fuera el primero y volveria a llenar el tramo1 que ya estaba
 * cubierto. Es el mismo `consumido_antes` de `v_cobro_valor`.
 *
 * Sin barreras: nunca rechaza ni lanza. Un pago mayor a todo lo que el negocio debe
 * deja el resto en `excedente`, que es lo que la conciliacion tiene que resolver.
 */
export function imputarPago(input: {
  pago: number
  escalones: EscalonesNegocio
  consumidoAntes?: number
}): ImputacionPago {
  const pago = num(input.pago)
  const desde = num(input.consumidoAntes)
  const hasta = desde + pago

  const t1 = num(input.escalones.techoTramo1)
  const tf = num(input.escalones.techoTarifa)
  const t2 = num(input.escalones.techoTramo2)

  const finTramo1 = t1
  const finTarifa = t1 + tf
  const finTramo2 = t1 + tf + t2

  const aTramo1 = solape(desde, hasta, 0, finTramo1)
  const aTarifa = solape(desde, hasta, finTramo1, finTarifa)
  const aTramo2 = solape(desde, hasta, finTarifa, finTramo2)
  const excedente = redondear(Math.max(0, hasta - Math.max(finTramo2, desde)))

  return {
    a_tramo1: aTramo1,
    a_tarifa: aTarifa,
    a_tramo2: aTramo2,
    excedente,
    honorario: redondear(aTramo1 + aTramo2 + excedente),
    pasante: aTarifa,
  }
}

/** Cuanto del intervalo [desde, hasta) cae dentro de [ini, fin). */
function solape(desde: number, hasta: number, ini: number, fin: number): number {
  return redondear(Math.max(0, Math.min(hasta, fin) - Math.max(desde, ini)))
}

function num(v: number | null | undefined): number {
  const n = Number(v ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function redondear(n: number): number {
  return Math.round(n * 100) / 100
}
