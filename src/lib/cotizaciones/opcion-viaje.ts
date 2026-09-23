/**
 * Lo que la pantalla de Trappvel dice de cada opción y de cada bloque, en palabras (P2 y P6
 * del ensayo del 2026-09-23, caso Providencia).
 *
 * Mauricio: *«No hay una diferencia visible entre bloques, no hay una línea lógica de qué se
 * debe hacer primero»*. La opción abierta mostraba siete campos para decir una sola cosa, y la
 * fila contraída un texto largo cortado. Aquí se arma, desde los campos leídos (y desde
 * `tramos` en los vuelos), lo que sirve:
 *
 *  · `fichaDeOpcion`: la ficha de lo que va a la cotización, en texto, sin campos.
 *  · `resumenDeOpcion`: lo que sirve para comparar opciones en la fila contraída.
 *  · `ordenarComoElViaje` y `tituloDeBloque`: los bloques en el orden del viaje, y los vuelos
 *    numerados con su ruta en códigos («Vuelo 1 · BOG → ADZ»).
 *  · `notaDeLaLinea`: la nota para el cliente, que es la descripción que escribió una
 *    PERSONA (la que armó ONE no es nota: se rearma de los campos).
 *
 * Puro, y solo lo usa el flujo de viaje (`lineasPorTipo`).
 */

import {
  cargoDeItem,
  equipajeDeTramo,
  hotelesDeItems,
  ranuraDelItem,
  tramosDelItem,
  vuelosDeItems,
  type ItemConLectura,
} from './detalle-viaje'
import { describirOcupacion, type Composicion } from './tarifa-pasajero'
import type { EquipajeTramo, TramoVuelo } from './tramos-vuelo'
import type { TipoRanura } from './ranuras-cotizacion'
import { diaDeLaSemana, leerFecha, lugarConCodigo } from '@/lib/pdf/cotizacion-trappvel-formato'

// ── La nota para el cliente ──────────────────────────────────────────────────

export { notaDeLaLinea } from './nota-linea'

// ── Piezas de texto ──────────────────────────────────────────────────────────

/** «BOG» de «Bogotá (BOG)» o de «BOG»; el nombre si no hay código. */
export function codigoDeLugar(texto: string | null | undefined): string | null {
  const t = (texto ?? '').trim()
  if (!t) return null
  if (/^[A-Z]{3}$/.test(t)) return t
  const l = lugarConCodigo(t)
  return l?.iata ?? l?.nombre ?? null
}

/** «lun 9 nov» desde «2026-11-09» o «9 nov 2026». Sin año no hay día de la semana. */
function diaCorto(texto: string | null | undefined): string | null {
  const f = leerFecha(texto ?? null)
  if (!f) return null
  const meses = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const semana = diaDeLaSemana(f)
  const cuando = `${f.dia} ${meses[f.mes]}`
  return semana ? `${semana.slice(0, 3).toLowerCase()} ${cuando}` : cuando
}

/** «personal, mano 10 kg, bodega 23 kg». El equipaje de la ficha, sin repetir «equipaje de». */
export function equipajeCorto(e: EquipajeTramo): string | null {
  if (e.personal === null && e.mano === null && e.bodega === null) return null
  const partes: string[] = []
  const pieza = (tipo: 'personal' | 'mano' | 'bodega') => {
    const p = e.piezas?.[tipo]
    const cuantas = p?.cantidad && p.cantidad > 1 ? `${p.cantidad} × ` : ''
    const kg = p?.pesoKg ? ` ${String(p.pesoKg).replace('.', ',')} kg` : ''
    return `${cuantas}${tipo}${kg}`
  }
  if (e.personal) partes.push(pieza('personal'))
  if (e.mano) partes.push(pieza('mano'))
  if (e.bodega) partes.push(pieza('bodega'))
  if (partes.length === 0) return 'sin equipaje incluido'
  // Lo que NO va se dice cuando se leyó que no va: es la línea que evita la discusión en el
  // mostrador (mismo criterio que la descripción de la lectura).
  const sin = (['mano', 'bodega'] as const).filter(t => e[t] === false)
  return sin.length > 0 && e.personal && !e.mano ? `${partes.join(', ')} (sin ${sin.join(' ni ')})` : partes.join(', ')
}

function tramoEnTexto(t: TramoVuelo, directoPorDefecto: boolean): string | null {
  const o = codigoDeLugar(t.origen)
  const d = codigoDeLugar(t.destino)
  const cuando = diaCorto(t.fecha)
  const sale = [o, t.salida].filter(Boolean).join(' ')
  const llega = [d, t.llegada].filter(Boolean).join(' ')
  const recorrido = sale || llega ? `${sale}${sale && llega ? ' → ' : ''}${llega}` : null
  const escala = t.escala ? `escala en ${t.escala}` : t.directo === true || (directoPorDefecto && t.directo !== false) ? 'directo' : null
  const partes = [cuando, recorrido, escala].filter(Boolean)
  if (partes.length === 0) return null
  return `${t.sentido === 'ida' ? 'Ida' : 'Regreso'} ${partes.join(' · ')}`
}

// ── La ficha ─────────────────────────────────────────────────────────────────

/**
 * La ficha de lo que va a la cotización, renglón por renglón (P2):
 *
 * ```
 * Avianca · AV 8520 / AV 8527 · Tarifa Classic
 * Ida lun 9 nov · BOG 06:05 → ADZ 08:20 · directo
 * Regreso vie 13 nov · ADZ 17:40 → BOG 19:55 · directo
 * Equipaje: personal, mano 10 kg, bodega 23 kg
 * 2 adultos, 1 infante
 * ```
 *
 * Solo lo leído: un renglón sin dato no sale. Vacío = la opción no tiene lectura.
 */
export function fichaDeOpcion(item: ItemConLectura, composicion: Composicion | null): string[] {
  const ranura = ranuraDelItem(item)
  const pax = composicion ? describirOcupacion(composicion) : null
  if (ranura?.slug === 'vuelo_detalle') {
    const [v] = vuelosDeItems([item])
    if (!v) return []
    const { tramos } = tramosDelItem(item)
    const ida = tramos.find(t => t.sentido === 'ida') ?? null
    const regreso = tramos.find(t => t.sentido === 'regreso') ?? null
    // Directo solo si la captura lo dijo de la ida; el regreso comparte la afirmación cuando la
    // ida es directa y el regreso no dice escala (la captura muestra los dos tramos iguales).
    const idaDirecta = ida?.directo === true
    const numeros = [v.numeros?.ida, v.numeros?.regreso].filter(Boolean).join(' / ') || v.numeroVuelo || null
    const cabecera = [v.aerolinea, numeros, v.tarifa ? `Tarifa ${v.tarifa}` : null].filter(Boolean).join(' · ')
    const equipaje = ida ? equipajeCorto(ida.equipaje) : null
    const leido = [
      cabecera || null,
      ida ? tramoEnTexto(ida, false) : null,
      regreso ? tramoEnTexto(regreso, idaDirecta && !regreso.escala) : null,
      equipaje ? `Equipaje: ${equipaje}` : null,
    ].filter((r): r is string => !!r)
    // Sin nada leído no hay ficha: los pasajeros solos no dicen qué se cotizó.
    return leido.length > 0 ? [...leido, ...(pax ? [pax] : [])] : []
  }
  if (ranura?.slug === 'hotel_detalle') {
    const [h] = hotelesDeItems([item])
    if (!h) return []
    const estrellas = h.estrellas ? ` ${'★'.repeat(h.estrellas)}` : ''
    const cargo = cargoDeItem(item)
    const fechas = h.checkIn || h.checkOut
      ? `${[h.checkIn, h.checkOut].filter(Boolean).join(' al ')}${h.noches ? ` · ${h.noches} ${h.noches === 1 ? 'noche' : 'noches'}` : ''}`
      : null
    const leido = [
      h.hotel ? `${h.hotel}${estrellas}${h.ciudad ? ` · ${h.ciudad}` : ''}` : null,
      [h.habitacion, h.regimen].filter(Boolean).join(' · ') || null,
      fechas,
      h.cancelacion ? `Cancelación: ${h.cancelacion}` : null,
      cargo ? `Se paga en destino: ${cargo.valor.toLocaleString('es-CO')}${cargo.moneda ? ` ${cargo.moneda}` : ''}` : null,
    ].filter((r): r is string => !!r)
    return leido.length > 0 ? [...leido, ...(pax ? [pax] : [])] : []
  }
  return []
}

/**
 * Lo que sirve para COMPARAR opciones en la fila contraída (P6):
 * «AV 8520 · ida 06:05 → 08:20 · regreso 17:40 · bodega 23 kg». En el hotel, habitación,
 * régimen y cancelación. `null` sin lectura: la fila muestra solo el nombre.
 */
export function resumenDeOpcion(item: ItemConLectura): string | null {
  const ranura = ranuraDelItem(item)
  if (ranura?.slug === 'vuelo_detalle') {
    const [v] = vuelosDeItems([item])
    if (!v) return null
    const { tramos } = tramosDelItem(item)
    const ida = tramos.find(t => t.sentido === 'ida') ?? null
    const regreso = tramos.find(t => t.sentido === 'regreso') ?? null
    const bodega = ida?.equipaje.bodega === false
      ? 'sin bodega'
      : ida?.equipaje.bodega
        ? `bodega${ida.equipaje.piezas?.bodega.pesoKg ? ` ${ida.equipaje.piezas.bodega.pesoKg} kg` : ''}`
        : null
    const partes = [
      v.numeros?.ida ?? v.numeroVuelo ?? v.aerolinea,
      ida?.salida ? `ida ${ida.salida}${ida.llegada ? ` → ${ida.llegada}` : ''}` : null,
      regreso?.salida ? `regreso ${regreso.salida}` : null,
      bodega,
    ].filter(Boolean)
    return partes.length > 0 ? partes.join(' · ') : null
  }
  if (ranura?.slug === 'hotel_detalle') {
    const [h] = hotelesDeItems([item])
    if (!h) return null
    const partes = [h.habitacion, h.regimen, h.cancelacion].filter(Boolean)
    return partes.length > 0 ? partes.join(' · ') : null
  }
  return null
}

/** La ruta de un vuelo en códigos: «BOG → ADZ». `null` sin origen ni destino leídos. */
export function rutaDeOpcion(item: ItemConLectura): string | null {
  if (ranuraDelItem(item)?.slug !== 'vuelo_detalle') return null
  const { tramos } = tramosDelItem(item)
  const ida = tramos.find(t => t.sentido === 'ida')
  const o = codigoDeLugar(ida?.origen)
  const d = codigoDeLugar(ida?.destino)
  return o && d ? `${o} → ${d}` : null
}

// ── Los bloques en el orden del viaje ────────────────────────────────────────

/** Lo mínimo de un bloque para ordenarlo. Las líneas se leen como `ItemConLectura`. */
export interface BloqueParaOrdenar<T = ItemConLectura> {
  grupo: string | null
  tipo: TipoRanura | null
  lineas: readonly T[]
}

/** Una línea de la pantalla, leída como lo que la ficha necesita (`grupo` puede venir ausente). */
function comoLectura(l: unknown): ItemConLectura {
  const x = l as ItemConLectura & { grupo?: string | null }
  return { ...x, grupo: x.grupo ?? null }
}

const RANGO_TIPO: Record<TipoRanura, number> = { vuelo: 0, hotel: 1, traslado: 2, actividad: 3 }

/** «2026-11-09 06:05» del primer tramo de ida, para ordenar. `--MM-DD` va después de lo fechado. */
function claveDeSalida(item: ItemConLectura): string | null {
  if (ranuraDelItem(item)?.slug !== 'vuelo_detalle') return null
  const ida = tramosDelItem(item).tramos.find(t => t.sentido === 'ida')
  if (!ida?.fecha) return null
  const fecha = ida.fecha.startsWith('--') ? `9999${ida.fecha.slice(1)}` : ida.fecha
  return `${fecha} ${ida.salida ?? '99:99'}`
}

/**
 * Los bloques como el viaje (P6): vuelos por el orden de su tramo (fecha y hora de la ida),
 * hotel, traslados, actividades y al final las líneas sueltas. A igual clave, el orden en que
 * venían: reordenar sin una razón movería cosas que nadie pidió mover.
 */
export function ordenarComoElViaje<B extends BloqueParaOrdenar<unknown>>(bloques: readonly B[]): B[] {
  const clave = (b: B): [number, string] => {
    if (!b.grupo || !b.tipo) return [9, '']
    if (b.tipo !== 'vuelo') return [RANGO_TIPO[b.tipo], '']
    const salidas = b.lineas.map(l => claveDeSalida(comoLectura(l))).filter((c): c is string => c !== null).sort()
    return [0, salidas[0] ?? '9999']
  }
  return bloques
    .map((b, i) => ({ b, i, k: clave(b) }))
    .sort((x, y) => x.k[0] - y.k[0] || (x.k[1] < y.k[1] ? -1 : x.k[1] > y.k[1] ? 1 : 0) || x.i - y.i)
    .map(x => x.b)
}

/**
 * El título de un bloque (P6): «Vuelo 1 · BOG → ADZ» con el nombre largo como subtítulo, o el
 * nombre de la ranura tal cual en los demás tipos. `numeroDeVuelo` es su lugar entre los
 * vuelos, ya ordenados como el viaje.
 */
export function tituloDeBloque(
  bloque: BloqueParaOrdenar<unknown> & { etiqueta: string | null },
  numeroDeVuelo: number | null,
): { titulo: string; subtitulo: string | null } {
  const etiqueta = bloque.etiqueta ?? ''
  if (bloque.tipo !== 'vuelo' || numeroDeVuelo === null) return { titulo: etiqueta, subtitulo: null }
  const ruta = bloque.lineas.map(l => rutaDeOpcion(comoLectura(l))).find((r): r is string => r !== null) ?? null
  return {
    titulo: `Vuelo ${numeroDeVuelo}${ruta ? ` · ${ruta}` : ''}`,
    subtitulo: etiqueta && etiqueta !== `Vuelo ${numeroDeVuelo}` ? etiqueta : null,
  }
}

/** El tipo de un bloque, con la palabra que se pinta: nunca el color solo (P6). */
export const NOMBRE_TIPO_BLOQUE: Record<TipoRanura | 'otro', string> = {
  vuelo: 'Vuelo',
  hotel: 'Hotel',
  traslado: 'Traslado',
  actividad: 'Actividad',
  otro: 'Otro',
}

/** Re-export para la pantalla: el equipaje largo del documento. */
export { equipajeDeTramo }
