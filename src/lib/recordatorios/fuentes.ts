/**
 * Fuentes del motor de recordatorios: de dónde sale la fecha de cada aviso y si sigue aplicando.
 *
 * Puro: recibe las filas ya leídas (las lee `motor.ts`) y devuelve candidatos. Cada candidato es
 * «esta entidad tiene esta fecha objetivo y todavía está pendiente». El motor cruza el candidato
 * con las reglas de su fuente y decide si toca hoy.
 *
 *   · `envio`: la cotización enviada más reciente del negocio (`cotizaciones.fecha_envio`).
 *     Pendiente mientras el negocio siga abierto, sin pausar y, si la regla lo pide, en la etapa
 *     declarada (los toques se apagan solos al salir de Seguimiento o al aplazar, Vera F1-2).
 *   · `pago_proveedor`: la fecha límite de pago de cada servicio por reservar o reservado
 *     (`negocio_servicios.fecha_limite_pago`). Pendiente mientras lo pagado (Σ gastos de la fila)
 *     no cubra el valor a pagar. «Pagado» se deriva de la plata, no de un estado escrito (Vera C6).
 *   · `aplazado`: el día que la comercial escogió al aplazar (`negocios.metadata.seguimiento.
 *     aplazado_para`, F1-4). Pendiente mientras el negocio siga abierto. No se lee de
 *     `pausado_hasta`: el cron de pausa lo borra al reactivar, a primera hora, antes del motor.
 */

import { todayBogotaISO } from '@/lib/dates/bogota'
import { cuotasConEstadoViaje, type PagoViajero } from '@/lib/viaje/riel-cobro'
import { pesos } from '@/lib/viaje/plan-pagos'
import type { FuenteRecordatorio } from './reglas'

export interface NegocioFuente {
  id: string
  workspace_id: string
  linea_id: string
  nombre: string
  codigo: string | null
  contacto_nombre: string | null
  etapa_numero: number | null
  pausado: boolean
  estado: string
  /** `metadata.seguimiento.aplazado_para`, si la comercial aplazó con el seguimiento encendido. */
  aplazado_para?: string | null
}

export interface CotizacionEnviada {
  id: string
  negocio_id: string
  fecha_envio: string
}

export interface ServicioFuente {
  id: string
  negocio_id: string
  nombre: string
  estado: string
  fecha_limite_pago: string | null
  costo_cotizado: number | null
  valor_por_pagar: number | null
}

export interface Candidato {
  fuente: FuenteRecordatorio
  entidadTipo: 'cotizacion' | 'servicio' | 'negocio' | 'cuota'
  entidadId: string
  negocio: NegocioFuente
  fechaObjetivo: string
  /** Lo que el texto del aviso necesita (nombre del servicio, saldo, etc.). */
  detalle: Record<string, string | number | null>
}

/** La fecha civil en Bogotá de un `timestamptz` (o la fecha tal cual si ya es `YYYY-MM-DD`). */
export function fechaCivil(valor: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(valor)) return valor
  const d = new Date(valor)
  return Number.isNaN(d.getTime()) ? valor.slice(0, 10) : todayBogotaISO(d)
}

/** Negocio vivo para un recordatorio: abierto y sin pausar. */
export function negocioVivo(n: NegocioFuente): boolean {
  return n.estado === 'abierto' && !n.pausado
}

/** Toques: una sola cotización por negocio, la última enviada (una versión nueva rearma los toques). */
export function candidatosDeEnvio(negocios: NegocioFuente[], cotizaciones: CotizacionEnviada[]): Candidato[] {
  const ultima = new Map<string, CotizacionEnviada>()
  for (const c of cotizaciones) {
    if (!c.fecha_envio) continue
    const previa = ultima.get(c.negocio_id)
    if (!previa || c.fecha_envio > previa.fecha_envio) ultima.set(c.negocio_id, c)
  }
  const out: Candidato[] = []
  for (const n of negocios) {
    const c = ultima.get(n.id)
    if (!c || !negocioVivo(n)) continue
    out.push({
      fuente: 'envio',
      entidadTipo: 'cotizacion',
      entidadId: c.id,
      negocio: n,
      fechaObjetivo: fechaCivil(c.fecha_envio),
      detalle: {},
    })
  }
  return out
}

/** El toque del día que se escogió al aplazar. Una fecha nueva (otro aplazamiento) rearma. */
export function candidatosDeAplazado(negocios: NegocioFuente[]): Candidato[] {
  const out: Candidato[] = []
  for (const n of negocios) {
    const f = n.aplazado_para
    if (!f || n.estado !== 'abierto' || !/^\d{4}-\d{2}-\d{2}/.test(f)) continue
    out.push({ fuente: 'aplazado', entidadTipo: 'negocio', entidadId: n.id, negocio: n, fechaObjetivo: f.slice(0, 10), detalle: {} })
  }
  return out
}

/** Valor que hay que pagarle al proveedor por la fila: lo que cobra, o lo cotizado si no cambió. */
export function valorAPagar(s: Pick<ServicioFuente, 'valor_por_pagar' | 'costo_cotizado'>): number {
  return Number(s.valor_por_pagar ?? s.costo_cotizado ?? 0)
}

export function candidatosDePagoProveedor(
  negocios: NegocioFuente[],
  servicios: ServicioFuente[],
  pagadoPorServicio: Map<string, number>,
): Candidato[] {
  const porId = new Map(negocios.map((n) => [n.id, n]))
  const out: Candidato[] = []
  for (const s of servicios) {
    const n = porId.get(s.negocio_id)
    if (!n || n.estado !== 'abierto') continue
    if (!s.fecha_limite_pago) continue
    if (s.estado !== 'por_reservar' && s.estado !== 'reservado') continue
    const valor = valorAPagar(s)
    const pagado = pagadoPorServicio.get(s.id) ?? 0
    // Una fila sin valor (cortesía del proveedor, recargo sin costo) no tiene nada que pagar.
    if (valor <= 0 || pagado >= valor) continue
    out.push({
      fuente: 'pago_proveedor',
      entidadTipo: 'servicio',
      entidadId: s.id,
      negocio: n,
      fechaObjetivo: s.fecha_limite_pago.slice(0, 10),
      detalle: { servicio: s.nombre, falta: Math.round(valor - pagado) },
    })
  }
  return out
}

export interface CuotaFuente {
  id: string
  negocio_id: string
  numero: number
  monto: number
  fecha_vencimiento: string
}

/**
 * Cuotas del plan acordado: pendientes mientras el reparto FIFO de los pagos con fecha no las
 * cubra (Vera §7.2.3: el estado sale de la plata). Una cuota pagada en parte recuerda lo que falta.
 */
export function candidatosDeCuota(
  negocios: NegocioFuente[],
  cuotas: CuotaFuente[],
  pagosPorNegocio: Map<string, PagoViajero[]>,
  hoy: string,
): Candidato[] {
  const porNegocio = new Map<string, CuotaFuente[]>()
  for (const c of cuotas) (porNegocio.get(c.negocio_id) ?? porNegocio.set(c.negocio_id, []).get(c.negocio_id)!).push(c)
  const out: Candidato[] = []
  for (const n of negocios) {
    if (n.estado !== 'abierto') continue
    const delNegocio = porNegocio.get(n.id) ?? []
    if (delNegocio.length === 0) continue
    const { cuotas: conEstado } = cuotasConEstadoViaje(
      delNegocio.map((c) => ({ numero: c.numero, monto: Number(c.monto), fecha: c.fecha_vencimiento.slice(0, 10), concepto: c.id })),
      pagosPorNegocio.get(n.id) ?? [],
      hoy,
    )
    for (const c of conEstado) {
      if (c.estado === 'pagada' || c.saldo <= 0) continue
      out.push({
        fuente: 'cuota',
        entidadTipo: 'cuota',
        entidadId: String(c.concepto),
        negocio: n,
        fechaObjetivo: c.fecha,
        detalle: { falta: c.saldo, cuota: c.monto, numero: c.numero + 1 },
      })
    }
  }
  return out
}

const FMT_FECHA = new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' })
const FMT_PESOS = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 })

export function nombreNegocio(n: NegocioFuente): string {
  return n.codigo ? `${n.codigo} — ${n.nombre}` : n.nombre
}

export function fechaEnPalabras(fechaISO: string): string {
  return FMT_FECHA.format(new Date(`${fechaISO}T00:00:00Z`))
}

/**
 * El texto del aviso en la app. Copy de Noor (§8) en español llano, sin palabras técnicas
 * (Vera §7.6): ni «gate», ni «bloque», ni «recordatorio programado».
 */
export function textoDelAviso(c: Candidato, offset: number, hoy: string): string {
  const negocio = nombreNegocio(c.negocio)
  if (c.fuente === 'cuota') {
    const quien = c.negocio.contacto_nombre?.trim() || 'El cliente'
    const falta = typeof c.detalle.falta === 'number' ? pesos(c.detalle.falta) : 'la cuota'
    if (offset > 0 || c.fechaObjetivo < hoy) {
      const n = Math.max(1, Math.round((Date.parse(`${hoy}T00:00:00Z`) - Date.parse(`${c.fechaObjetivo}T00:00:00Z`)) / 86_400_000))
      return `Cuota vencida: ${quien} · ${falta} · hace ${n} día${n === 1 ? '' : 's'} (${negocio}).`
    }
    return `Hoy vence la cuota de ${quien}: ${falta} (${negocio}). Pega el comprobante cuando pague.`
  }
  if (c.fuente === 'envio') {
    const quien = c.negocio.contacto_nombre?.trim() || 'el cliente'
    return `Hoy toca escribirle a ${quien} (${negocio}): le enviaste la cotización el ${fechaEnPalabras(c.fechaObjetivo)}.`
  }
  if (c.fuente === 'aplazado') {
    const quien = c.negocio.contacto_nombre?.trim() || 'al cliente'
    return `Hoy quedaste de volver a escribirle a ${quien} (${negocio}).`
  }
  const servicio = String(c.detalle.servicio ?? 'el servicio')
  const falta = typeof c.detalle.falta === 'number' ? ` Faltan ${FMT_PESOS.format(c.detalle.falta)}.` : ''
  if (offset > 0 || c.fechaObjetivo < hoy) {
    return `${servicio} (${negocio}) venció el ${fechaEnPalabras(c.fechaObjetivo)} sin pagar.${falta}`
  }
  if (c.fechaObjetivo === hoy) return `Paga ${servicio} (${negocio}): vence hoy.${falta}`
  return `Paga ${servicio} (${negocio}): vence el ${fechaEnPalabras(c.fechaObjetivo)}.${falta}`
}

/** Tipo de notificación (los tipos ya están en el CHECK desde la migración de F0). */
export function tipoDeNotificacion(c: Candidato, offset: number, hoy: string): string {
  if (c.fuente === 'envio' || c.fuente === 'aplazado') return 'toque_seguimiento'
  if (c.fuente === 'cuota') return offset > 0 || c.fechaObjetivo < hoy ? 'cobro_vencido' : 'cuota_por_vencer'
  return offset > 0 || c.fechaObjetivo < hoy ? 'pago_proveedor_vencido' : 'pago_proveedor_por_vencer'
}
