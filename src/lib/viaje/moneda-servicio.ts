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
 *    (`· USD a TRM 4.230`), que esta misma función vuelve a leer.
 *
 * ## Desde la migración `20261029221700_viaje_moneda_servicios_y_tren.sql` (QA G9)
 *
 *  · El servicio guarda su moneda al generarse (`negocio_servicios.moneda`, `costo_moneda`,
 *    `tasa_cotizada`) y el pago la suya (`gastos.moneda`, `monto_moneda`, `tasa_cambio`).
 *  · Las columnas MANDAN; lo de arriba queda de respaldo para las filas de antes (en null).
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

/**
 * La moneda de las columnas del servicio (`negocio_servicios.moneda/costo_moneda/tasa_cotizada`),
 * o `null` si están vacías (fila en pesos o anterior a la migración: se cae al ítem).
 */
export function monedaDeColumnas(f: { moneda?: unknown; costo_moneda?: unknown; tasa_cotizada?: unknown } | null | undefined): MonedaDelServicio | null {
  if (!f || typeof f.moneda !== 'string') return null
  const moneda = f.moneda.trim().toUpperCase()
  const monto = Number(f.costo_moneda)
  const tasa = Number(f.tasa_cotizada)
  if (!/^[A-Z]{3}$/.test(moneda) || moneda === 'COP' || !tasaValida(tasa) || !(monto > 0)) return null
  return { moneda, monto, tasa }
}

/** Manda la columna; si está vacía, lo que diga el ítem de la cotización (filas de antes). */
export function monedaDelServicioConRespaldo(
  columnas: { moneda?: unknown; costo_moneda?: unknown; tasa_cotizada?: unknown } | null | undefined,
  item: { tarifa_pax: unknown; subtotal: number | null } | null | undefined,
  costoCotizado: number,
): MonedaDelServicio | null {
  return monedaDeColumnas(columnas) ?? (item ? monedaDelServicio(item.tarifa_pax, costoCotizado, item.subtotal) : null)
}

/** Las columnas que se escriben en `negocio_servicios` al generarlo (todas null = en pesos). */
export function columnasMonedaServicio(m: MonedaDelServicio | null): { moneda: string | null; costo_moneda: number | null; tasa_cotizada: number | null } {
  if (!m || !(m.monto > 0) || !tasaValida(m.tasa)) return { moneda: null, costo_moneda: null, tasa_cotizada: null }
  return { moneda: m.moneda, costo_moneda: Math.round(m.monto * 100) / 100, tasa_cotizada: Math.round(m.tasa * 10000) / 10000 }
}

/**
 * Las columnas que se escriben en `gastos` para un pago en otra moneda: lo pagado en la moneda es
 * los pesos ÷ la TRM del pago. Sin moneda o sin TRM, todas null (pago en pesos).
 */
export function columnasMonedaGasto(
  moneda: string | null | undefined,
  tasaPago: number | null | undefined,
  pesos: number,
): { moneda: string | null; monto_moneda: number | null; tasa_cambio: number | null } {
  const m = typeof moneda === 'string' ? moneda.trim().toUpperCase() : ''
  const monto = Math.round(((Number(pesos) || 0) / (tasaPago || 1)) * 100) / 100
  if (!/^[A-Z]{3}$/.test(m) || m === 'COP' || !tasaValida(tasaPago) || !(monto > 0)) {
    return { moneda: null, monto_moneda: null, tasa_cambio: null }
  }
  return { moneda: m, monto_moneda: monto, tasa_cambio: Math.round(tasaPago * 10000) / 10000 }
}

/**
 * ¿El error es de una columna que la base todavía no tiene? (migración sin aplicar: PostgREST
 * responde `PGRST204` en la escritura y `42703` en la lectura). Quien escribe reintenta sin ellas.
 */
export function esColumnaFaltante(error: { code?: string | null } | null | undefined): boolean {
  return ['PGRST204', '42703'].includes(error?.code ?? '')
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

/** La diferencia de cambio de los pagos del servicio que dicen su TRM (columna o texto; los demás no suman). */
export function diferenciaDeCambioDelServicio(
  m: MonedaDelServicio | null | undefined,
  gastos: ReadonlyArray<{ monto: number; descripcion?: string | null; moneda?: string | null; tasa_cambio?: number | string | null }>,
): { pesos: number; tasas: number[] } {
  if (!m) return { pesos: 0, tasas: [] }
  let pesos = 0
  const tasas: number[] = []
  for (const g of gastos) {
    // Manda la columna del pago (desde la migración G9); si está vacía, la marca del texto.
    const col = typeof g.moneda === 'string' && g.moneda.toUpperCase() === m.moneda && tasaValida(Number(g.tasa_cambio)) ? Number(g.tasa_cambio) : null
    const t = col ?? trmDeDescripcion(g.descripcion, m.moneda)
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
