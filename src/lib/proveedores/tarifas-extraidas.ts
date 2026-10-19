/**
 * Las tarifas de una extracción del motor que una ficha puede usar para cotizar (Mauricio,
 * 2026-10-19, puntos 7 y 8 y «tarifario de cadena»). PURO.
 *
 *   · Vigencia confirmada: una extracción solo cuenta para cotizar cuando su carga está CERRADA
 *     (`estado = 'revisada'`) con vigencia desde y hasta. Si el motor no la fijó o la marcó para
 *     confirmar, la carga no se cierra hasta que una persona escribe las fechas
 *     (`vigenciaParaCerrar`).
 *   · Moneda: el motor propone la de cada fila; al revisar se cambia para todo el tarifario, por
 *     establecimiento o por fila. Manda la más específica: fila > establecimiento > tarifario >
 *     la del motor para la fila > la del tarifario del motor.
 *   · Cadena: un PDF puede cubrir varios hoteles (`tarifas[].establecimiento`). La ficha elige cuál
 *     es el suyo; solo esas filas cuentan. Si el tarifario trae más de uno y la ficha no eligió,
 *     no cuenta ninguna (no se adivina). Las filas sin establecimiento, en un tarifario de varios,
 *     tampoco: no se sabe de qué hotel son.
 *   · Conversión a la moneda de la cotización: NO está aquí. ONE no tiene TRM (R-P5, ver
 *     `costo-manual.ts`); la fuente se propone en el PR antes de construirla.
 */
import { esMoneda, establecimientosDe, llaveEstablecimiento, MONEDAS, vigenciaDelMotor, vigenciaPorConfirmar, type Moneda } from './extraccion'

type Obj = Record<string, unknown>
const esObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const lista = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])
const texto = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null)

// ── Moneda ───────────────────────────────────────────────────────────────────

/** Los cambios de moneda que hizo la persona al revisar (`proveedor_extracciones.monedas`). */
export interface AjustesMoneda {
  /** Para todo el tarifario. */
  tarifario?: Moneda | null
  /** Por establecimiento (la llave es el nombre tal como lo escribió el motor). */
  establecimientos?: Record<string, Moneda>
  /** Por fila: la llave es la posición de la fila en `tarifario.tarifas` (0, 1, 2…). */
  filas?: Record<string, Moneda>
}

const MAX_AJUSTES = 5000

/** Los ajustes como llegan del navegador, revisados contra el tarifario. */
export function revisarAjustesMoneda(entrada: unknown, tarifario: Obj | null): { ok: true; ajustes: AjustesMoneda } | { ok: false; error: string } {
  if (entrada === null || entrada === undefined) return { ok: true, ajustes: {} }
  if (!esObj(entrada)) return { ok: false, error: 'Los cambios de moneda no tienen la forma esperada.' }
  const ajustes: AjustesMoneda = {}
  if (entrada.tarifario !== undefined && entrada.tarifario !== null) {
    if (!esMoneda(entrada.tarifario)) return { ok: false, error: `Elige una moneda: ${MONEDAS.join(', ')}.` }
    ajustes.tarifario = entrada.tarifario
  }
  const filas = lista(tarifario?.tarifas).length
  const conocidos = new Set(establecimientosDe(tarifario).map(llaveEstablecimiento))
  if (entrada.establecimientos !== undefined && entrada.establecimientos !== null) {
    if (!esObj(entrada.establecimientos)) return { ok: false, error: 'Los cambios por establecimiento no tienen la forma esperada.' }
    const porEst: Record<string, Moneda> = {}
    for (const [e, m] of Object.entries(entrada.establecimientos).slice(0, MAX_AJUSTES)) {
      if (!conocidos.has(llaveEstablecimiento(e))) return { ok: false, error: `«${e}» no es un establecimiento de este tarifario.` }
      if (!esMoneda(m)) return { ok: false, error: `Elige una moneda para ${e}: ${MONEDAS.join(', ')}.` }
      porEst[e] = m
    }
    if (Object.keys(porEst).length > 0) ajustes.establecimientos = porEst
  }
  if (entrada.filas !== undefined && entrada.filas !== null) {
    if (!esObj(entrada.filas)) return { ok: false, error: 'Los cambios por fila no tienen la forma esperada.' }
    const porFila: Record<string, Moneda> = {}
    for (const [i, m] of Object.entries(entrada.filas).slice(0, MAX_AJUSTES)) {
      const n = Number(i)
      if (!/^\d+$/.test(i) || n >= filas) return { ok: false, error: 'Una fila cambiada ya no está en el tarifario. Recarga.' }
      if (!esMoneda(m)) return { ok: false, error: `Elige una moneda: ${MONEDAS.join(', ')}.` }
      porFila[String(n)] = m
    }
    if (Object.keys(porFila).length > 0) ajustes.filas = porFila
  }
  return { ok: true, ajustes }
}

/** La moneda con la que cuenta una fila (la más específica gana). `null` si nadie la dice. */
export function monedaDeFila(fila: unknown, indice: number, tarifario: Obj | null, ajustes: AjustesMoneda | null | undefined): Moneda | null {
  const a = ajustes ?? {}
  const porFila = a.filas?.[String(indice)]
  if (porFila) return porFila
  const est = esObj(fila) ? texto(fila.establecimiento) : null
  if (est && a.establecimientos) {
    const llave = llaveEstablecimiento(est)
    const hit = Object.entries(a.establecimientos).find(([e]) => llaveEstablecimiento(e) === llave)
    if (hit) return hit[1]
  }
  if (a.tarifario) return a.tarifario
  const propia = esObj(fila) ? fila.moneda : null
  if (esMoneda(propia)) return propia
  return esMoneda(tarifario?.moneda) ? tarifario.moneda : null
}

// ── Vigencia al cerrar la carga ──────────────────────────────────────────────

const FECHA = /^\d{4}-\d{2}-\d{2}$/
function fechaReal(v: unknown): string | null {
  if (typeof v !== 'string' || !FECHA.test(v.trim())) return null
  const s = v.trim()
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s ? s : null
}

/**
 * La vigencia con la que se cierra la carga. Si el motor la dejó por confirmar, las fechas de la
 * persona son obligatorias; si no, se toman las del motor, y la persona puede corregirlas.
 */
export function vigenciaParaCerrar(
  tarifario: Obj | null,
  escrita: { desde?: unknown; hasta?: unknown } | null | undefined,
): { ok: true; desde: string; hasta: string; por: 'motor' | 'persona' } | { ok: false; error: string } {
  const motor = vigenciaDelMotor(tarifario)
  const hayEscrita = !!(escrita && (texto(escrita.desde) || texto(escrita.hasta)))
  if (hayEscrita) {
    const desde = fechaReal(escrita?.desde)
    const hasta = fechaReal(escrita?.hasta)
    if (!desde || !hasta) return { ok: false, error: 'Escribe las dos fechas de la vigencia (desde y hasta).' }
    if (hasta < desde) return { ok: false, error: '«Hasta» no puede ser antes de «desde».' }
    return { ok: true, desde, hasta, por: motor.desde === desde && motor.hasta === hasta && !motor.requiereConfirmacion ? 'motor' : 'persona' }
  }
  if (vigenciaPorConfirmar(tarifario)) {
    return { ok: false, error: 'El tarifario no dice hasta cuándo vale con certeza: escribe la vigencia antes de cerrar la carga.' }
  }
  return { ok: true, desde: motor.desde as string, hasta: motor.hasta as string, por: 'motor' }
}

// ── Lo que cuenta para cotizar ───────────────────────────────────────────────

/** La extracción como la guarda ONE, con lo que decidió la persona. */
export interface ExtraccionCargada {
  estado: 'borrador' | 'revisada' | 'descartada'
  vigenciaDesde: string | null
  vigenciaHasta: string | null
  tarifario: Obj | null
  monedas: AjustesMoneda | null
}

export interface TarifaUsable {
  /** Posición de la fila en `tarifario.tarifas`. */
  indice: number
  fila: Obj
  establecimiento: string | null
  moneda: Moneda
  precio: number
}

export type MotivoNoCotiza = 'sin_cerrar' | 'sin_vigencia' | 'elegir_establecimiento' | 'establecimiento_no_esta'

export const TEXTO_NO_COTIZA: Record<MotivoNoCotiza, string> = {
  sin_cerrar: 'La carga del tarifario no se ha cerrado: confirma la vigencia y la moneda.',
  sin_vigencia: 'El tarifario no tiene vigencia confirmada.',
  elegir_establecimiento: 'El tarifario cubre varios establecimientos: elige cuál es el de esta ficha.',
  establecimiento_no_esta: 'El establecimiento elegido ya no está en el tarifario: vuelve a elegirlo.',
}

/**
 * Las filas que una ficha puede usar para cotizar. `establecimiento` es el que eligió la ficha
 * (`fotos_perfiles.tarifario_establecimiento`). Las filas sin precio numérico o sin moneda no
 * cuentan.
 */
export function tarifasParaCotizar(x: ExtraccionCargada, establecimiento: string | null | undefined): { ok: true; tarifas: TarifaUsable[] } | { ok: false; motivo: MotivoNoCotiza } {
  if (x.estado !== 'revisada') return { ok: false, motivo: 'sin_cerrar' }
  if (!fechaReal(x.vigenciaDesde) || !fechaReal(x.vigenciaHasta)) return { ok: false, motivo: 'sin_vigencia' }
  const ests = establecimientosDe(x.tarifario)
  const elegido = texto(establecimiento)
  let filtro: string | null = null
  if (elegido) {
    filtro = llaveEstablecimiento(elegido)
    if (!ests.some((e) => llaveEstablecimiento(e) === filtro)) return { ok: false, motivo: 'establecimiento_no_esta' }
  } else if (ests.length > 1) {
    return { ok: false, motivo: 'elegir_establecimiento' }
  }
  const tarifas: TarifaUsable[] = []
  lista(x.tarifario?.tarifas).forEach((fila, indice) => {
    if (!esObj(fila)) return
    const est = texto(fila.establecimiento)
    if (filtro !== null && (!est || llaveEstablecimiento(est) !== filtro)) return
    const precio = fila.precio
    if (typeof precio !== 'number' || !Number.isFinite(precio)) return
    const moneda = monedaDeFila(fila, indice, x.tarifario, x.monedas)
    if (!moneda) return
    tarifas.push({ indice, fila, establecimiento: est, moneda, precio })
  })
  return { ok: true, tarifas }
}
