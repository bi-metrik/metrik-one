/**
 * El costo escrito A MANO en una línea de viaje, en la moneda en que lo cobra el proveedor.
 *
 * Brief del 2026-09-22, parte 2: *«cada bloque de cada ítem debe poder configurar la moneda.
 * Por defecto COP»*. La captura leída ya tiene su moneda (`monedaDeTarifa`) y los adicionales
 * la suya (`item_adicionales.moneda`); el costo que se escribe a mano —el seguro, el fee, la
 * línea que no tiene pantallazo— solo sabía de pesos.
 *
 * ## Dónde vive cada número, y por qué no hace falta DDL
 *
 *  · `items.subtotal` sigue guardando PESOS. Es de donde leen el costo total, la cascada del
 *    margen y el presupuesto de Ejecución, y ninguno de ellos tiene que saber de monedas.
 *  · Lo que la persona escribió —moneda, valor y tasa— queda en `items.tarifa_pax.costoManual`
 *    (jsonb que ya existe), con quién y cuándo. Es lo que permite decir después «USD 1.200 a
 *    4.150», en vez de un número en pesos que nadie sabe de dónde salió.
 *
 * ⚠️ El sistema NO tiene TRM y no la inventa (R-P5): en otra moneda sin tasa, no se guarda.
 * Guardarlo en cero sería regalar el costo sin que nada falle, que es la misma asimetría de
 * los adicionales (`normalizarAdicional`).
 *
 * Puro: sin red, sin base.
 */

import { codigoDeMoneda, type CostoManualEnMoneda } from './tarifa-pasajero'

export interface EntradaCostoManual {
  valor: number | null | undefined
  moneda: string | null | undefined
  tasa: number | null | undefined
}

export type CostoManualNormalizado =
  | {
      ok: true
      /** Lo que va a `items.subtotal`, redondeado al peso como lo guarda `updateItem`. */
      pesos: number
      /** Lo escrito, cuando no es COP. `null` = el costo se escribió en pesos. */
      origen: Pick<CostoManualEnMoneda, 'moneda' | 'valor' | 'tasa'> | null
    }
  | { ok: false; motivo: string }

export function normalizarCostoManual(e: EntradaCostoManual): CostoManualNormalizado {
  const moneda = codigoDeMoneda(e.moneda ?? 'COP')
  if (!moneda) return { ok: false, motivo: 'Escribe la moneda con su código de tres letras: COP, USD, EUR, MXN…' }
  const valor = Number(e.valor ?? 0)
  if (!Number.isFinite(valor) || valor < 0) return { ok: false, motivo: 'El costo no puede ser negativo.' }
  if (moneda === 'COP') return { ok: true, pesos: Math.round(valor), origen: null }

  const tasa = Number(e.tasa)
  if (!Number.isFinite(tasa) || tasa <= 0) {
    return {
      ok: false,
      motivo: `El costo está en ${moneda} y falta la tasa de cambio a pesos. Escríbela: el sistema no consulta la TRM.`,
    }
  }
  return { ok: true, pesos: Math.round(valor * tasa), origen: { moneda, valor, tasa } }
}

/**
 * ¿Lo anotado sigue describiendo el costo que hay en pesos?
 *
 * Se compara el NÚMERO, igual que el margen de la captura (#794): si alguien cambió el costo
 * por otro camino (o la línea pasó a costearse por rubros), la anotación vieja ya no explica
 * nada y no se enseña. Sin esto, «USD 1.200 a 4.150» quedaría pegado a un costo distinto.
 */
export function costoManualVigente(
  anotado: CostoManualEnMoneda | null | undefined,
  subtotalPesos: number,
): anotado is CostoManualEnMoneda {
  if (!anotado) return false
  return Math.round(anotado.valor * anotado.tasa) === Math.round(Number(subtotalPesos) || 0)
}
