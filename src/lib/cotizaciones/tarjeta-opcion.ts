/**
 * Lo que decide la TARJETA de una opción de viaje (prototipo aprobado por Mauricio el
 * 2026-09-24, `proyectos/trappvel/clarity/docs/diseno/prototipo-tarjeta-2026-09-24/`): la
 * tabla de costo y precio, el resumen del alojamiento y los textos que salen de los datos.
 *
 * La pantalla solo pinta lo que sale de aquí. Los precios salen de la misma regla que el
 * documento del cliente (`precioPorPasajero` / `precioPorHabitacion`, con los precios de fila
 * escritos a mano), para que la tarjeta y el PDF no puedan decir cifras distintas.
 *
 * Puro: sin red y sin base.
 */

import { aAdicional, etiquetaDeAdicional, type FilaAdicional } from './adicionales'
import { menoresDeDosAnios, precioPorHabitacion, type RepartoHabitaciones } from './habitaciones'
import { precioConMargen, type ConvencionMargen } from './precio-item'
import {
  aPesos,
  cantidadDeTipo,
  claveDeHabitacion,
  NOMBRE_TIPO,
  precioPorPasajero,
  TIPOS_PASAJERO,
  totalPasajeros,
  type Composicion,
  type CostoPorTipo,
  type PreciosAMano,
  type TarifaConfirmada,
  type TipoPasajero,
} from './tarifa-pasajero'
import { leerFecha } from '@/lib/pdf/cotizacion-trappvel-formato'

// ── Números ──────────────────────────────────────────────────────────────────

/** «2.360.000»: la cifra al peso, sin signo. */
export const mil = (n: number) => Math.round(Number(n) || 0).toLocaleString('es-CO')
/**
 * Reparte `total` pesos en proporción a `pesos`, al peso y sin perder ninguno (mayor resto).
 * Es lo que hace que las filas de la tabla sumen exactamente el precio de la línea.
 */
export function repartirAlPeso(total: number, pesos: readonly number[]): number[] {
  const t = Math.round(Number(total) || 0)
  const suma = pesos.reduce((a, p) => a + Math.max(0, p), 0)
  if (suma <= 0) return pesos.map(() => 0)
  const exactos = pesos.map(p => (t * Math.max(0, p)) / suma)
  const bases = exactos.map(e => Math.floor(e))
  let resto = t - bases.reduce((a, b) => a + b, 0)
  const orden = exactos.map((e, i) => ({ i, frac: e - Math.floor(e) })).sort((x, y) => y.frac - x.frac)
  for (const { i } of orden) {
    if (resto <= 0) break
    bases[i] += 1
    resto -= 1
  }
  return bases
}

/**
 * El «Precio total» de cada fila: la que tiene precio a mano, su precio por la cantidad; las
 * demás se reparten lo que queda del precio de la línea en proporción a su costo, al peso.
 * Multiplicar el precio unitario redondeado por la cantidad descuadraba la tabla contra el
 * precio de la opción (dos pesos en el caso del prototipo).
 */
function totalesDeLaLinea(filas: { aMano: boolean; unitario: number; cantidad: number; costo: number }[], precioLinea: number): number[] {
  const fijo = filas.reduce((a, f) => a + (f.aMano ? Math.round(f.unitario) * f.cantidad : 0), 0)
  const libres = filas.map((f, i) => ({ f, i })).filter(x => !x.f.aMano)
  const out = filas.map(f => (f.aMano ? Math.round(f.unitario) * f.cantidad : 0))
  const resto = Math.round(Number(precioLinea) || 0) - fijo
  if (libres.length === 0 || resto <= 0) {
    for (const { f, i } of libres) out[i] = Math.round(f.unitario) * f.cantidad
    return out
  }
  const repartido = repartirAlPeso(resto, libres.map(x => x.f.costo))
  libres.forEach((x, k) => { out[x.i] = repartido[k] })
  return out
}

/** «$2.360.000». */
export const pesos = (n: number) => `$${mil(n)}`
/** «15 %», «14,8 %». */
export const porcentaje = (v: number) => `${(Math.round(v * 10) / 10).toString().replace('.', ',')} %`

const PALABRAS: Record<TipoPasajero, [string, string]> = {
  adulto: ['adulto', 'adultos'],
  nino: ['niño', 'niños'],
  infante: ['infante', 'infantes'],
}
const plural = (n: number, t: TipoPasajero) => `${n} ${PALABRAS[t][n === 1 ? 0 : 1]}`

// ── La tabla de costo y precio ───────────────────────────────────────────────

export interface FilaCosto {
  /** `adulto` / `nino` / `infante`, `hab:N` o `adicional:<id>`: la llave de los precios a mano. */
  clave: string
  nombre: string
  /** La ocupación de una habitación, en la etiqueta gris. */
  det: string | null
  /** Es un adicional. */
  extra: boolean
  adicionalId: string | null
  cantidad: number
  /** En pesos. */
  costoUnitario: number
  /** En pesos. */
  precioUnitario: number
  precioTotal: number
  /** El precio lo escribió una persona. */
  aMano: boolean
  /** Vende por debajo de lo que cuesta. */
  bajoCosto: boolean
}

/** «2 adultos + 1 niño». */
export function ocupacionCorta(c: Composicion): string {
  const partes = TIPOS_PASAJERO.filter(t => cantidadDeTipo(c, t) > 0).map(t => plural(cantidadDeTipo(c, t), t))
  return partes.join(' + ')
}

/**
 * Las filas de la tabla: un tipo de pasajero por fila, o una habitación por fila cuando no
 * hay dos habitaciones del mismo tipo para sacar el precio de cada pasajero (R8, regla 8), y
 * al final los adicionales de la opción.
 *
 * `confirmada` solo si sigue vigente: con un costo viejo no hay filas que mostrar.
 * `precioLinea` es el precio de la línea que calculó la cascada, SIN los adicionales.
 */
export function filasDeCosto(a: {
  confirmada: TarifaConfirmada | null
  precioLinea: number
  preciosAMano?: PreciosAMano | null
  adicionales?: readonly FilaAdicional[] | null
}): FilaCosto[] {
  const filas: FilaCosto[] = []
  const c = a.confirmada
  if (c && c.costos.length > 0) {
    const precios = precioPorPasajero(c, a.precioLinea, a.preciosAMano)
    const costos = c.costos.filter(x => x.cantidad > 0)
    const totales = totalesDeLaLinea(costos.map(costo => {
      const p = precios.find(x => x.tipo === costo.tipo)
      return { aMano: !!p?.aMano, unitario: p?.precioUnitario ?? 0, cantidad: costo.cantidad, costo: costo.totalCOP }
    }), a.precioLinea)
    costos.forEach((costo, k) => {
      const p = precios.find(x => x.tipo === costo.tipo)
      const precioUnitario = p?.precioUnitario ?? 0
      filas.push({
        clave: costo.tipo,
        nombre: NOMBRE_TIPO[costo.tipo],
        det: null,
        extra: false,
        adicionalId: null,
        cantidad: costo.cantidad,
        costoUnitario: costo.unitarioCOP,
        precioUnitario,
        precioTotal: totales[k],
        aMano: !!p?.aMano,
        bajoCosto: precioUnitario < costo.unitarioCOP,
      })
    })
  } else if (c && (c.porHabitacion?.length ?? 0) > 0) {
    const precios = precioPorHabitacion(c.porHabitacion!, a.precioLinea, a.preciosAMano)
    const totales = totalesDeLaLinea(c.porHabitacion!.map(h => {
      const p = precios.find(x => x.numero === h.numero)
      return { aMano: !!p?.aMano, unitario: p?.precio ?? 0, cantidad: 1, costo: h.totalCOP }
    }), a.precioLinea)
    c.porHabitacion!.forEach((h, k) => {
      const p = precios.find(x => x.numero === h.numero)
      const precioUnitario = p?.precio ?? 0
      filas.push({
        clave: claveDeHabitacion(h.numero),
        nombre: `Habitación ${h.numero}`,
        det: ocupacionCorta(h.ocupacion),
        extra: false,
        adicionalId: null,
        cantidad: 1,
        costoUnitario: h.totalCOP,
        precioUnitario,
        precioTotal: totales[k],
        aMano: !!p?.aMano,
        bajoCosto: precioUnitario < h.totalCOP,
      })
    })
  }
  for (const fila of a.adicionales ?? []) {
    const ad = aAdicional(fila)
    const costo = aPesos(ad.costo, ad.moneda, ad.tasaCop) ?? 0
    const precio = aPesos(ad.precio, ad.moneda, ad.tasaCop) ?? 0
    filas.push({
      clave: `adicional:${ad.id}`,
      nombre: etiquetaDeAdicional(ad),
      det: null,
      extra: true,
      adicionalId: ad.id,
      cantidad: ad.cantidad,
      costoUnitario: costo,
      precioUnitario: precio,
      precioTotal: Math.round(precio * ad.cantidad),
      aMano: ad.precioManual,
      bajoCosto: precio < costo,
    })
  }
  return filas
}

export function totalesDeFilas(filas: readonly FilaCosto[]): { costo: number; precio: number } {
  return {
    costo: Math.round(filas.reduce((a, f) => a + f.costoUnitario * f.cantidad, 0)),
    precio: Math.round(filas.reduce((a, f) => a + f.precioTotal, 0)),
  }
}

/**
 * El precio de la línea cuando alguna fila tiene precio a mano: lo escrito a mano, más las
 * demás filas con el margen de la opción (la MISMA cuenta de la cascada: su costo con los
 * administrativos, `precioConMargen`). `null` si ninguna fila tiene precio a mano: entonces
 * el precio lo calcula la cascada como siempre.
 */
export function precioDeLineaConManuales(a: {
  confirmada: TarifaConfirmada
  preciosAMano: PreciosAMano | null | undefined
  margenPct: number
  convencion?: ConvencionMargen
  administrativosPct?: number
}): number | null {
  const filas = a.confirmada.costos.length > 0
    ? a.confirmada.costos.filter(c => c.cantidad > 0).map(c => ({ clave: c.tipo as string, cantidad: c.cantidad, costo: c.totalCOP }))
    : (a.confirmada.porHabitacion ?? []).map(h => ({ clave: claveDeHabitacion(h.numero), cantidad: 1, costo: h.totalCOP }))
  const aMano = a.preciosAMano ?? {}
  if (!filas.some(f => aMano[f.clave])) return null
  const fijo = filas.reduce((s, f) => s + (aMano[f.clave] ? Math.round(aMano[f.clave].precio) * f.cantidad : 0), 0)
  const libre = filas.reduce((s, f) => s + (aMano[f.clave] ? 0 : f.costo), 0)
  const admin = Math.max(0, Number(a.administrativosPct) || 0)
  const resto = libre > 0 ? precioConMargen(libre * (1 + admin / 100), a.margenPct, a.convencion) : 0
  return Math.round(fijo + resto)
}

// ── El alojamiento ───────────────────────────────────────────────────────────

export interface ResumenAlojamiento {
  /** «3 habitaciones · cubre a los 8 viajeros», «3 habitaciones · falta 1 infante». */
  titulo: string
  /** «6/6 adultos», con la marca de los que no están completos. */
  cupos: { texto: string; falta: boolean }[]
  /** «Falta» / «Faltan» y a quién: la caja ámbar que pide la habitación que falta. */
  falta: { verbo: 'Falta' | 'Faltan'; quien: string } | null
  habitaciones: number
}

const habitacionesTexto = (n: number) => (n === 1 ? '1 habitación' : `${n} habitaciones`)

/** Lo que falta, dicho como en el prototipo: «1 infante», «2 adultos y 1 niño». */
function quienes(c: Composicion): string {
  const partes = TIPOS_PASAJERO.filter(t => cantidadDeTipo(c, t) > 0).map(t => plural(cantidadDeTipo(c, t), t))
  return partes.length <= 1 ? partes.join('') : `${partes.slice(0, -1).join(', ')} y ${partes[partes.length - 1]}`
}

export function resumenDeAlojamiento(r: RepartoHabitaciones): ResumenAlojamiento {
  const n = r.habitaciones.filter(h => h.rol === 'habitacion').length
  const g = r.grupo
  const falta = r.faltan && totalPasajeros(r.faltan) > 0
    ? { verbo: (totalPasajeros(r.faltan) === 1 ? 'Falta' : 'Faltan') as 'Falta' | 'Faltan', quien: quienes(r.faltan) }
    : null
  const titulo = falta
    ? `${habitacionesTexto(n)} · ${falta.verbo.toLowerCase()} ${falta.quien}`
    : g ? `${habitacionesTexto(n)} · cubre a los ${totalPasajeros(g)} viajeros` : habitacionesTexto(n)
  const cupos = g
    ? TIPOS_PASAJERO.filter(t => cantidadDeTipo(g, t) > 0).map(t => {
      const cubre = cantidadDeTipo(r.cubiertos, t)
      const total = cantidadDeTipo(g, t)
      return { texto: `${cubre}/${total} ${PALABRAS[t][total === 1 ? 0 : 1]}`, falta: cubre < total }
    })
    : []
  return { titulo, cupos, falta, habitaciones: n }
}

/** Las edades que dice el texto de ocupación de la captura, por tipo de menor. */
function edadesDe(texto: string | null | undefined): { ninos: number[]; infantes: number[] } {
  const out = { ninos: [] as number[], infantes: [] as number[] }
  if (!texto) return out
  const t = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  for (const g of t.matchAll(/(?:ninos?|menor(?:es)?|child(?:ren)?|kids?)\s*\(([^)]*)\)/g)) {
    for (const e of g[1].matchAll(/\d+/g)) {
      const edad = Number(e[0])
      if (edad < 2) out.infantes.push(edad)
      else out.ninos.push(edad)
    }
  }
  for (const g of t.matchAll(/(?:infantes?|bebes?|infants?|babies|baby)\s*\(([^)]*)\)/g)) {
    for (const e of g[1].matchAll(/\d+/g)) out.infantes.push(Number(e[0]))
  }
  return out
}

const edadTexto = (edades: number[]) => {
  if (edades.length === 0) return ''
  const n = edades.length === 1 ? edades[0] : null
  const lista = edades.length === 1 ? String(edades[0]) : `${edades.slice(0, -1).join(', ')} y ${edades[edades.length - 1]}`
  return ` (${lista} ${n === 1 ? 'año' : 'años'})`
}

/**
 * «2 adultos + 1 niño (5 años)»: la ocupación de una habitación con las edades que dice la
 * captura. La del menor que la captura llama niño y ONE cuenta como infante no se repite:
 * la dice la nota (`notaDeEdad`).
 */
export function ocupacionConEdades(c: Composicion, texto: string | null | undefined): string {
  const e = edadesDe(texto)
  const renombrados = menoresDeDosAnios(texto)
  const partes: string[] = []
  if (c.adultos > 0) partes.push(plural(c.adultos, 'adulto'))
  if (c.ninos > 0) partes.push(`${plural(c.ninos, 'nino')}${e.ninos.length === c.ninos ? edadTexto(e.ninos) : ''}`)
  if (c.infantes > 0) {
    const propias = renombrados > 0 ? [] : e.infantes
    partes.push(`${plural(c.infantes, 'infante')}${propias.length === c.infantes ? edadTexto(propias) : ''}`)
  }
  return partes.join(' + ')
}

/**
 * «El pantallazo dice niño de 0 años: ONE lo cuenta como infante.» `null` si la captura no
 * llama niño a un menor de 2 años.
 */
export function notaDeEdad(texto: string | null | undefined): string | null {
  if (menoresDeDosAnios(texto) === 0) return null
  const t = (texto ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  let edad: number | null = null
  for (const g of t.matchAll(/(?:ninos?|menor(?:es)?|child(?:ren)?|kids?)\s*\(([^)]*)\)/g)) {
    for (const e of g[1].matchAll(/\d+/g)) if (Number(e[0]) < 2 && edad === null) edad = Number(e[0])
  }
  if (edad === null) return null
  return `El pantallazo dice niño de ${edad} ${edad === 1 ? 'año' : 'años'}: ONE lo cuenta como infante.`
}

/**
 * La acomodación de una opción con varias habitaciones, como la lee el cliente en el documento:
 * «3 habitaciones: 2 adultos + 1 niño; 2 adultos + 1 infante; 2 adultos». Solo las que cuentan
 * como habitación (la captura que solo sirve para restar no la ocupa nadie). `null` con una
 * sola: entonces manda lo que dijo el pantallazo.
 */
export function acomodacionDeHabitaciones(r: RepartoHabitaciones): string | null {
  const habs = r.habitaciones.filter(h => h.rol === 'habitacion' && h.ocupacion)
  if (habs.length < 2) return null
  return `${habs.length} habitaciones: ${habs.map(h => ocupacionCorta(h.ocupacion!)).join('; ')}`
}

/**
 * La nota de la habitación de solo adultos que ONE usa para restar: «ONE también la usa para
 * sacar el precio del niño (151.400) y del infante (22.000).» `null` si no sirve para restar.
 */
export function notaDeReferencia(
  sirveParaRestar: boolean,
  porTipo: readonly CostoPorTipo[] | null,
  /** `false` = la captura NO es una habitación del grupo: solo sirve para restar. */
  esHabitacion = true,
): string | null {
  if (!sirveParaRestar || !porTipo) return null
  const partes = porTipo
    .filter(c => c.tipo !== 'adulto')
    .map(c => `del ${PALABRAS[c.tipo][0]} (${mil(c.unitario)})`)
  if (partes.length === 0) return null
  return `ONE ${esHabitacion ? 'también ' : ''}la usa para sacar el precio ${partes.join(' y ')}.`
}

// ── La ficha ─────────────────────────────────────────────────────────────────

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']

/**
 * «23 al 25 nov 2026», «28 nov al 2 dic 2026», o las dos fechas enteras si cambian de año.
 * Con una sola, esa. `null` sin ninguna.
 */
export function fechasDeEstadia(entrada: string | null | undefined, salida: string | null | undefined): string | null {
  const a = leerFecha(entrada ?? null)
  const b = leerFecha(salida ?? null)
  if (!a && !b) return null
  if (!a || !b) return (entrada ?? salida ?? '').trim() || null
  const cola = (f: { dia: number; mes: number; anio: number | null }) => `${f.dia} ${MESES[f.mes]}${f.anio ? ` ${f.anio}` : ''}`
  if (a.anio === b.anio && a.mes === b.mes) return `${a.dia} al ${cola(b)}`
  if (a.anio === b.anio) return `${a.dia} ${MESES[a.mes]} al ${cola(b)}`
  return `${cola(a)} al ${cola(b)}`
}

/** «2 noches». */
export const nochesTexto = (n: number | null | undefined) => (n && n > 0 ? `${n} ${n === 1 ? 'noche' : 'noches'}` : null)
