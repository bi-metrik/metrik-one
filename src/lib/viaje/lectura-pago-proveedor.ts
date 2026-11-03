/**
 * Leer el soporte del pago a un proveedor (QA Trappvel 2026-10-29, M-12 / M3-3).
 *
 * ## Lo que pasaba
 *
 * «Subir archivo» en el pago a proveedor solo guardaba la foto: el valor quedaba en lo cotizado
 * (689.400 cuando se pagó 1.000.000), la fecha en hoy y el medio vacío, y no quedaba el número de
 * comprobante. El pago del viajero sí se leía con IA (`leerComprobantePago`, F2-4).
 *
 * ## Lo que hace ahora
 *
 * El mismo lector (`extractFieldsFromDocument`, Gemini) con los campos del comprobante del viajero
 * más los de un pago en otra moneda, y de lo leído una PROPUESTA que prellena el formulario. Nada
 * se registra solo: la asesora revisa y toca «Registrar pago».
 *
 * Puro: sin red, sin base.
 */

import type { CampoExtraccion } from '@/lib/ai/extract-fields'
import { normalizarMontoExtraido } from '@/lib/ai/monto-extraido'
import { CAMPOS_COMPROBANTE } from './riel-cobro'
import { tasaPagoValida, type MonedaDelServicio } from './moneda-servicio'
import type { MedioPagoProveedor } from './reglas-pago'

const DEL_VIAJERO = ['monto', 'fecha', 'banco_origen', 'destinatario', 'referencia']

/** Los campos del comprobante del viajero que sirven aquí, y los de un pago en otra moneda. */
export const CAMPOS_PAGO_PROVEEDOR: CampoExtraccion[] = [
  ...CAMPOS_COMPROBANTE.filter(c => DEL_VIAJERO.includes(c.slug)),
  { slug: 'cuenta_origen', label: 'Cuenta de origen', tipo: 'texto', required: false, descripcion_ai: 'Número de la cuenta o tarjeta desde donde SALIÓ el dinero, o sus últimos dígitos visibles. Solo dígitos.' },
  { slug: 'moneda', label: 'Moneda del pago', tipo: 'texto', required: false, descripcion_ai: 'Si el pago se hizo por un valor en otra moneda (USD, EUR...), su código de tres letras. Vacío si fue solo en pesos.' },
  { slug: 'monto_moneda', label: 'Monto en la otra moneda', tipo: 'numero', required: false, descripcion_ai: 'El valor en esa otra moneda, tal como aparece (por ejemplo 2,084.40). Vacío si fue solo en pesos.' },
  { slug: 'tasa_cambio', label: 'TRM o tasa de cambio', tipo: 'numero', required: false, descripcion_ai: 'La TRM o tasa de cambio aplicada (pesos por unidad de la otra moneda), si aparece.' },
]

export interface LecturaPagoProveedor {
  /** Pesos que salieron. */
  monto: number | null
  fecha: string | null
  /** El medio configurado que coincide con la cuenta o el banco de origen. */
  medioId: string | null
  /** Número de comprobante. */
  referencia: string | null
  banco: string | null
  destinatario: string | null
  /** Solo si el servicio se cotizó en esa misma moneda. */
  moneda: string | null
  montoMoneda: number | null
  /** TRM del pago, solo si es creíble frente a la cotizada (±20 %). */
  tasa: number | null
}

/**
 * Un número leído en cualquiera de los dos formatos: «2,084.40», «2.084,40», «4.230», «2084.4».
 * Con los dos separadores, el último es el decimal; con uno solo repetido, son miles; con uno solo
 * una vez, es de miles si lo siguen exactamente tres dígitos.
 */
export function numeroLeido(texto: string | null | undefined): number | null {
  if (typeof texto !== 'string') return null
  let t = texto.replace(/[^\d.,-]/g, '')
  if (!/\d/.test(t)) return null
  const ultPunto = t.lastIndexOf('.')
  const ultComa = t.lastIndexOf(',')
  if (ultPunto >= 0 && ultComa >= 0) {
    const dec = ultPunto > ultComa ? '.' : ','
    const miles = dec === '.' ? ',' : '.'
    t = t.split(miles).join('').replace(dec, '.')
  } else {
    const sep = ultPunto >= 0 ? '.' : ultComa >= 0 ? ',' : null
    if (sep) {
      const partes = t.split(sep)
      if (partes.length > 2 || partes[1].length === 3) t = partes.join('')
      else t = partes.join('.')
    }
  }
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

function digitos(t: string | null | undefined): string {
  return (t ?? '').replace(/\D/g, '')
}

function sinTildes(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/**
 * El medio del espacio que coincide con lo leído: primero por los últimos 4 dígitos de la cuenta
 * de origen («Tarjeta empresa ••4417»), y si no, por el banco cuando lo nombra UN solo medio. Si
 * hay duda, ninguno: lo escoge la asesora.
 */
export function medioPorLectura(medios: readonly MedioPagoProveedor[], cuentaOrigen: string | null, banco: string | null): string | null {
  const d = digitos(cuentaOrigen)
  if (d.length >= 4) {
    const fin = d.slice(-4)
    const porCuenta = medios.filter(m => digitos(m.label).endsWith(fin))
    if (porCuenta.length === 1) return porCuenta[0].id
  }
  const b = sinTildes((banco ?? '').trim()).split(/\s+/)[0] ?? ''
  if (b.length >= 3) {
    const porBanco = medios.filter(m => sinTildes(m.label).includes(b))
    if (porBanco.length === 1) return porBanco[0].id
  }
  return null
}

/** De los campos leídos a la propuesta que la asesora confirma. `moneda`: la del servicio. */
export function propuestaPagoProveedor(
  campos: Record<string, { value: string | null } | undefined>,
  ctx: { medios: readonly MedioPagoProveedor[]; moneda: MonedaDelServicio | null },
): LecturaPagoProveedor {
  const v = (k: string) => {
    const x = campos[k]?.value
    return typeof x === 'string' && x.trim() !== '' ? x.trim() : null
  }
  const montoTxt = v('monto')
  const montoN = montoTxt ? Math.round(Number(normalizarMontoExtraido(montoTxt))) : NaN
  const monto = Number.isFinite(montoN) && montoN > 0 ? montoN : null
  const fecha = v('fecha')
  const banco = v('banco_origen')

  // Moneda: solo cuenta si es la misma en que se cotizó el servicio.
  let moneda: string | null = null
  let montoMoneda: number | null = null
  let tasa: number | null = null
  const leida = (v('moneda') ?? '').toUpperCase().replace(/[^A-Z]/g, '')
  const m = ctx.moneda
  if (m && leida === m.moneda) {
    moneda = m.moneda
    const mm = numeroLeido(v('monto_moneda'))
    montoMoneda = mm !== null && mm > 0 ? Math.round(mm * 100) / 100 : null
    let t = numeroLeido(v('tasa_cambio'))
    // Sin TRM escrita, la que resulta de los pesos y el monto en la moneda.
    if ((t === null || !(t > 0)) && monto && montoMoneda) t = Math.round((monto / montoMoneda) * 100) / 100
    tasa = t !== null && tasaPagoValida(t, m.tasa) ? t : null
  }

  return {
    monto,
    fecha: fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) ? fecha : null,
    medioId: medioPorLectura(ctx.medios, v('cuenta_origen'), banco),
    referencia: v('referencia')?.slice(0, 120) ?? null,
    banco,
    destinatario: v('destinatario'),
    moneda,
    montoMoneda,
    tasa,
  }
}

function pesos(n: number): string {
  return '$' + Math.round(n).toLocaleString('es-CO').replace(/,/g, '.')
}

/**
 * Lo que la asesora tiene que ver ANTES de registrar: el valor leído no es lo que faltaba pagar, o
 * el soporte dice otro destinatario. `esperado`: lo que faltaba pagar del servicio (en pesos).
 */
export function avisosDeLectura(
  l: Pick<LecturaPagoProveedor, 'monto' | 'destinatario'>,
  esperado: number,
  proveedor: string | null,
): string[] {
  const out: string[] = []
  const esp = Math.round(Number(esperado) || 0)
  if (l.monto !== null && esp > 0 && l.monto !== esp) {
    const d = l.monto - esp
    out.push(`El soporte dice ${pesos(l.monto)} y faltaba pagar ${pesos(esp)} (${d > 0 ? '+' : '−'}${pesos(Math.abs(d))}).`)
  }
  const dest = sinTildes(l.destinatario ?? '').replace(/[^a-z0-9 ]/g, ' ')
  const prov = sinTildes(proveedor ?? '').replace(/[^a-z0-9 ]/g, ' ')
  const palabras = prov.split(/\s+/).filter(p => p.length >= 4)
  if (dest.trim() && palabras.length > 0 && !palabras.some(p => dest.includes(p))) {
    out.push(`El soporte dice que se le pagó a «${(l.destinatario ?? '').trim()}», no a ${proveedor?.trim()}: revísalo.`)
  }
  return out
}
