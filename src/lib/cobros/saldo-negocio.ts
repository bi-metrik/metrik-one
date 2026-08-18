/**
 * El saldo de un negocio: UNA definicion, la misma que muestra la pantalla.
 *
 * La formula "precio menos cobrado" aparece repetida por todo el motor. Esta es la
 * septima aparicion, la que decide si el bloque de cobros se da por completo
 * (`reevaluarBloquesCobros`), y era la unica que contestaba distinto a la tarjeta que el
 * operador tiene delante.
 *
 * ── Las tres diferencias que tenia, medidas el 2026-08-18 ───────────────────
 *
 * 1. **Cobraba contra el honorario, no contra el valor a recaudar.** Usaba
 *    `precio_aprobado` pelado, sin la tarifa UPME confirmada. La tarjeta usa
 *    `valorARecaudar` (honorario + tarifa), asi que en un negocio que pago el
 *    honorario y NO la tarifa, el motor daba el bloque por completo mientras la
 *    tarjeta mostraba la tarifa pendiente. **42 de los 199 negocios abiertos de SOENA
 *    con precio caen en ese patron**, por $28.110.037 de tarifa sin cobrar: V0109 con
 *    $870.094, V0120 con $819.916, V0114 con $779.416.
 *
 *    ⚠️ Hoy ninguno esta mal marcado en la base: los 272 bloques de cobros de esos 42
 *    negocios estan en `pendiente`. El defecto es LATENTE, no activo: los marcaria
 *    completos en cuanto se vuelva a evaluar el negocio (al registrar, confirmar o
 *    anular un cobro suyo).
 * 2. **Sumaba cobros sin fecha.** La tarjeta solo cuenta los confirmados
 *    (`fecha != null`); el motor sumaba tambien las cuotas programadas que nadie ha
 *    pagado. En SOENA hoy no muerde (0 cobros sin fecha), pero el workspace `metrik`
 *    tiene 48 cuotas programadas.
 * 3. **Exigia cero absoluto.** `saldo <= 0`, sin el piso de materialidad de Carmen que
 *    aplica al resto del sistema (`saldoCuadrado`). Hoy no muerde tampoco: 0 negocios
 *    en la franja de $1 a $1.000. Se corrige igual, porque un estandar adoptado se
 *    aplica completo, no solo donde hoy se nota.
 *
 * ⚠️ **Un cobro anulado suma 0 y eso es correcto.** Su `monto` vale 0 justamente para
 * que nadie lo cuente; NO se usa `montoRegistrado` aqui, que devolveria el valor que
 * tenia antes de anularse y resucitaria la plata. Ver `lib/cobros/anulacion.ts`.
 *
 * Puro: no toca DB ni red.
 */

import { saldoCuadrado } from '@/lib/negocios/tolerancia-saldo'

/** Lo minimo de un cobro para contar hacia el saldo. */
export interface CobroParaSaldo {
  monto?: number | null
  /** Sin fecha = todavia no entro. Una cuota programada no es plata recibida. */
  fecha?: string | null
}

/**
 * Lo efectivamente recaudado: solo los cobros con fecha.
 *
 * Es la misma cuenta que hace la tarjeta del negocio (`BloqueCobros`), y por eso el
 * numero de la pantalla y el veredicto del motor dejan de poder contradecirse.
 */
export function cobradoConfirmado(cobros: readonly CobroParaSaldo[]): number {
  let total = 0
  for (const c of cobros) {
    if (!c.fecha) continue
    const n = Number(c.monto ?? 0)
    if (Number.isFinite(n)) total += n
  }
  return total
}

/**
 * ¿El bloque de cobros esta completo?
 *
 * `valorARecaudar` es el total que el cliente debe (honorario mas tarifa pasante
 * confirmada), no el honorario solo. Con 0 no hay nada que dar por completo: un negocio
 * sin precio no esta pago, esta sin cifrar.
 */
export function bloqueCobrosCompleto(input: {
  valorARecaudar: number
  cobrado: number
}): boolean {
  const valor = Number(input.valorARecaudar ?? 0)
  if (!Number.isFinite(valor) || valor <= 0) return false
  const saldo = valor - Number(input.cobrado ?? 0)
  return saldo <= 0 || saldoCuadrado(saldo)
}
