/**
 * «Documentos y entrega» (F4, post-cotización; Noor §2 etapa 6, Vera §6 F4, C11). Puro: lo usan
 * el panel, las acciones del servidor, el gate de la etapa y el motor de recordatorios, con la
 * misma regla en todos.
 *
 *   · Vouchers «{n} de {m}» salen de las filas de servicio: no se suben de nuevo (F4-1). Una fila
 *     sin nada que pagarle a un proveedor (el recargo fijo de F0) no pide voucher.
 *   · Cobro mínimo (`cobro_minimo`, F4-3): a 15 días o menos de la salida, el 80 % del precio
 *     aprobado cobrado confirmado; antes, que el cliente vaya al día con sus cuotas.
 *   · Documentos del viajero en el CONTACTO (C11): pasaporte con aviso rojo si vence a menos de 6
 *     meses del regreso (F4-2); viaje nacional, «no pide pasaporte ni visa».
 *   · Paquete de viaje: itinerario día a día, vouchers, «Antes de viajar» y contactos de
 *     emergencia; sale por C1 (WhatsApp de la comercial con un toque + correo si hay) y deja
 *     `negocios.metadata.paquete_viaje.enviado_at` (lo lee la cola de facturación de F5).
 *
 * Interruptor: `lineas_negocio.config_extra.entrega_viaje.activo === true`. Ausente = apagado.
 */

import type { CampoExtraccion, CampoResultado } from '@/lib/ai/extract-fields'
import { REGLA_POR_DEFECTO, sumarDiasCivil, type CuotaPlan, type ReglaPlan } from './plan-pagos'

// ── Configuración ────────────────────────────────────────────────────────────

export const GATE_VOUCHERS = 'vouchers_completos'
export const GATE_COBRO_MINIMO = 'cobro_minimo'
export const GATE_PAQUETE = 'paquete_enviado'
export const GATE_DOCUMENTOS = 'documentos_viajero'
export const GATES_ENTREGA = [GATE_VOUCHERS, GATE_COBRO_MINIMO, GATE_PAQUETE, GATE_DOCUMENTOS] as const

export interface ConfigEntrega {
  activo: boolean
  /** Texto llano de la línea: «Edgar 313 884 0551 · Asistencia 24 h …». */
  contactosEmergencia: string | null
}

export function configEntrega(configLinea: unknown): ConfigEntrega {
  const raw = (configLinea as { entrega_viaje?: Record<string, unknown> } | null | undefined)?.entrega_viaje
  const activo = !!raw && typeof raw === 'object' && raw.activo === true
  const ce = raw?.contactos_emergencia
  return { activo, contactosEmergencia: typeof ce === 'string' && ce.trim() ? ce.trim().slice(0, 1000) : null }
}

// ── Fechas y pesos (sin depender del ICU del servidor) ───────────────────────

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
const DIA_MS = 86_400_000
const ms = (f: string) => Date.parse(`${f.slice(0, 10)}T00:00:00Z`)

/** «2 mar 2027» */
export function fechaConAnio(f: string): string {
  const d = new Date(`${f.slice(0, 10)}T00:00:00Z`)
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** «19 nov» */
export function fechaCortaEntrega(f: string): string {
  const d = new Date(`${f.slice(0, 10)}T00:00:00Z`)
  return `${d.getUTCDate()} ${MESES[d.getUTCMonth()]}`
}

export function diasHasta(desde: string, hasta: string): number {
  return Math.round((ms(hasta) - ms(desde)) / DIA_MS)
}

const pesos = (v: number) => `$${Math.abs(Math.round(v)).toLocaleString('es-CO', { useGrouping: true }).replace(/,/g, '.')}`

/** `YYYY-MM-DD` + N meses (día recortado al fin de mes). */
export function sumarMeses(f: string, n: number): string {
  const [y, m, d] = f.slice(0, 10).split('-').map(Number)
  const total = y * 12 + (m - 1) + n
  const ny = Math.floor(total / 12)
  const nm = total % 12
  const ultimo = new Date(Date.UTC(ny, nm + 1, 0)).getUTCDate()
  return `${ny}-${String(nm + 1).padStart(2, '0')}-${String(Math.min(d, ultimo)).padStart(2, '0')}`
}

// ── Vouchers (F4-1) ──────────────────────────────────────────────────────────

export interface FilaEntrega {
  id: string
  nombre: string
  tipo?: string
  estado: string
  costo_cotizado: number
  valor_por_pagar: number | null
  voucher_ref: string | null
  fecha_servicio?: string | null
  proveedor_nombre?: string | null
  localizador?: string | null
  orden?: number
  gastos: ReadonlyArray<{ monto: number }>
}

/** ¿La fila pide voucher? Las «No va» no; una fila sin nada que pagarle a nadie, tampoco. */
export function pideVoucher(f: FilaEntrega): boolean {
  if (f.estado === 'cancelado') return false
  const v = f.valor_por_pagar
  const aPagar = typeof v === 'number' && Number.isFinite(v) ? v : Number(f.costo_cotizado) || 0
  return aPagar > 0 || f.gastos.length > 0
}

export interface Vouchers {
  conVoucher: number
  total: number
  faltan: Array<{ id: string; nombre: string }>
}

export function vouchersDelViaje(filas: readonly FilaEntrega[]): Vouchers {
  const piden = filas.filter(pideVoucher)
  const faltan = piden.filter(f => !f.voucher_ref).map(f => ({ id: f.id, nombre: f.nombre }))
  return { conVoucher: piden.length - faltan.length, total: piden.length, faltan }
}

/** «Falta el voucher de Kayak a Cayo Cangrejo.» / «Faltan 2 vouchers: A y B.» */
export function mensajeVouchers(v: Vouchers): string | null {
  if (v.faltan.length === 0) return null
  if (v.faltan.length === 1) return `Falta el voucher de ${v.faltan[0].nombre}.`
  const nombres = v.faltan.map(f => f.nombre)
  return `Faltan ${nombres.length} vouchers: ${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}.`
}

/**
 * La huella de los vouchers enviados: si después cambia uno, el paquete enviado se marca
 * «Cambió un voucher después de enviar» (F4-4).
 */
export function huellaVouchers(filas: readonly FilaEntrega[]): string {
  return filas
    .filter(pideVoucher)
    .map(f => `${f.id}:${f.voucher_ref ?? ''}`)
    .sort()
    .join('|')
}

// ── Cobro mínimo (F4-3, gate `cobro_minimo`) ─────────────────────────────────

export interface EntradaCobroMinimo {
  /** `precio_aprobado` del negocio (el total del viaje). */
  total: number
  /** Cobrado confirmado (`cobradoConfirmado`: con fecha, más la retención). */
  pagado: number
  /** Cuotas del plan acordado; vacío si no hay plan. */
  cuotas: readonly Pick<CuotaPlan, 'monto' | 'fecha'>[]
  fechaSalida: string | null
  hoy: string
  regla?: ReglaPlan
}

export interface EstadoCobroMinimo {
  /** `ochenta`: a ≤ 15 días, mide el 80 %. `al_dia`: antes, mide las cuotas ya vencidas. */
  modo: 'ochenta' | 'al_dia'
  cumple: boolean
  /** Días que faltan para la salida (`null` sin fecha). */
  dias: number | null
  pagado: number
  /** Porcentaje pagado del total, entero. */
  pct: number
  /** Lo que la regla pide hoy. */
  requerido: number
  faltan: number
  /** Desde cuándo se mide el 80 % (T-15); `null` sin fecha. */
  desde: string | null
  pctMinimo: number
  /** El 80 % del total, en pesos (redondeado a $1.000 hacia arriba, como el plan). */
  minimo: number
}

export function cobroMinimo(e: EntradaCobroMinimo): EstadoCobroMinimo {
  const regla = e.regla ?? REGLA_POR_DEFECTO
  const total = Math.max(0, Math.round(e.total))
  const pagado = Math.max(0, Math.round(e.pagado))
  const minimo = Math.min(total, Math.ceil((total * regla.pct_minimo) / 100 / 1000) * 1000)
  const pct = total > 0 ? Math.floor((pagado / total) * 100) : 0
  const dias = e.fechaSalida ? diasHasta(e.hoy, e.fechaSalida) : null
  const desde = e.fechaSalida ? sumarDiasCivil(e.fechaSalida, -regla.dias_antes) : null
  const ochenta = dias !== null && dias <= regla.dias_antes
  const requerido = ochenta
    ? minimo
    : Math.min(total, e.cuotas.filter(c => c.fecha <= e.hoy).reduce((a, c) => a + Math.round(c.monto), 0))
  const faltan = Math.max(0, requerido - pagado)
  return { modo: ochenta ? 'ochenta' : 'al_dia', cumple: faltan === 0, dias, pagado, pct, requerido, faltan, desde, pctMinimo: regla.pct_minimo, minimo }
}

/** El mensaje literal del gate (Noor etapa 6), con cifras reales. `null` si cumple. */
export function mensajeCobroMinimo(e: EstadoCobroMinimo, nombre: string): string | null {
  if (e.cumple) return null
  const quien = nombre.trim() || 'El cliente'
  if (e.modo === 'ochenta') {
    const cuando = e.dias === null ? '' : e.dias <= 0 ? 'El viaje es hoy y ' : `Faltan ${e.dias} día${e.dias === 1 ? '' : 's'} para el viaje y `
    return `No se puede enviar el paquete todavía. ${cuando}${quien} ha pagado el ${e.pct} %. La regla pide el ${e.pctMinimo} % (${pesos(e.minimo)}): faltan ${pesos(e.faltan)}.`
  }
  return `No se puede enviar el paquete todavía. ${quien} no va al día con sus cuotas: faltan ${pesos(e.faltan)} de las que ya vencieron.`
}

/** La cuenta regresiva del bloque de cobro (Noor etapa 6, «Vacío» incluido). */
export function textoCuentaRegresiva(e: EstadoCobroMinimo, cuotas: readonly Pick<CuotaPlan, 'monto' | 'fecha'>[]): string {
  if (e.dias === null) return `Sin fecha de salida: la regla del ${e.pctMinimo} % se mide cuando haya fecha. Hoy va en ${e.pct} %.`
  if (e.modo === 'ochenta') {
    const cuando = e.dias <= 0 ? 'El viaje es hoy' : `Faltan ${e.dias} día${e.dias === 1 ? '' : 's'} para el viaje`
    return `${cuando} · pagado ${e.pct} %`
  }
  let acumulado = 0
  let llega: string | null = null
  for (const c of [...cuotas].sort((a, b) => (a.fecha < b.fecha ? -1 : 1))) {
    acumulado += c.monto
    if (acumulado >= e.minimo) { llega = c.fecha; break }
  }
  const plan = llega ? ` y el plan llega a ${e.pctMinimo} % el ${fechaCortaEntrega(llega)}` : ''
  return `La regla del ${e.pctMinimo} % se mide desde el ${fechaCortaEntrega(e.desde!)}. Hoy va en ${e.pct} %${plan}.`
}

/**
 * ¿El plan llega al 80 % en T-15? Y ¿hay una cuota vencida sin pagar? (avisos T-30 y T-20, F4-5:
 * solo si el plan no llega o hay cuota vencida).
 */
export function riesgoDelPlan(e: EntradaCobroMinimo): { planLlega: boolean; cuotaVencida: boolean } {
  const est = cobroMinimo(e)
  if (!est.desde) return { planLlega: true, cuotaVencida: false }
  const alMinimo = e.cuotas.filter(c => c.fecha <= est.desde!).reduce((a, c) => a + Math.round(c.monto), 0)
  const vencido = e.cuotas.filter(c => c.fecha < e.hoy).reduce((a, c) => a + Math.round(c.monto), 0)
  return { planLlega: alMinimo >= est.minimo, cuotaVencida: Math.round(e.pagado) < vencido }
}

// ── Documentos del viajero (F4-2, C11) ───────────────────────────────────────

export type TipoDocumentoViajero = 'pasaporte' | 'visa' | 'asistencia_medica' | 'otro'

export const ETIQUETA_DOCUMENTO: Record<TipoDocumentoViajero, string> = {
  pasaporte: 'Pasaporte',
  visa: 'Visa',
  asistencia_medica: 'Asistencia médica',
  otro: 'Otro documento',
}

export interface DocumentoViajero {
  id: string
  tipo: TipoDocumentoViajero
  numero: string | null
  nombre_en_documento: string | null
  pais: string | null
  fecha_vencimiento: string | null
  archivo_ref: string | null
}

/** `destino_tipo` del bloque de la etapa 1: `true` internacional, `false` nacional, `null` sin dato. */
export function esInternacional(destinoTipo: unknown): boolean | null {
  if (typeof destinoTipo !== 'string') return null
  const t = destinoTipo.trim().toLowerCase()
  if (t.startsWith('internacional')) return true
  if (t.startsWith('nacional')) return false
  return null
}

/** «El pasaporte de Felipe vence el 2 mar 2027: menos de 6 meses después del regreso.» */
export function avisoVencimiento(doc: Pick<DocumentoViajero, 'tipo' | 'fecha_vencimiento' | 'nombre_en_documento'>, fechaRegreso: string | null, nombreContacto: string): string | null {
  if (doc.tipo !== 'pasaporte' || !doc.fecha_vencimiento || !fechaRegreso) return null
  const limite = sumarMeses(fechaRegreso, 6)
  if (doc.fecha_vencimiento >= limite) return null
  const quien = (doc.nombre_en_documento?.trim() || nombreContacto.trim() || 'del viajero').split(/\s+/)[0]
  const de = quien === 'del' ? 'del viajero' : `de ${quien}`
  return doc.fecha_vencimiento < fechaRegreso
    ? `El pasaporte ${de} vence el ${fechaConAnio(doc.fecha_vencimiento)}, antes del regreso.`
    : `El pasaporte ${de} vence el ${fechaConAnio(doc.fecha_vencimiento)}: menos de 6 meses después del regreso.`
}

export const TEXTO_VIAJE_NACIONAL = 'Viaje nacional: no pide pasaporte ni visa.'

/** Lo que el gate de documentos pide (solo internacional): un pasaporte vigente y sin aviso. */
export function faltaDocumentos(p: {
  internacional: boolean | null
  documentos: readonly DocumentoViajero[]
  fechaRegreso: string | null
  nombreContacto: string
}): string | null {
  if (p.internacional !== true) return null
  const pasaportes = p.documentos.filter(d => d.tipo === 'pasaporte')
  if (pasaportes.length === 0) return 'Falta el pasaporte del viajero.'
  const ok = pasaportes.some(d => !avisoVencimiento(d, p.fechaRegreso, p.nombreContacto))
  if (!ok) return avisoVencimiento(pasaportes[0], p.fechaRegreso, p.nombreContacto)
  return null
}

export const CAMPOS_PASAPORTE: CampoExtraccion[] = [
  { slug: 'numero', label: 'Número', tipo: 'texto', required: true, descripcion_ai: 'Número del pasaporte (letras y números, sin espacios).' },
  { slug: 'nombre', label: 'Nombre', tipo: 'texto', required: true, descripcion_ai: 'Nombres y apellidos del titular, como aparecen en el pasaporte.' },
  { slug: 'pais', label: 'País', tipo: 'texto', required: false, descripcion_ai: 'País que expide el pasaporte.' },
  { slug: 'fecha_emision', label: 'Fecha de expedición', tipo: 'fecha', required: false, descripcion_ai: 'Fecha de expedición (YYYY-MM-DD).' },
  { slug: 'fecha_vencimiento', label: 'Fecha de vencimiento', tipo: 'fecha', required: true, descripcion_ai: 'Fecha de vencimiento (YYYY-MM-DD).' },
]

export interface LecturaDocumento {
  numero: string | null
  nombre: string | null
  pais: string | null
  fecha_emision: string | null
  fecha_vencimiento: string | null
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/

function texto(v: CampoResultado | undefined, max: number): string | null {
  const t = String(v?.value ?? '').trim()
  return t ? t.slice(0, max) : null
}

function fecha(v: CampoResultado | undefined): string | null {
  const t = String(v?.value ?? '').trim().slice(0, 10)
  return FECHA.test(t) && !Number.isNaN(Date.parse(t)) ? t : null
}

/** La lectura propone; la persona confirma. */
export function documentoDesdeLectura(data: Record<string, CampoResultado>): LecturaDocumento {
  return {
    numero: texto(data.numero, 60)?.replace(/\s+/g, '').toUpperCase() ?? null,
    nombre: texto(data.nombre, 200),
    pais: texto(data.pais, 80),
    fecha_emision: fecha(data.fecha_emision),
    fecha_vencimiento: fecha(data.fecha_vencimiento),
  }
}

// ── Paquete de viaje (F4-4) ──────────────────────────────────────────────────

export interface PaqueteEnviado {
  enviado_at: string
  enviado_por: string | null
  archivo_ref: string | null
  huella_vouchers: string
  /** «Enviar igual» de la dirección: la aprobación y su motivo. */
  forzado: { aprobacion_id: string | null; motivo: string } | null
  correo: 'enviado' | 'omitido' | 'fallido' | null
}

export function leerPaqueteEnviado(metadata: unknown): PaqueteEnviado | null {
  const p = (metadata as { paquete_viaje?: Record<string, unknown> } | null)?.paquete_viaje
  if (!p || typeof p !== 'object' || typeof p.enviado_at !== 'string') return null
  const f = p.forzado as { aprobacion_id?: unknown; motivo?: unknown } | null | undefined
  return {
    enviado_at: p.enviado_at,
    enviado_por: typeof p.enviado_por === 'string' ? p.enviado_por : null,
    archivo_ref: typeof p.archivo_ref === 'string' ? p.archivo_ref : null,
    huella_vouchers: typeof p.huella_vouchers === 'string' ? p.huella_vouchers : '',
    forzado: f && typeof f.motivo === 'string' ? { aprobacion_id: typeof f.aprobacion_id === 'string' ? f.aprobacion_id : null, motivo: f.motivo } : null,
    correo: p.correo === 'enviado' || p.correo === 'omitido' || p.correo === 'fallido' ? p.correo : null,
  }
}

export const TEXTO_CAMBIO_VOUCHER = 'Cambió un voucher después de enviar.'

export interface DiaDelItinerario {
  /** `YYYY-MM-DD` o `null` para lo que no tiene día («Durante el viaje»). */
  fecha: string | null
  titulo: string
  lineas: string[]
}

/** El itinerario día a día desde los servicios (que nacieron de la tarifa aceptada). */
export function itinerarioDesdeServicios(filas: readonly FilaEntrega[], fechaSalida: string | null): DiaDelItinerario[] {
  const van = filas.filter(f => f.estado !== 'cancelado')
  const porFecha = new Map<string, FilaEntrega[]>()
  const sinFecha: FilaEntrega[] = []
  for (const f of van) {
    if (f.fecha_servicio) (porFecha.get(f.fecha_servicio) ?? porFecha.set(f.fecha_servicio, []).get(f.fecha_servicio)!).push(f)
    else sinFecha.push(f)
  }
  const linea = (f: FilaEntrega) =>
    [f.nombre, f.proveedor_nombre, f.localizador ? `localizador ${f.localizador}` : null].filter(Boolean).join(' · ')
  const dias: DiaDelItinerario[] = [...porFecha.keys()].sort().map(fecha => {
    const n = fechaSalida ? diasHasta(fechaSalida, fecha) + 1 : null
    return {
      fecha,
      titulo: n !== null && n >= 1 ? `Día ${n} · ${fechaConAnio(fecha)}` : fechaConAnio(fecha),
      lineas: porFecha.get(fecha)!.sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)).map(linea),
    }
  })
  if (sinFecha.length > 0) dias.push({ fecha: null, titulo: 'Durante el viaje', lineas: sinFecha.map(linea) })
  return dias
}

/**
 * El mensaje que acompaña el paquete (Noor §7.4, con el canal de Vera C1: lo manda la comercial
 * desde su WhatsApp con el PDF adjunto; por correo, además, si hay correo).
 */
export function mensajePaquete(p: {
  nombreCliente: string
  fechaSalida: string | null
  hoy: string
  nota: string | null
  comercial: string | null
  agencia: string
}): string {
  const nombre = p.nombreCliente.trim().split(/\s+/)[0] || 'Hola'
  const dias = p.fechaSalida ? diasHasta(p.hoy, p.fechaSalida) : null
  const cuando = p.fechaSalida && dias !== null && dias >= 0
    ? (dias <= 7 ? `para el ${['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'][new Date(`${p.fechaSalida}T00:00:00Z`).getUTCDay()]}` : `para el ${fechaCortaEntrega(p.fechaSalida)}`)
    : 'para tu viaje'
  const lineas = [
    `${nombre}, ¿todo listo ${cuando}? Aquí va tu paquete de viaje (te lo adjunto en PDF).`,
    '',
    ...(p.nota?.trim() ? [p.nota.trim(), ''] : []),
    'Ahí están el itinerario día a día, los vouchers y los teléfonos de emergencia. Cualquier cosa, escríbeme por aquí.',
    '',
    [p.comercial?.trim(), p.agencia.trim()].filter(Boolean).join(' · '),
  ]
  return lineas.join('\n')
}
