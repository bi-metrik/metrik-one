/**
 * El reparto FIFO de lo recibido entre cuotas: lo que entra cubre de la cuota más vieja a la más
 * nueva; un pago parcial deja la cuota «en parte» y un sobrepago pasa a la siguiente.
 *
 * Puro y compartido: lo usan las cuotas de servicio de MéTRIK (`valida-cda/pago-pendiente`) y el
 * plan de pagos del viajero (`viaje/riel-cobro`). Una sola regla para los dos: el estado de una
 * cuota se DERIVA de la plata, no se guarda (Vera §7.2.3).
 *
 * Unos pesos de redondeo (`saldoCuadrado`) no dejan una cuota «en parte»: es el piso de
 * materialidad del sistema.
 */

import { saldoCuadrado } from '@/lib/negocios/tolerancia-saldo'

export interface TramoFifo {
  /** Lo que le tocó a la cuota de lo recibido. */
  abonado: number
  /** Lo que le falta (0 si quedó pagada). */
  saldo: number
  pagada: boolean
}

/**
 * Reparte `recibido` entre `montos`, EN EL ORDEN DADO (quien llama ordena por vencimiento).
 * Devuelve un tramo por monto y lo que sobra después de cubrirlos todos (saldo a favor).
 */
export function repartirFifo(montos: readonly number[], recibido: number): { tramos: TramoFifo[]; sobrante: number } {
  let disponible = Number.isFinite(recibido) ? recibido : 0
  const tramos = montos.map((monto) => {
    const abonado = Math.max(0, Math.min(disponible, monto))
    disponible -= monto
    const saldo = monto - abonado
    const pagada = saldo <= 0 || saldoCuadrado(saldo)
    return { abonado: pagada ? monto : abonado, saldo: pagada ? 0 : saldo, pagada }
  })
  return { tramos, sobrante: Math.max(0, disponible) }
}
