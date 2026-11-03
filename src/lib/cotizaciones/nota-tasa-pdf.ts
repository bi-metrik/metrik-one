/**
 * La nota de la tasa de cambio en el PDF de la cotización (QA Trappvel 2026-10-29, H8 del viaje 06,
 * repetida en 07 y 09).
 *
 * El PDF daba precios fijos en pesos calculados con TRM 4.150 sin decir que hoteles y traslado se
 * pagan en dólares ni con qué tasa se calculó. Ahora, si alguna línea se costeó en otra moneda,
 * los términos llevan una tarjeta «Tasa de cambio» con qué servicios se pagan en qué moneda y la
 * tasa usada. Sin migración: la moneda y la tasa ya viven en cada línea (`tarifa_pax`).
 *
 * ⚠️ Es texto que lee el cliente: cualquier cambio lo revisa Vera antes de que llegue a uno. NO
 * dice hasta cuándo vale la tasa ni si el precio se ajusta si la TRM cambia: eso es una política
 * comercial que no está decidida.
 *
 * Puro: sin red, sin base.
 */

import { costoManualVigente } from './costo-manual'
import { ranuraDeGrupo } from './ranuras-pantallazo'
import { leerTarifaPax } from './tarifa-pasajero'
import { tasaComoTexto } from './tasa-cotizacion'

/** El título de la tarjeta en los términos del PDF. */
export const TITULO_TASA_DE_CAMBIO = 'Tasa de cambio'

export interface LineaParaNotaTasa {
  grupo?: string | null
  tarifa_pax?: unknown
  subtotal?: number | null
  es_ajuste?: boolean | null
}

const NOMBRE_MONEDA: Record<string, { plural: string; unidad: string }> = {
  USD: { plural: 'dólares', unidad: 'dólar' },
  EUR: { plural: 'euros', unidad: 'euro' },
  MXN: { plural: 'pesos mexicanos', unidad: 'peso mexicano' },
}

/** Cómo se nombra cada clase de servicio por la ranura de la línea (singular, plural). */
const CLASE: ReadonlyArray<{ slug: string; nombre: [string, string] }> = [
  { slug: 'hotel_detalle', nombre: ['el hotel', 'los hoteles'] },
  { slug: 'vuelo_detalle', nombre: ['el vuelo', 'los vuelos'] },
  { slug: 'traslado_detalle', nombre: ['el traslado', 'los traslados'] },
  { slug: 'actividad_detalle', nombre: ['la actividad', 'las actividades'] },
  { slug: 'paquete_detalle', nombre: ['el paquete', 'los paquetes'] },
]

function claseDe(grupo: string | null | undefined): number {
  const slug = ranuraDeGrupo(grupo)?.slug
  const i = CLASE.findIndex(c => c.slug === slug)
  return i === -1 ? CLASE.length : i
}

function nombreDeClase(i: number, n: number): string {
  if (i === CLASE.length) return n === 1 ? 'otro servicio' : 'otros servicios'
  return CLASE[i].nombre[n === 1 ? 0 : 1]
}

function lista(partes: readonly string[]): string {
  if (partes.length <= 1) return partes[0] ?? ''
  return `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

/** La moneda y la tasa de una línea costeada en otra moneda, o `null`. */
function monedaDeLinea(l: LineaParaNotaTasa): { moneda: string; tasa: number } | null {
  if (l.es_ajuste === true) return null
  const t = leerTarifaPax(l.tarifa_pax)
  const c = t.confirmada
  if (c && c.moneda && c.moneda.toUpperCase() !== 'COP' && typeof c.tasa === 'number' && c.tasa > 0) {
    return { moneda: c.moneda.toUpperCase(), tasa: c.tasa }
  }
  const m = t.costoManual
  if (m && m.moneda.toUpperCase() !== 'COP' && m.tasa > 0 && costoManualVigente(m, Number(l.subtotal) || 0)) {
    return { moneda: m.moneda.toUpperCase(), tasa: m.tasa }
  }
  return null
}

/**
 * Una viñeta por moneda (texto revisado por Vera el 2026-10-29): «Los hoteles y el traslado tienen
 * tarifa en dólares (USD). Sus valores en pesos en esta cotización se calcularon con una tasa de
 * $4.150 por dólar.» Con un solo servicio: «El hotel tiene tarifa en dólares (USD). Su valor en pesos
 * en esta cotización se calculó con una tasa de $4.150 por dólar.»
 * Vacío si todo está en pesos.
 */
export function notasDeTasaDeCambio(lineas: readonly LineaParaNotaTasa[]): string[] {
  const porMoneda = new Map<string, { tasas: number[]; clases: Map<number, number> }>()
  for (const l of lineas) {
    const m = monedaDeLinea(l)
    if (!m) continue
    const acc = porMoneda.get(m.moneda) ?? { tasas: [], clases: new Map<number, number>() }
    if (!acc.tasas.includes(m.tasa)) acc.tasas.push(m.tasa)
    const k = claseDe(l.grupo)
    acc.clases.set(k, (acc.clases.get(k) ?? 0) + 1)
    porMoneda.set(m.moneda, acc)
  }
  const out: string[] = []
  for (const [moneda, acc] of [...porMoneda.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const nombre = NOMBRE_MONEDA[moneda]
    const clases = [...acc.clases.entries()].sort(([a], [b]) => a - b).map(([k, n]) => nombreDeClase(k, n))
    const sujeto = lista(clases)
    const plural = acc.clases.size > 1 || [...acc.clases.values()].some(n => n > 1)
    const enMoneda = nombre ? `${nombre.plural} (${moneda})` : moneda
    const tasas = acc.tasas.sort((a, b) => a - b).map(t => `$${tasaComoTexto(t)}`)
    const porUnidad = nombre ? `por ${nombre.unidad}` : `por cada ${moneda}`
    out.push(
      `${sujeto.charAt(0).toUpperCase()}${sujeto.slice(1)} ${plural ? 'tienen' : 'tiene'} tarifa en ${enMoneda}. ` +
      `${plural ? 'Sus valores en pesos en esta cotización se calcularon' : 'Su valor en pesos en esta cotización se calculó'} con ${tasas.length === 1 ? 'una tasa' : 'tasas'} de ${lista(tasas)} ${porUnidad}.`,
    )
  }
  return out
}

/** Los términos con la tarjeta «Tasa de cambio» al final. Todo en pesos: los términos tal cual. */
export function terminosConTasaDeCambio(terminos: string | null, lineas: readonly LineaParaNotaTasa[]): string | null {
  const notas = notasDeTasaDeCambio(lineas)
  if (notas.length === 0) return terminos
  const bloque = `${TITULO_TASA_DE_CAMBIO}\n${notas.map(n => `- ${n}`).join('\n')}`
  const base = terminos?.trim()
  return base ? `${base}\n\n${bloque}` : bloque
}
