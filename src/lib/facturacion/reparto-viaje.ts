/**
 * El total del viaje partido en ingreso propio (con IVA) y recibido para terceros, para la factura
 * de dos conceptos (Max §7, P3). Sale de la MISMA liquidación de IVA que imprime el PDF y que fijó
 * «Aprobar» (`ivaDeLaCotizacion`), sobre la tarifa que el cliente confirmó: la factura no puede
 * decir una cifra distinta de la que el cliente aceptó.
 *
 * No es `server-only` a propósito: la simulación (`scripts/simular-siigo-desde-one.ts --viajes`)
 * lo usa con el cliente de servicio, sin POST, para mostrar el payload exacto.
 */

import { ivaDeLaCotizacion } from '@/lib/fiscal/iva-cotizacion-datos'
import { leerConfigIvaCotizacion, motivoIvaSinCalcular } from '@/lib/fiscal/iva-cotizacion'
import type { RepartoFacturaViaje } from '@/lib/siigo/config-viaje'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export type ResultadoReparto = { ok: true; reparto: RepartoFacturaViaje; total: number } | { ok: false; falta: string }

/** Pura: del precio y la liquidación de la tarifa, el reparto. */
export function repartir(precio: number, liquidacion: { baseGravable: number; iva: number; precio: 'iva_aparte' | 'iva_incluido' }): ResultadoReparto {
  const total = Math.round(Number(precio) || 0)
  if (!(total > 0)) return { ok: false, falta: 'el precio aprobado del viaje' }
  // Con el IVA aparte, el gravable es el ingreso propio sin IVA; con el IVA adentro, también (la
  // liquidación ya le sacó el IVA). En los dos casos lo propio con IVA es gravable + IVA.
  const propioConIva = Math.round((liquidacion.baseGravable + liquidacion.iva) * 100) / 100
  const terceros = Math.round((total - propioConIva) * 100) / 100
  if (terceros < 0) return { ok: false, falta: 'el reparto del valor: el ingreso propio supera el precio aprobado' }
  return { ok: true, reparto: { propioConIva, terceros }, total }
}

/** El reparto de un negocio de viaje, leyendo su confirmación y su cotización. */
export async function repartoFacturaViaje(
  db: Db,
  args: { workspaceId: string; negocio: { precio_aprobado: number | null; metadata: Record<string, unknown> | null } },
): Promise<ResultadoReparto> {
  const conf = (args.negocio.metadata?.confirmacion_cliente ?? null) as { cotizacion_id?: string; itinerario_id?: string | null } | null
  if (!conf?.cotizacion_id) return { ok: false, falta: 'registrar «El cliente confirmó» (de ahí sale la tarifa facturada)' }
  const { data: ws } = await db.from('workspaces').select('config_extra').eq('id', args.workspaceId).maybeSingle()
  const config = leerConfigIvaCotizacion((ws as { config_extra?: unknown } | null)?.config_extra)
  const iva = await ivaDeLaCotizacion(db, { workspaceId: args.workspaceId, cotizacionId: conf.cotizacion_id, config })
  if (!iva) return { ok: false, falta: 'la cotización aceptada (no se pudo leer)' }
  const liq = (conf.itinerario_id ? iva.porTarifa.get(conf.itinerario_id) : null) ?? iva.vigente
  if (!liq.calculable) return { ok: false, falta: motivoIvaSinCalcular(liq.sinCosto) }
  return repartir(Number(args.negocio.precio_aprobado ?? 0), liq)
}
