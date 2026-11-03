/**
 * Facturas por obra (C9, C10).
 *
 * Una factura cuelga de un negocio (la obra) y está abierta o pagada. Lo recibido, el saldo y lo
 * retenido NO se guardan: los calcula `v_facturas_obra` de la factura y sus cobros. Lo retenido es
 * solo la diferencia `total − recibido` de una factura PAGADA; ONE no calcula, liquida ni certifica
 * retenciones (decisión D1).
 *
 * El caso que se cuida (§6.3-d): un cliente que descuenta por un daño en la obra. Si esa
 * diferencia se marca pagada, ONE la mostraría como retenido y la persona pediría un certificado
 * que no existe. Por eso, al marcar pagada con diferencia, la pantalla pregunta si TODA la
 * diferencia es retención, y si no lo es no se marca.
 */
import { todayBogotaISO } from '@/lib/dates/bogota'
import { pesos } from './formato'

export interface FacturaObra {
  id: string
  negocio_id: string | null
  empresa_id: string | null
  numero_factura: string | null
  fecha_emision: string | null
  monto: number
  estado: 'abierta' | 'pagada'
  pagada_at: string | null
  recibido: number
  saldo_pendiente: number | null
  retenido: number | null
}

export const COLUMNAS_FACTURA_OBRA =
  'id, negocio_id, empresa_id, numero_factura, fecha_emision, monto, estado, pagada_at, recibido, saldo_pendiente, retenido'

const num = (v: unknown) => {
  const x = Number(v ?? 0)
  return Number.isFinite(x) ? x : 0
}
const numONull = (v: unknown) => (v === null || v === undefined ? null : num(v))

/** Una fila de `v_facturas_obra` con los números ya como números. */
export function normalizarFacturaObra(f: Record<string, unknown>): FacturaObra {
  return {
    id: String(f.id ?? ''),
    negocio_id: (f.negocio_id as string | null) ?? null,
    empresa_id: (f.empresa_id as string | null) ?? null,
    numero_factura: (f.numero_factura as string | null) ?? null,
    fecha_emision: (f.fecha_emision as string | null) ?? null,
    monto: num(f.monto),
    estado: f.estado === 'pagada' ? 'pagada' : 'abierta',
    pagada_at: (f.pagada_at as string | null) ?? null,
    recibido: num(f.recibido),
    saldo_pendiente: numONull(f.saldo_pendiente),
    retenido: numONull(f.retenido),
  }
}

export interface DatosFactura {
  numero_factura: string
  fecha_emision: string
  monto: number
  soporte_url: string | null
}

type Resultado<T> = { ok: true; datos: T } | { ok: false; error: string }

const FECHA = /^\d{4}-\d{2}-\d{2}$/

export function validarFactura(entrada: unknown): Resultado<DatosFactura> {
  const e = (entrada ?? {}) as Record<string, unknown>
  const numero = typeof e.numero_factura === 'string' ? e.numero_factura.trim() : ''
  if (!numero) return { ok: false, error: 'Escribe el número de la factura.' }
  if (numero.length > 60) return { ok: false, error: 'El número de la factura es muy largo (máximo 60 caracteres).' }
  const fecha = typeof e.fecha_emision === 'string' ? e.fecha_emision.trim() : ''
  if (!FECHA.test(fecha)) return { ok: false, error: 'La fecha de la factura no es válida.' }
  if (fecha > todayBogotaISO()) return { ok: false, error: 'La fecha de la factura no puede ser futura.' }
  const monto = Number(e.monto)
  if (!Number.isFinite(monto) || monto <= 0) return { ok: false, error: 'El total de la factura tiene que ser mayor que cero.' }
  const soporte = typeof e.soporte_url === 'string' && e.soporte_url.trim() ? e.soporte_url.trim() : null
  return { ok: true, datos: { numero_factura: numero, fecha_emision: fecha, monto: Math.round(monto * 100) / 100, soporte_url: soporte } }
}

/** Lo que falta por recibir de una factura: total − recibido, redondeado al centavo. */
export function diferenciaDeFactura(f: { monto: number; recibido: number }): number {
  return Math.round((num(f.monto) - num(f.recibido)) * 100) / 100
}

export const PREGUNTA_RETENCION = '¿Toda la diferencia es retención?'

export const MENSAJE_DIFERENCIA_NO_ES_RETENCION =
  'No la marques pagada todavía. Si el cliente descontó algo que no es retención (por ejemplo, un daño en la obra), regístralo como corresponda y marca la factura pagada cuando lo que falte sea solo retención.'

export type DecisionMarcarPagada =
  | { accion: 'marcar'; diferencia: number }
  | { accion: 'preguntar'; diferencia: number; pregunta: string }
  | { accion: 'no_marcar'; diferencia: number; mensaje: string }
  | { accion: 'bloquear'; error: string }

/**
 * Qué hacer al tocar «Marcar pagada».
 *
 * - Ya pagada: no hay nada que marcar.
 * - Recibido mayor que el total: no se marca; un retenido negativo no significa nada y casi
 *   siempre es un pago asociado a la factura equivocada.
 * - Diferencia cero: se marca.
 * - Diferencia positiva: se pregunta si toda es retención. Sí → se marca. No → no se marca y se
 *   explica qué hacer.
 */
export function decidirMarcarPagada(
  f: { estado: string; monto: number; recibido: number },
  respuesta?: 'si' | 'no' | null,
): DecisionMarcarPagada {
  if (f.estado === 'pagada') return { accion: 'bloquear', error: 'Esta factura ya está pagada.' }
  const diferencia = diferenciaDeFactura(f)
  if (diferencia < 0) {
    return {
      accion: 'bloquear',
      error: `Lo recibido supera el total de la factura en ${pesos(-diferencia)}. Revisa los pagos asociados antes de marcarla pagada.`,
    }
  }
  if (diferencia === 0) return { accion: 'marcar', diferencia }
  if (respuesta === 'si') return { accion: 'marcar', diferencia }
  if (respuesta === 'no') return { accion: 'no_marcar', diferencia, mensaje: MENSAJE_DIFERENCIA_NO_ES_RETENCION }
  return { accion: 'preguntar', diferencia, pregunta: PREGUNTA_RETENCION }
}

export interface RetenidoDeCliente {
  empresa_id: string | null
  cliente: string
  facturado: number
  recibido: number
  /** Solo de facturas pagadas. */
  retenido: number
  /** Solo de facturas abiertas. */
  saldoPendiente: number
  facturasPagadas: number
  facturasAbiertas: number
}

/**
 * Retenido y saldo pendiente por cliente, sumando lo que ya calculó `v_facturas_obra`: el
 * retenido viene solo en las pagadas y el saldo solo en las abiertas, así que la suma no los
 * mezcla. Orden: más retenido primero.
 */
export function retenidoPorCliente(
  facturas: FacturaObra[],
  nombreDeEmpresa: (empresaId: string | null) => string,
): RetenidoDeCliente[] {
  const grupos = new Map<string, RetenidoDeCliente>()
  for (const f of facturas) {
    const llave = f.empresa_id ?? '∅'
    let g = grupos.get(llave)
    if (!g) {
      g = {
        empresa_id: f.empresa_id,
        cliente: nombreDeEmpresa(f.empresa_id),
        facturado: 0,
        recibido: 0,
        retenido: 0,
        saldoPendiente: 0,
        facturasPagadas: 0,
        facturasAbiertas: 0,
      }
      grupos.set(llave, g)
    }
    g.facturado += f.monto
    g.recibido += f.recibido
    if (f.estado === 'pagada') {
      g.retenido += num(f.retenido)
      g.facturasPagadas += 1
    } else {
      g.saldoPendiente += num(f.saldo_pendiente)
      g.facturasAbiertas += 1
    }
  }
  return [...grupos.values()].sort((a, b) => b.retenido - a.retenido || b.saldoPendiente - a.saldoPendiente)
}
