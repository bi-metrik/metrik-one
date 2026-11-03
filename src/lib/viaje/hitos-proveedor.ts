/**
 * Los pagos al proveedor con fecha límite de una tarifa (H-17 del QA de Trappvel del 2026-10-29).
 *
 * Hoy los trae solo el paquete de bloqueo: su «Compra antes del» (`tarifa_pax.bloqueo.hotel.
 * compraAntesDe`, leída del pantallazo o escrita en la tarjeta). El monto es el costo de la línea
 * (`items.subtotal`: lo que se le paga al operador). El plan de pagos los mira (`plan-pagos.ts`).
 */

import { esOperadorMezclado } from '@/lib/cotizaciones/bloqueo-operador'
import { leerItinerarios } from '@/lib/cotizaciones/itinerarios-datos'
import type { HitoProveedor } from './plan-pagos'
import { limiteDePagoDelItem, paqueteDelItem } from './servicios-desde-tarifa'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export interface ItemConLimite {
  id: string
  subtotal?: number | string | null
  tarifa_pax?: unknown
  es_ajuste?: boolean | null
}

/** Los hitos de las líneas de una tarifa (`seleccion`), o de todas si la cotización no tiene tarifas (`null`). */
export function hitosDeProveedor(items: readonly ItemConLimite[], seleccion: readonly string[] | null): HitoProveedor[] {
  const dentro = seleccion ? new Set(seleccion) : null
  const out: HitoProveedor[] = []
  for (const i of items) {
    if (i.es_ajuste === true || (dentro && !dentro.has(i.id))) continue
    const { fecha_limite_pago } = limiteDePagoDelItem(i)
    const monto = Number(i.subtotal) || 0
    if (!fecha_limite_pago || !(monto > 0)) continue
    const op = paqueteDelItem(i)?.operador ?? null
    out.push({ fecha: fecha_limite_pago, monto, operador: op && !esOperadorMezclado(op) ? op : null })
  }
  return out.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0))
}

/**
 * Los hitos de cada tarifa de la cotización, por `itinerarioId` (la tarifa única implícita, `null`,
 * va con la clave `''`). Si algo no se puede leer, sin hitos: el plan queda como antes.
 */
export async function hitosPorTarifa(db: Db, cotizacionId: string): Promise<Map<string, HitoProveedor[]>> {
  const out = new Map<string, HitoProveedor[]>()
  const { data, error } = await db.from('items').select('id, subtotal, tarifa_pax, es_ajuste').eq('cotizacion_id', cotizacionId)
  if (error || !data) return out
  const items = data as ItemConLimite[]
  if (!items.some(i => limiteDePagoDelItem(i).fecha_limite_pago)) return out
  out.set('', hitosDeProveedor(items, null))
  for (const t of (await leerItinerarios(db, cotizacionId)) ?? []) out.set(t.id, hitosDeProveedor(items, t.seleccion))
  return out
}

/** Los hitos de la tarifa escogida. */
export function hitosDeTarifa(mapa: ReadonlyMap<string, HitoProveedor[]>, itinerarioId: string | null): HitoProveedor[] {
  return mapa.get(itinerarioId ?? '') ?? []
}
