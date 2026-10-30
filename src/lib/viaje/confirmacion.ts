/**
 * «El cliente confirmó» (F2, etapa Confirmación): titular de facturación, mensaje al viajero,
 * prerreserva, permisos y gates de la etapa. Módulo puro (servidor y navegador).
 *
 * Canal al viajero (Vera C1): ONE redacta y la comercial lo manda desde el WhatsApp de la agencia
 * con un toque (`wa.me` con el texto listo); además sale por correo si el contacto lo tiene. Nunca
 * se dice que el mensaje «sale por WhatsApp» solo. Las condiciones van escritas en el mensaje,
 * sacadas de `terminos_base` de la línea, no como link (D-9). Sin link de pago propio de la
 * agencia, el mensaje no lleva `[link de pago]` (X1).
 */

import { describirOcupacion, type Composicion } from '@/lib/cotizaciones/tarifa-pasajero'
import { fechaCorta, pesos, type CuotaPlan } from './plan-pagos'
import { CONDICION_VISA_EN_TRAMITE_TU, TITULO_CONDICION_VISA } from './condicion-visa'
import { TOLERANCIA_SALDO_COP } from '@/lib/negocios/tolerancia-saldo'

// ── Titular de facturación (Vera C4, P3; Max §3.3) ───────────────────────────

export type TipoTitular = 'viajero' | 'empresa' | 'tercero'

export interface TitularFacturacion {
  tipo: TipoTitular
  /** 13 cédula, 22 cédula de extranjería, 31 NIT, 41 pasaporte (no se factura desde ONE). */
  tipo_documento: '13' | '22' | '31' | '41' | null
  numero_documento: string | null
  nombre: string
  correo: string | null
  telefono: string | null
  /**
   * Para el tercero de Siigo (F5): sin RUT, la dirección y la ciudad salen de aquí. Opcionales: la
   * confirmación no las exige; la cola de facturación las pide antes de emitir.
   */
  direccion?: string | null
  departamento?: string | null
  municipio?: string | null
}

const CORREO_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function correoValido(v: string | null | undefined): boolean {
  return !!v && CORREO_RE.test(v.trim())
}

export const AVISO_PASAPORTE = 'Con pasaporte no se puede facturar desde ONE; esta factura se hace por fuera.'

/**
 * Lee y valida el titular que llega de la hoja. Devuelve el titular normalizado o el motivo en
 * palabras. El viajero puede ir sin documento (la factura de persona natural sale en la etapa 6 y
 * se completa ahí); la empresa exige NIT y razón social; otra persona, cédula y nombre.
 */
export function leerTitular(raw: unknown, viajero: { nombre: string; correo: string | null; telefono: string | null }):
  | { ok: true; titular: TitularFacturacion; aviso: string | null }
  | { ok: false; error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const tipo = r.tipo === 'empresa' || r.tipo === 'tercero' ? r.tipo : r.tipo === 'viajero' ? 'viajero' : null
  if (!tipo) return { ok: false, error: 'Elige a nombre de quién va la factura.' }
  const texto = (v: unknown, max = 200) => (typeof v === 'string' && v.trim() !== '' ? v.trim().slice(0, max) : null)
  const correo = texto(r.correo, 254)
  if (correo && !correoValido(correo)) return { ok: false, error: 'El correo de facturación no parece válido.' }
  const numero = texto(r.numero_documento, 20)?.replace(/[\s.]/g, '') ?? null
  const tipoDoc = ['13', '22', '31', '41'].includes(String(r.tipo_documento)) ? (String(r.tipo_documento) as TitularFacturacion['tipo_documento']) : null
  // Dirección y ciudad: solo si vienen (las pide la facturación, F5; la confirmación no las exige).
  const ubicacion = ubicacionDelTitular(r)

  if (tipo === 'viajero') {
    return {
      ok: true,
      titular: {
        tipo,
        tipo_documento: numero ? (tipoDoc ?? '13') : null,
        numero_documento: numero,
        nombre: viajero.nombre,
        correo: correo ?? viajero.correo,
        telefono: viajero.telefono,
        ...ubicacion,
      },
      aviso: tipoDoc === '41' ? AVISO_PASAPORTE : null,
    }
  }
  if (tipo === 'empresa') {
    const nombre = texto(r.nombre)
    if (!nombre) return { ok: false, error: 'Escribe la razón social de la empresa.' }
    if (!numero || !/^\d{6,12}(-\d)?$/.test(numero)) return { ok: false, error: 'Escribe el NIT de la empresa.' }
    return { ok: true, titular: { tipo, tipo_documento: '31', numero_documento: numero, nombre, correo, telefono: texto(r.telefono, 30), ...ubicacion }, aviso: null }
  }
  const nombre = texto(r.nombre)
  if (!nombre) return { ok: false, error: 'Escribe el nombre de la persona a la que va la factura.' }
  if (!numero) return { ok: false, error: 'Escribe el documento de la persona a la que va la factura.' }
  const doc = tipoDoc && tipoDoc !== '31' ? tipoDoc : '13'
  return {
    ok: true,
    titular: { tipo, tipo_documento: doc, numero_documento: numero, nombre, correo, telefono: texto(r.telefono, 30), ...ubicacion },
    aviso: doc === '41' ? AVISO_PASAPORTE : null,
  }
}

/** Dirección, departamento y municipio del titular, solo los que vienen con texto. */
export function ubicacionDelTitular(r: Record<string, unknown>): Pick<TitularFacturacion, 'direccion' | 'departamento' | 'municipio'> {
  const t = (v: unknown, max: number) => (typeof v === 'string' && v.trim() !== '' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null)
  const out: Pick<TitularFacturacion, 'direccion' | 'departamento' | 'municipio'> = {}
  const d = t(r.direccion, 200)
  const dep = t(r.departamento, 80)
  const mun = t(r.municipio, 80)
  if (d) out.direccion = d
  if (dep) out.departamento = dep
  if (mun) out.municipio = mun
  return out
}

// ── Términos: de `terminos_base` a viñetas (D-9) ─────────────────────────────

export interface SeccionesTerminos {
  condiciones: string[]
  mediosPago: string[]
}

/**
 * Parte el texto base de términos en sus dos secciones («Condiciones generales» y «Medios de
 * pago»). Las viñetas anidadas (las cuentas) se conservan con su sangría en una sola línea.
 */
export function seccionesDeTerminos(texto: string | null | undefined): SeccionesTerminos {
  const out: SeccionesTerminos = { condiciones: [], mediosPago: [] }
  if (!texto) return out
  let actual: keyof SeccionesTerminos | null = null
  for (const linea of texto.split(/\r?\n/)) {
    const limpia = linea.trim()
    if (!limpia) continue
    const titulo = limpia.toLowerCase().replace(/[:.]$/, '')
    if (/^condiciones/.test(titulo)) { actual = 'condiciones'; continue }
    if (/^medios de pago/.test(titulo)) { actual = 'mediosPago'; continue }
    if (!actual) continue
    const m = /^(\s*)[-•*]\s+(.*)$/.exec(linea)
    if (!m) continue
    const anidada = m[1].length >= 2
    out[actual].push(anidada ? `  · ${m[2].trim()}` : m[2].trim())
  }
  return out
}

// ── Mensaje de confirmación (Noor §7.1 con las resoluciones de Vera) ─────────

export interface DatosMensajeConfirmacion {
  /** Nombre del viajero tal como está en el contacto; se usa el primer nombre. */
  nombreCliente: string
  destino: string | null
  fechaSalida: string | null
  fechaRegreso: string | null
  composicion: Composicion | null
  tarifaNombre: string | null
  total: number
  cuotas: readonly CuotaPlan[]
  /** Fecha en que debe llevar el mínimo, y el porcentaje. */
  fechaMinimo: string | null
  pctMinimo: number
  hoy: string
  terminos: SeccionesTerminos
  extra: string | null
  /** Firma: nombre de la comercial. */
  comercial: string | null
  agencia: string
  /** La Solicitud registra una visa en trámite: va la condición (`condicion-visa.ts`). */
  visaEnTramite?: boolean
}

export function primerNombre(nombre: string): string {
  const p = nombre.trim().split(/\s+/)[0] ?? ''
  return p || nombre.trim()
}

function rangoFechas(salida: string | null, regreso: string | null): string | null {
  if (!salida) return null
  if (!regreso || regreso === salida) return fechaCorta(salida)
  return `${fechaCorta(salida)} al ${fechaCorta(regreso)}`
}

/**
 * El texto exacto que recibe el viajero. Es la constancia de lo acordado (D6): se guarda tal
 * cual en el negocio y es el que abre `wa.me` y el que sale por correo.
 */
export function mensajeConfirmacion(d: DatosMensajeConfirmacion): string {
  const nombre = primerNombre(d.nombreCliente)
  const lineas: string[] = []
  lineas.push(`${nombre}, ¿todo bien con esto? Si algo no cuadra, respóndeme hoy.`)
  lineas.push('')
  const viaje = [d.destino, rangoFechas(d.fechaSalida, d.fechaRegreso)].filter(Boolean).join(', ')
  const quienes = d.composicion ? describirOcupacion(d.composicion, 'y') : null
  if (viaje || quienes) lineas.push(`*Tu viaje:* ${[viaje, quienes].filter(Boolean).join(' · ')}.`)
  if (d.tarifaNombre) lineas.push(`*Tarifa:* ${d.tarifaNombre}`)
  lineas.push(`*Total:* ${pesos(d.total)}`)
  lineas.push('')
  lineas.push('*Tu plan de pagos:*')
  d.cuotas.forEach((c, i) => {
    const cuando = c.fecha === d.hoy ? `hoy, ${fechaCorta(c.fecha)}` : fechaCorta(c.fecha)
    const nota = i === 0 && d.cuotas.length > 1 ? ' (anticipo)' : ''
    lineas.push(`${i + 1}. ${pesos(c.monto)} · ${cuando}${nota}`)
  })
  if (d.fechaMinimo && d.cuotas.length > 1) {
    lineas.push(`El ${fechaCorta(d.fechaMinimo)} debes llevar el ${d.pctMinimo} % pagado.`)
  }
  if (d.terminos.mediosPago.length > 0) {
    lineas.push('')
    lineas.push('*Cómo pagar:*')
    for (const m of d.terminos.mediosPago) lineas.push(m.startsWith('  ') ? m : `- ${m}`)
  }
  if (d.visaEnTramite) {
    lineas.push('')
    lineas.push(`*${TITULO_CONDICION_VISA}:*`)
    lineas.push(CONDICION_VISA_EN_TRAMITE_TU)
  }
  if (d.terminos.condiciones.length > 0) {
    lineas.push('')
    lineas.push('*Condiciones:*')
    for (const c of d.terminos.condiciones) lineas.push(`- ${c}`)
    lineas.push('Al pagar aceptas estas condiciones y la política de cancelación.')
  }
  lineas.push('Cuando pagues, mándame el comprobante por aquí.')
  const extra = d.extra?.trim()
  if (extra) {
    lineas.push('')
    lineas.push(extra)
  }
  lineas.push('')
  lineas.push([d.comercial?.trim(), d.agencia.trim()].filter(Boolean).join(' · '))
  return lineas.join('\n')
}

/** Solo dígitos, con el 57 si es un celular colombiano de 10 dígitos. `null` si no sirve. */
export function telefonoParaWa(tel: string | null | undefined): string | null {
  const d = (tel ?? '').replace(/\D/g, '')
  if (d.length === 10 && d.startsWith('3')) return `57${d}`
  if (d.length >= 11 && d.length <= 15) return d
  return null
}

/** El enlace que abre WhatsApp de la comercial con el mensaje listo. Sin teléfono, sin destinatario. */
export function enlaceWhatsApp(tel: string | null | undefined, texto: string): string {
  const n = telefonoParaWa(tel)
  return `https://wa.me/${n ?? ''}?text=${encodeURIComponent(texto)}`
}

// ── Prerreserva (Vera C9) ────────────────────────────────────────────────────

export interface Prerreserva {
  vence_at: string
  estado: 'vigente' | 'cumplida' | 'vencida'
}

export function leerPrerreserva(raw: unknown): Prerreserva | null {
  const r = raw as Partial<Prerreserva> | null | undefined
  if (!r || typeof r.vence_at !== 'string' || Number.isNaN(Date.parse(r.vence_at))) return null
  const estado = r.estado === 'cumplida' || r.estado === 'vencida' ? r.estado : 'vigente'
  return { vence_at: r.vence_at, estado }
}

/** ¿Venció sin anticipo? Con un pago confirmado, la prerreserva se cumplió y no vence. */
export function prerreservaVencida(p: Prerreserva | null, ahoraMs: number, hayPago: boolean): boolean {
  return !!p && p.estado === 'vigente' && !hayPago && Date.parse(p.vence_at) <= ahoraMs
}

const FMT_HORA = new Intl.DateTimeFormat('es-CO', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone: 'America/Bogota' })

export function horaBogota(isoTs: string): string {
  return FMT_HORA.format(new Date(isoTs)).replace(/\s/g, ' ')
}

export const MOTIVO_PRERRESERVA_VENCIDA = 'prerreserva vencida'
export const TEXTO_PRERRESERVA_VENCIDA =
  'Venció la prerreserva sin anticipo. La cotización volvió a armarse: revisa tarifas antes de enviarla de nuevo.'

// ── Permisos (Vera C15, §7.4) ────────────────────────────────────────────────

export interface QuienConfirma {
  role: string | null | undefined
  staffId: string | null | undefined
  areas: readonly string[] | null | undefined
  aprobadores: readonly string[]
  esResponsable: boolean
}

export function esAprobador(q: Pick<QuienConfirma, 'role' | 'staffId' | 'aprobadores'>): boolean {
  if (q.role === 'owner' || q.role === 'admin') return true
  return !!q.staffId && q.aprobadores.includes(q.staffId)
}

/**
 * Confirmar, cambiar el plan y mandar mensajes: la comercial dueña del negocio y la dirección.
 * Otra comercial lee; operaciones sola, no.
 */
export function puedeConfirmarCliente(q: QuienConfirma): boolean {
  if (esAprobador(q)) return true
  if (q.role === 'read_only' || q.role === 'contador') return false
  const comercial = (q.areas ?? []).includes('comercial') || (q.areas ?? []).includes('direccion')
  return comercial && q.esResponsable
}

// ── Gates de la etapa Confirmación (Max §5, Noor etapa 4) ────────────────────

export const GATES_CONFIRMACION = ['confirmacion_registrada', 'plan_pagos_acordado', 'anticipo_con_soporte'] as const
export type GateConfirmacion = (typeof GATES_CONFIRMACION)[number]

export const MENSAJES_GATE_CONFIRMACION: Record<GateConfirmacion, string> = {
  confirmacion_registrada: 'Falta registrar que el cliente confirmó. Toca «El cliente confirmó».',
  plan_pagos_acordado: 'Falta el plan de pagos acordado con el cliente.',
  anticipo_con_soporte: 'Para pasar a Reservas y pagos falta: el anticipo con su comprobante y la cuenta donde entró.',
}

export interface EstadoConfirmacion {
  confirmado: boolean
  /** Plan acordado y, si está fuera de la regla, con su aprobación vigente. */
  planVigente: boolean
  /** Algún pago confirmado con comprobante y cuenta receptora. */
  anticipoConSoporte: boolean
}

/** Lo que falta para salir de la etapa, en el orden de la etapa, con los textos de la línea si los declara. */
export function gatesConfirmacionPendientes(
  gates: readonly string[],
  estado: EstadoConfirmacion,
  mensajes: Record<string, string> = {},
): string[] {
  const out: string[] = []
  const pide = (g: GateConfirmacion) => gates.includes(g)
  if (pide('confirmacion_registrada') && !estado.confirmado) out.push(mensajes.confirmacion_registrada ?? MENSAJES_GATE_CONFIRMACION.confirmacion_registrada)
  if (pide('plan_pagos_acordado') && !estado.planVigente) out.push(mensajes.plan_pagos_acordado ?? MENSAJES_GATE_CONFIRMACION.plan_pagos_acordado)
  if (pide('anticipo_con_soporte') && !estado.anticipoConSoporte) out.push(mensajes.anticipo_con_soporte ?? MENSAJES_GATE_CONFIRMACION.anticipo_con_soporte)
  return out
}

/**
 * ¿Lo pagado con soporte ya cubre la cuota del anticipo del plan acordado? (QA G11, 2026-10-30)
 *
 * El gate `anticipo_con_soporte` se cumple con cualquier pago con comprobante (la regla de Edgar:
 * «sin dinero, así sea 1.000 pesos, no me muevo»), y eso sigue igual para quien avanza A MANO. Pero
 * el avance AUTOMÁTICO tras registrar el pago no puede anunciar «pagó el anticipo» con la pantalla
 * diciendo «Cuota 1 · anticipo: queda faltando $1.700.000»: con $1,5 M de $3,2 M el negocio pasó
 * solo a Reservas y pagos y operaciones recibió el aviso de reservar. Pasa solo con la cuota del
 * anticipo cubierta (dentro del piso de materialidad); sin plan acordado, como antes.
 */
export function anticipoDelPlanCubierto(
  cuotas: ReadonlyArray<{ numero: number; monto: number }> | null | undefined,
  cobros: ReadonlyArray<{ fecha: string | null; soporte: unknown; cuenta_recaudo?: string | null; monto?: number | null }>,
  tolerancia = TOLERANCIA_SALDO_COP,
): { cubierto: boolean; falta: number } {
  const lista = [...(cuotas ?? [])].sort((a, b) => a.numero - b.numero)
  const anticipo = Math.round(Number(lista[0]?.monto ?? 0))
  if (!(anticipo > 0)) return { cubierto: true, falta: 0 }
  const pagado = cobros.filter(esAnticipoConSoporte).reduce((a, c) => a + Math.round(Number(c.monto ?? 0)), 0)
  const falta = Math.max(0, anticipo - pagado)
  return { cubierto: falta <= tolerancia, falta }
}

/** ¿El cobro sirve como anticipo con soporte? Pago confirmado (con fecha), comprobante y cuenta. */
export function esAnticipoConSoporte(c: { fecha: string | null; soporte: unknown; cuenta_recaudo?: string | null; monto?: number | null }): boolean {
  if (!c.fecha || !(Number(c.monto ?? 0) > 0)) return false
  if (!c.cuenta_recaudo) return false
  const s = c.soporte
  if (!s) return false
  if (typeof s === 'string') return s.trim() !== ''
  if (Array.isArray(s)) return s.length > 0
  return typeof s === 'object' && Object.keys(s as object).length > 0
}
