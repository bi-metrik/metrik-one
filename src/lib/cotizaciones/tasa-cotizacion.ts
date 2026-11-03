/**
 * La tasa de cambio de la COTIZACIÓN, una por moneda (QA Trappvel 2026-10-29, H5 del viaje 06 y
 * H28 del viaje 09).
 *
 * Antes la tasa se escribía una vez POR LÍNEA: 4 veces en el viaje 06, 7 en el 07 y 11 en el 09,
 * cada una con su «Confirmar y cargar el costo». Y nada impedía dos TRM distintas en la misma
 * cotización por un error de dedo.
 *
 * ## Dónde vive, y por qué no hace falta DDL
 *
 * Cada línea ya guarda la tasa con que se costeó: `items.tarifa_pax.confirmada.tasa` (la tarifa
 * leída) o `items.tarifa_pax.costoManual.tasa` (el costo escrito a mano). La tasa de la
 * cotización para una moneda es la ÚLTIMA que se escribió en cualquiera de sus líneas en esa
 * moneda. Escribirla en una línea la propaga a las demás de la misma moneda (lo hace el servidor,
 * `aplicarTasaEnLaCotizacion`), y una línea nueva la toma sola al confirmarse sin tasa.
 *
 * ⚠️ El sistema sigue sin consultar la TRM (R-P5): si ninguna línea de esa moneda tiene tasa, no
 * hay tasa de la cotización y se pide, como siempre.
 *
 * Puro: sin red, sin base.
 */

import { costoManualVigente } from './costo-manual'
import { leerTarifaPax, monedaDeTarifa, type TarifaPax } from './tarifa-pasajero'

export interface TasaDeCotizacion {
  moneda: string
  /** Pesos por unidad de `moneda`. */
  tasa: number
  /** Cuándo se escribió (ISO). `null` si la línea no lo dice. */
  en: string | null
}

/** Una línea de la cotización, con lo justo para saber su moneda y su tasa. */
export interface LineaConTasa {
  id: string
  tarifa_pax: unknown
  /** `items.subtotal`: el costo unitario en pesos (para saber si el costo a mano sigue vigente). */
  subtotal?: number | null
  es_ajuste?: boolean | null
}

function tasaValida(t: unknown): t is number {
  return typeof t === 'number' && Number.isFinite(t) && t > 0
}

/** Las tasas que ya tiene una línea: la de su costo confirmado y la de su costo a mano. */
function tasasDeLinea(l: LineaConTasa): TasaDeCotizacion[] {
  const t = leerTarifaPax(l.tarifa_pax)
  const out: TasaDeCotizacion[] = []
  const c = t.confirmada
  if (c && c.moneda && c.moneda.toUpperCase() !== 'COP' && tasaValida(c.tasa)) {
    out.push({ moneda: c.moneda.toUpperCase(), tasa: c.tasa, en: c.confirmadaEn ?? null })
  }
  const m = t.costoManual
  if (m && m.moneda.toUpperCase() !== 'COP' && tasaValida(m.tasa)
    && (l.subtotal === undefined || costoManualVigente(m, Number(l.subtotal) || 0))) {
    out.push({ moneda: m.moneda.toUpperCase(), tasa: m.tasa, en: m.en ?? null })
  }
  return out
}

/**
 * La tasa de la cotización por moneda: la última escrita en sus líneas. `excepto` deja fuera una
 * línea (la que se está confirmando: su propia tasa vieja no cuenta como «la de la cotización»).
 */
export function tasasDeCotizacion(
  lineas: readonly LineaConTasa[],
  excepto?: string | null,
): Record<string, TasaDeCotizacion> {
  const out: Record<string, TasaDeCotizacion> = {}
  for (const l of lineas) {
    if (excepto && l.id === excepto) continue
    if (l.es_ajuste === true) continue
    for (const t of tasasDeLinea(l)) {
      const actual = out[t.moneda]
      if (!actual || (t.en ?? '') > (actual.en ?? '')) out[t.moneda] = t
    }
  }
  return out
}

/** La tasa de la cotización para una moneda, o `null` (en pesos, o si nadie la ha escrito). */
export function tasaDeCotizacionPara(
  lineas: readonly LineaConTasa[],
  moneda: string | null | undefined,
  excepto?: string | null,
): number | null {
  const m = (moneda ?? '').toUpperCase()
  if (!m || m === 'COP') return null
  return tasasDeCotizacion(lineas, excepto)[m]?.tasa ?? null
}

/** Qué hacer con cada línea de la misma moneda cuando se escribe la tasa en una. */
export interface PlanDePropagacion {
  /** Líneas con tarifa leída por (re)confirmar con la tasa nueva. */
  reconfirmar: string[]
  /** Líneas con costo escrito a mano en esa moneda: se recalculan sus pesos con la tasa nueva. */
  costoManual: { id: string; valor: number }[]
}

/**
 * A qué líneas llega la tasa escrita en `origenId`. Solo las de la MISMA moneda, y solo si su
 * tasa es otra (o no tienen): una línea ya costeada con esa tasa no se toca.
 *
 * ⚠️ Una moneda supuesta («$» sin código) no recibe tasa: primero hay que decir qué moneda es
 * (`MENSAJE_MONEDA_ASUMIDA`), igual que al confirmar a mano.
 */
export function planDePropagacion(
  lineas: readonly LineaConTasa[],
  moneda: string,
  tasa: number,
  origenId: string,
): PlanDePropagacion {
  const m = moneda.toUpperCase()
  const plan: PlanDePropagacion = { reconfirmar: [], costoManual: [] }
  if (m === 'COP' || !tasaValida(tasa)) return plan
  for (const l of lineas) {
    if (l.id === origenId || l.es_ajuste === true) continue
    const t: TarifaPax = leerTarifaPax(l.tarifa_pax)
    // El costo escrito a mano manda sobre la tarifa leída: si está vigente, es ese el que se ajusta.
    const manual = t.costoManual
    if (manual && costoManualVigente(manual, Number(l.subtotal) || 0)) {
      if (manual.moneda.toUpperCase() === m && manual.tasa !== tasa) plan.costoManual.push({ id: l.id, valor: manual.valor })
      continue
    }
    const tieneLectura = !!t.casillas?.grupo_completo || (t.habitaciones?.length ?? 0) > 0
    if (!tieneLectura) continue
    const mon = monedaDeTarifa(t)
    if (mon.asumida || mon.moneda !== m) continue
    const c = t.confirmada
    if (c && c.moneda.toUpperCase() === m && c.tasa === tasa) continue
    plan.reconfirmar.push(l.id)
  }
  return plan
}

/** La tasa como se escribe en la casilla, en formato colombiano: 4150 → «4.150»; 4150,5 → «4.150,5». */
export function tasaComoTexto(tasa: number): string {
  const [entero, dec] = String(Math.round(tasa * 10000) / 10000).split('.')
  const miles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return dec ? `${miles},${dec}` : miles
}

/** Lo que se dice debajo de la casilla de la tasa. */
export function textoAyudaTasa(moneda: string, esLaDeLaCotizacion: boolean): string {
  return esLaDeLaCotizacion
    ? `Es la tasa de la cotización para ${moneda.toUpperCase()}: puedes cambiarla, y el cambio llega a todas las líneas en ${moneda.toUpperCase()}. El sistema no consulta la TRM.`
    : `El sistema no consulta la TRM: la escribes tú una vez y llega a todas las líneas en ${moneda.toUpperCase()} de esta cotización.`
}

/** «La tasa quedó también en 3 líneas más en USD.» */
export function textoTasaPropagada(moneda: string, n: number): string {
  const m = moneda.toUpperCase()
  return n === 1
    ? `La tasa quedó también en 1 línea más en ${m}.`
    : `La tasa quedó también en ${n} líneas más en ${m}.`
}
