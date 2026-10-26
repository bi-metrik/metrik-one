/**
 * La simulación de los documentos de un viaje (adenda Siigo): arma el payload EXACTO del tercero,
 * de la factura y de cada recibo pendiente con las mismas piezas que la emisión, y dice qué
 * frenaría. No llama a Siigo ni escribe nada. La usa `scripts/simular-siigo-desde-one.ts --viajes`.
 */

import type { SiigoConfig } from './client'
import { borradorCliente, borradorRecibo, SUCURSAL_POR_DEFECTO, type BorradorCliente, type BorradorFactura, type BorradorRecibo } from './mapeo'
import { rutDeConfirmacion, titularDeConfirmacion } from './titular'
import { bloqueoPorEntorno, borradorFacturaViaje, entornoSiigo, formaDePagoRecibo, type RepartoFacturaViaje } from './config-viaje'

export interface CobroPendiente {
  id: string
  monto: number
  fecha: string | null
  cuenta_recaudo: string | null
}

export interface SimulacionViaje {
  entorno: 'pruebas' | 'produccion'
  /** Por qué no se emitiría nada (negocio de prueba contra producción). */
  bloqueo: string | null
  cliente: { payload: BorradorCliente; faltantes: string[] }
  factura: { payload: BorradorFactura; faltantes: string[] } | null
  recibos: Array<{ cobroId: string; payload: BorradorRecibo | null; faltantes: string[] }>
}

export function simularDocumentosViaje(args: {
  cfg: SiigoConfig
  metadata: Record<string, unknown> | null
  contacto: { email: string | null; telefono: string | null }
  /** `null` si el negocio no entra a la cola: no se arma factura. */
  reparto: { ok: true; reparto: RepartoFacturaViaje } | { ok: false; falta: string } | null
  cobrosPendientes: readonly CobroPendiente[]
  /** `cuentas_recaudo` del espacio con su forma de pago propia, si la traen. */
  cuentas: ReadonlyArray<{ id: string; siigo_payment_id?: number | null }>
  hoy: string
  conceptoRecibo: string
  ivaPct?: number
}): SimulacionViaje {
  const titular = titularDeConfirmacion(args.metadata)
  const cliente = borradorCliente(titular ? rutDeConfirmacion(args.metadata) ?? {} : {}, args.contacto, titular)
  const ident = cliente.payload.identification

  let factura: SimulacionViaje['factura'] = null
  if (args.reparto) {
    const b = borradorFacturaViaje(args.cfg, ident, args.reparto.ok ? args.reparto.reparto : null, args.hoy, args.ivaPct ?? 19, { emitir: false })
    factura = args.reparto.ok ? b : { ...b, faltantes: [...b.faltantes.filter(f => !f.startsWith('el reparto')), args.reparto.falta] }
  }

  const recibos = args.cobrosPendientes.map(c => {
    const cuenta = args.cuentas.find(x => x.id === c.cuenta_recaudo)
    const forma = formaDePagoRecibo(args.cfg, c.cuenta_recaudo, cuenta?.siigo_payment_id ?? null)
    if (!forma.ok) return { cobroId: c.id, payload: null, faltantes: [forma.falta] }
    const b = borradorRecibo(args.cfg, ident, c.monto, c.fecha ?? args.hoy, args.conceptoRecibo, SUCURSAL_POR_DEFECTO, undefined, forma.id)
    return { cobroId: c.id, payload: b.payload, faltantes: b.faltantes }
  })

  return { entorno: entornoSiigo(args.cfg), bloqueo: bloqueoPorEntorno(args.cfg, args.metadata), cliente, factura, recibos }
}
