import type { BorradorCotizacion } from '@/lib/cotizaciones/asistente/borrador'
import type { ClavePregunta, Redaccion, Requisitos } from './esquema'

/**
 * QUÉ PREGUNTA BLOQUEA LO DECIDE EL CÓDIGO (brief del 2026-11-04, «Lo que el código hace»).
 *
 * En la prueba del 2026-11-04 el modelo eligió preguntas distintas para el mismo pedido: el «ALTA 2026»
 * del Rodadero Dorado salió 1 de 4 veces. Aquí van reglas fijas sobre campos que el modelo COPIA tal
 * cual; el modelo solo redacta (`Redaccion`), y si no redactó una, va el texto de aquí.
 *
 *  1. Viajeros: faltan, o falta la edad de un niño. Es la única que impide armar la cotización (E-05).
 *  2. Tarifa: no se sabe si es pública o neta — la asesora no lo dijo y el operador declarado no es
 *     Aliados (R-14: en un bloqueo de Aliados la tarifa del pantallazo es la pública).
 *  3. Temporada: la del pantallazo trae un año y ninguno es el del viaje («ALTA 2026», viaje en 2027).
 *  4. «Compra antes del»: vence antes del pago probable (hoy + `DIAS_HASTA_EL_PAGO`).
 *  5. Niños gratis: la nota del hotel le aplica por edad a un niño del grupo.
 *
 * Una pregunta que la asesora ya contestó (`resueltas`) no vuelve.
 */

/**
 * Días desde hoy hasta la fecha probable del pago del cliente. Supuesto del piloto (no está en el manual
 * de Trappvel): el anticipo se paga en los días siguientes a la cotización. Se confirma con Trappvel.
 */
export const DIAS_HASTA_EL_PAGO = 3

export interface Pregunta {
  /** Su número en el mensaje (1, 2…). */
  numero: number
  clave: ClavePregunta
  pantallazo: number | null
  /** Por qué la eligió el código (queda en ONE). */
  motivo: string
  /** El texto que va en el mensaje: el del modelo o, si no lo redactó, el del código. */
  texto: string
}

export const llavePregunta = (clave: ClavePregunta, pantallazo: number | null) => `${clave}:${pantallazo ?? '-'}`

const sumarDias = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10)
const anio = (iso: string | null | undefined) => (iso && /^\d{4}/.test(iso) ? Number(iso.slice(0, 4)) : null)

/** Los años escritos en la temporada del pantallazo: «ALTA 2026» → [2026]; «2026-2027» → [2026, 2027]. */
export function aniosDeLaTemporada(t: string | null | undefined): number[] {
  return [...String(t ?? '').matchAll(/(?<!\d)(20\d{2})(?!\d)/g)].map(m => Number(m[1]))
}

/** ¿El operador declarado es Aliados? (R-14). */
export const esAliados = (operador: string | null | undefined) => /aliados/i.test(String(operador ?? ''))

/** La tarifa que se sabe sin preguntar: la que dijo la asesora o, en Aliados, la pública (R-14). */
export function tarifaSabida(r: Pick<Requisitos, 'tarifaDicha' | 'operadorDeclarado'>): 'publica' | 'neta' | null {
  return r.tarifaDicha ?? (esAliados(r.operadorDeclarado) ? 'publica' : null)
}

export function viajerosCompletos(r: Pick<Requisitos, 'viajeros'>): boolean {
  const v = r.viajeros
  if (!v || !Number.isInteger(v.adultos) || v.adultos < 1) return false
  return v.ninos.every(n => Number.isInteger(n.edad) && n.edad >= 0 && n.edad < 18)
}

interface Entrada {
  requisitos: Requisitos
  borrador: BorradorCotizacion | null
  redaccion: Redaccion[]
  /** `AAAA-MM-DD` (Bogotá). */
  hoy: string
  /** Llaves (`llavePregunta`) que la asesora ya contestó. */
  resueltas?: ReadonlySet<string>
}

export function preguntasQueBloquean(e: Entrada): Pregunta[] {
  const { requisitos: r, borrador: b, hoy } = e
  const resueltas = e.resueltas ?? new Set<string>()
  const crudas: Omit<Pregunta, 'numero' | 'texto'>[] = []
  const poner = (clave: ClavePregunta, pantallazo: number | null, motivo: string) => {
    if (!resueltas.has(llavePregunta(clave, pantallazo))) crudas.push({ clave, pantallazo, motivo })
  }

  if (!viajerosCompletos(r)) {
    poner('viajeros', null, r.viajeros ? 'Falta la edad de un niño.' : 'No se sabe cuántos viajan.')
  }
  if (!tarifaSabida(r)) poner('tarifa', null, 'La asesora no dijo si la tarifa es pública o neta y el operador declarado no es Aliados (R-14).')

  const anioViaje = new Set([anio(r.fechaIda), anio(r.fechaRegreso), ...(b?.vuelos ?? []).map(v => anio(v.fecha))].filter((x): x is number => x !== null))
  const pago = sumarDias(hoy, DIAS_HASTA_EL_PAGO)
  const edades = (r.viajeros?.ninos ?? []).map(n => n.edad)
  for (const h of b?.hoteles ?? []) {
    const anios = aniosDeLaTemporada(h.temporadaEnPantallazo ?? h.temporada)
    if (anios.length > 0 && anioViaje.size > 0 && !anios.some(a => anioViaje.has(a))) {
      poner('temporada', h.pantallazo, `La tarifa de ${h.nombre} dice «${h.temporadaEnPantallazo ?? h.temporada}» y el viaje es en ${[...anioViaje].join('-')}.`)
    }
    if (h.compraAntesDe && /^\d{4}-\d{2}-\d{2}$/.test(h.compraAntesDe) && h.compraAntesDe < pago) {
      poner('compraAntesDe', h.pantallazo, `${h.nombre}: «Compra antes del ${h.compraAntesDe}» vence antes del pago probable (${pago}).`)
    }
    const g = h.ninosGratis
    if (g) {
      const desde = g.edadDesde ?? 0, hasta = g.edadHasta ?? 17
      const aplica = edades.filter(x => x >= desde && x <= hasta)
      if (aplica.length > 0) poner('ninosGratis', h.pantallazo, `${h.nombre}: «${g.texto}» le aplica a un niño de ${aplica.join(' y ')} años.`)
    }
  }

  return crudas.map((p, i) => {
    const delModelo = e.redaccion.find(x => x.clave === p.clave && (x.pantallazo ?? null) === (p.pantallazo ?? null) && x.pregunta.trim())
      ?? (p.pantallazo === null ? null : e.redaccion.find(x => x.clave === p.clave && x.pantallazo === null && x.pregunta.trim()))
    return { ...p, numero: i + 1, texto: (delModelo?.pregunta.trim() || textoPorDefecto(p, b)).replace(/\s+/g, ' ') }
  })
}

function textoPorDefecto(p: Omit<Pregunta, 'numero' | 'texto'>, b: BorradorCotizacion | null): string {
  const hotel = b?.hoteles.find(h => h.pantallazo === p.pantallazo)?.nombre ?? 'el hotel'
  switch (p.clave) {
    case 'viajeros': return '¿Cuántos adultos viajan y qué edad tiene cada niño? Sin eso no armo la cotización.'
    case 'tarifa': return '¿La tarifa es pública o neta? Mientras tanto la dejé como pública.'
    case 'temporada': return `${p.motivo} ¿Aplica para estas fechas? Mientras tanto la dejé.`
    case 'compraAntesDe': return `${p.motivo} ¿La mantengo? Mientras tanto la dejé.`
    case 'ninosGratis': return `En ${hotel} ${p.motivo.split(': ').slice(1).join(': ')} ¿Aplica? Mientras tanto cobré al niño.`
  }
}

// ── «Trappi» no es un operador ─────────────────────────────────────────────────────────────────────
// Prueba real del 2026-11-07: el audio empezaba «Trappi, bloqueo para…», la transcripción dijo «Tratvi», el
// modelo lo puso como operador y la pregunta salió «¿La tarifa de Tratvi es pública o neta?».

const plano = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z]/g, '')

function distancia(a: string, b: string): number {
  const d = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    let diag = d[0]
    d[0] = i
    for (let j = 1; j <= b.length; j++) {
      const arriba = d[j]
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1))
      diag = arriba
    }
  }
  return d[b.length]
}

/** ¿Es el nombre del asistente (o una transcripción parecida: Trapi, Tratvi, Trapy, Trappy…)? */
export function esNombreDelAsistente(s: string | null | undefined): boolean {
  const p = plano(String(s ?? ''))
  return p.length >= 4 && distancia(p, 'trappi') <= 2
}

/** Si el modelo tomó el nombre del asistente por operador: operador null y fuera las redacciones que lo nombran. */
export function sinElAsistente<T extends { requisitos: Requisitos; redaccion: Redaccion[] }>(s: T): T {
  const op = s.requisitos.operadorDeclarado
  if (!esNombreDelAsistente(op)) return s
  const nombre = plano(op!)
  return {
    ...s,
    requisitos: { ...s.requisitos, operadorDeclarado: null },
    redaccion: s.redaccion.filter(r => !r.pregunta.split(/\s+/).some(w => plano(w) === nombre)),
  }
}
