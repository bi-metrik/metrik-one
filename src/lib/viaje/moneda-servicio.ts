/**
 * La moneda del servicio del viaje y la diferencia de cambio de sus pagos (QA Trappvel 2026-10-29:
 * H6-1, H9-1, H6-3).
 *
 * ## Lo que pasaba
 *
 * El servicio llegaba a Reservas solo en pesos (`negocio_servicios.costo_cotizado`): Operaciones
 * pagaba US$ 2,084.40 sin ver ese monto en la fila, y si la TRM del día del pago era otra, la
 * diferencia salía como «sobrecosto» del proveedor, y por encima del 5 % le pedía a Edgar aprobar
 * una «desviación de costo» que no era del proveedor.
 *
 * ## Dónde vive cada número, sin DDL
 *
 *  · La moneda y la tasa con que se COTIZÓ salen del ítem de la cotización (`negocio_servicios
 *    .item_id` → `items.tarifa_pax`: `confirmada.moneda/tasa` o `costoManual`). Una cotización
 *    aceptada ya no se edita, así que el ítem dice lo mismo que dijo al generar la fila.
 *  · La TRM del PAGO la escribe quien paga y queda en el texto del gasto con una marca fija
 *    (`· USD a TRM 4.230`), que esta misma función vuelve a leer. Guardarla en columnas propias
 *    (moneda, monto en la moneda, tasa) pide migración: va propuesta aparte.
 *
 * Puro: sin red, sin base.
 */

import { costoManualVigente } from '@/lib/cotizaciones/costo-manual'
import { leerTarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'
import { tasaComoTexto } from '@/lib/cotizaciones/tasa-cotizacion'

export interface MonedaDelServicio {
  /** Código de tres letras, nunca COP. */
  moneda: string
  /** Lo cotizado en esa moneda (lo cotizado en pesos ÷ la tasa). */
  monto: number
  /** Pesos por unidad con que se cotizó. */
  tasa: number
}

/** Cuánto se aleja como máximo la TRM del pago de la cotizada para creerla (±20 %). */
export const BANDA_TRM_PAGO = 0.2

function tasaValida(t: unknown): t is number {
  return typeof t === 'number' && Number.isFinite(t) && t > 0
}

/**
 * La moneda en que se cotizó el servicio, o `null` si fue en pesos (o no se sabe). `subtotal` es
 * `items.subtotal` (para saber si el costo a mano sigue vigente).
 */
export function monedaDelServicio(tarifaPax: unknown, costoCotizado: number, subtotal?: number | null): MonedaDelServicio | null {
  const t = leerTarifaPax(tarifaPax)
  const cot = Number(costoCotizado) || 0
  const c = t.confirmada
  let moneda: string | null = null
  let tasa: number | null = null
  if (c && c.moneda && c.moneda.toUpperCase() !== 'COP' && tasaValida(c.tasa)) {
    moneda = c.moneda.toUpperCase()
    tasa = c.tasa
  } else if (t.costoManual && t.costoManual.moneda.toUpperCase() !== 'COP' && tasaValida(t.costoManual.tasa)
    && (subtotal === undefined || subtotal === null || costoManualVigente(t.costoManual, Number(subtotal) || 0))) {
    moneda = t.costoManual.moneda.toUpperCase()
    tasa = t.costoManual.tasa
  }
  if (!moneda || tasa === null || cot <= 0) return null
  return { moneda, tasa, monto: Math.round((cot / tasa) * 100) / 100 }
}

/** Un monto en otra moneda, como se lee en la fila: «USD 2.084,40». */
export function montoEnMoneda(monto: number, moneda: string): string {
  const [entero, dec = ''] = (Math.round(monto * 100) / 100).toFixed(2).split('.')
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${moneda} ${miles}${dec === '00' ? '' : `,${dec}`}`
}

/** «Se le paga en USD: USD 2.084,40, cotizados a 4.150.» */
export function textoPagoEnMoneda(m: MonedaDelServicio): string {
  return `Se le paga en ${m.moneda}: ${montoEnMoneda(m.monto, m.moneda)}, cotizados a ${tasaComoTexto(m.tasa)}.`
}

/** ¿La TRM escrita del pago es creíble frente a la cotizada? (±20 %; fuera de eso, error de dedo). */
export function tasaPagoValida(tasaPago: number | null | undefined, tasaCotizada: number): tasaPago is number {
  if (!tasaValida(tasaPago) || !tasaValida(tasaCotizada)) return false
  return Math.abs(tasaPago - tasaCotizada) / tasaCotizada <= BANDA_TRM_PAGO
}

/** La marca que queda en el texto del gasto: «· USD a TRM 4.230». */
export function marcaTrm(moneda: string, tasaPago: number): string {
  return `· ${moneda.toUpperCase()} a TRM ${tasaComoTexto(tasaPago)}`
}

const MARCA = /· ([A-Z]{3}) a TRM (\d{1,3}(?:\.\d{3})*(?:,\d+)?)\s*$/

/** La TRM del pago que quedó en el texto del gasto, si es de esa moneda. */
export function trmDeDescripcion(descripcion: string | null | undefined, moneda: string): number | null {
  const m = MARCA.exec(descripcion ?? '')
  if (!m || m[1] !== moneda.toUpperCase()) return null
  const n = Number(m[2].replace(/\./g, '').replace(',', '.'))
  return tasaValida(n) ? n : null
}

/**
 * Diferencia de cambio de UN pago: los pesos que pagó menos lo que esos mismos dólares habrían
 * costado a la tasa cotizada. Positiva = la TRM subió. Un pago de P pesos a la TRM t compra P/t
 * dólares, que a la tasa cotizada c costaban P·c/t: la diferencia es P·(1 − c/t). Sirve igual
 * para un pago parcial.
 */
export function diferenciaDeCambio(pesos: number, tasaCotizada: number, tasaPago: number): number {
  if (!tasaValida(tasaCotizada) || !tasaValida(tasaPago)) return 0
  return Math.round((Number(pesos) || 0) * (1 - tasaCotizada / tasaPago))
}

/** La diferencia de cambio de los pagos del servicio que dicen su TRM (los demás no suman). */
export function diferenciaDeCambioDelServicio(
  m: MonedaDelServicio | null | undefined,
  gastos: ReadonlyArray<{ monto: number; descripcion?: string | null }>,
): { pesos: number; tasas: number[] } {
  if (!m) return { pesos: 0, tasas: [] }
  let pesos = 0
  const tasas: number[] = []
  for (const g of gastos) {
    const t = trmDeDescripcion(g.descripcion, m.moneda)
    if (t === null) continue
    pesos += diferenciaDeCambio(g.monto, m.tasa, t)
    if (!tasas.includes(t)) tasas.push(t)
  }
  return { pesos, tasas }
}

/** «diferencia de cambio: TRM 4.230 frente a 4.150 cotizada» */
export function textoDiferenciaDeCambio(m: MonedaDelServicio, tasas: readonly number[]): string {
  const pagadas = tasas.map(tasaComoTexto).join(' y ')
  return `diferencia de cambio: TRM ${pagadas} frente a ${tasaComoTexto(m.tasa)} cotizada`
}
