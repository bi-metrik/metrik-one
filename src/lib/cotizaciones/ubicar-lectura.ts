/**
 * Dónde queda una captura YA LEÍDA de la bandeja (H1 y H2 de la prueba del 2026-09-24).
 *
 * Lo decide el servidor al «Aceptar», contra lo que la cotización tiene EN ESE MOMENTO; la
 * bandeja usa la misma función para decir, antes de aceptar, a dónde va a ir. Si cada lado
 * decidiera por su cuenta, la fila diría «Opción 2 de Hotel en Providencia» y la captura
 * caería en otra parte.
 *
 * ## Hotel (R8, regla 1)
 *
 *  1. Mismo hotel y mismas fechas que una opción → es una HABITACIÓN de esa opción.
 *  2. Otro hotel con las mismas fechas y el mismo destino → otra OPCIÓN de esa ranura. Solo
 *     abre ranura nueva con otras fechas u otra ciudad. Hasta el 2026-09-24 esto decidía solo
 *     por el lugar que leyó el detector, y «Providencia» contra «Isla de Providencia» abría
 *     «Hotel 2 en Providencia» (H1).
 *  3. Sin fechas que comparar, el lugar, como siempre (`ubicarCaptura`).
 *
 * Los demás tipos siguen con `ubicarCaptura`.
 *
 * Puro: las líneas de la cotización entran por parámetro.
 */

import { lugarComparable, ubicarCaptura, type CapturaDetectada, type RanuraCandidata } from './bandeja-capturas'
import {
  claveOpcionHotel,
  habitacionesDeTarifa,
  mismaImagenEnHabitaciones,
  mismasFechasHotel,
  opcionDelMismoHotel,
  sobraLaCaptura,
} from './habitaciones'
import { normalizarGrupo } from './itinerarios'
import { lugarDeOpcion } from './opcion-viaje'
import { ranurasDelTipo, type TipoRanura } from './ranuras-cotizacion'
import { ranuraDeGrupo } from './ranuras-pantallazo'
import { leerTarifaPax, type Composicion, type LecturaCasilla } from './tarifa-pasajero'

export interface LineaParaUbicar {
  id: string
  grupo?: string | null
  nombre?: string | null
  tarifa_pax?: unknown
  tramos?: unknown
  es_ajuste?: boolean | null
}

export type DestinoDeLectura =
  /** Habitación de esta opción. `sobra`: el grupo ya está cubierto (regla 6): se pregunta. */
  | { como: 'habitacion'; itemId: string; grupo: string; sobra: boolean }
  | { como: 'hermana'; grupo: string }
  | { como: 'nueva' }

/** Las ranuras del tipo, cada una con el primer lugar o ruta que alguna de sus opciones leyó. */
export function ranurasConLugar(lineas: readonly LineaParaUbicar[], tipo: TipoRanura) {
  const ls = lineas as { id: string; grupo?: string | null; es_ajuste?: boolean | null; nombre?: string | null; tarifa_pax?: unknown; tramos?: unknown }[]
  return ranurasDelTipo(ls, tipo).map(r => {
    const clave = normalizarGrupo(r.grupo)
    const lugares = ls
      .filter(i => normalizarGrupo(i.grupo ?? null) === clave)
      .map(i => lugarDeOpcion({ nombre: i.nombre ?? null, grupo: i.grupo ?? null, tarifa_pax: i.tarifa_pax, tramos: i.tramos }))
    return {
      ...r,
      lugar: lugares.find(l => l.lugar)?.lugar ?? null,
      origen: lugares.find(l => l.origen)?.origen ?? null,
      destino: lugares.find(l => l.destino)?.destino ?? null,
    }
  })
}

/**
 * ¿Pueden ser el mismo destino? `false` solo cuando los dos dicen algo y no se parecen:
 * «Providencia» y «Isla de Providencia» sí (uno contiene al otro, palabra por palabra), y
 * «Providencia Island» también. `null` = alguno no dice nada.
 */
export function lugaresCompatibles(a: string | null | undefined, b: string | null | undefined): boolean | null {
  const x = lugarComparable(a)
  const y = lugarComparable(b)
  if (!x || !y) return null
  if (x.codigo && y.codigo) return x.codigo === y.codigo
  if (!x.nombre || !y.nombre) return null
  if (x.nombre === y.nombre) return true
  const contiene = (grande: string, chico: string) => ` ${grande} `.includes(` ${chico} `)
  return contiene(x.nombre, y.nombre) || contiene(y.nombre, x.nombre)
}

const RANURA_HOTEL = 'hotel_detalle'

export function ubicarLectura(args: {
  tipo: TipoRanura
  lectura: LecturaCasilla
  /** Lo que dijo el detector de la captura. */
  pistas: { lugar: string | null; origen: string | null; destino: string | null }
  lineas: readonly LineaParaUbicar[]
  /** El grupo del negocio: con él se sabe si una habitación sobra. */
  grupoViaje: Composicion | null
  /** «Agregar como otra opción»: nunca se une como habitación. */
  sinHabitacion?: boolean
}): DestinoDeLectura {
  const { tipo, lectura, pistas, lineas, grupoViaje } = args
  const vivas = lineas.filter(l => l.es_ajuste !== true)
  const pseudo = { nombre: lectura.nombre ?? null, grupo: tipo, tarifa_pax: { casillas: { grupo_completo: lectura } } }
  const lugarLeido = lugarDeOpcion(pseudo).lugar ?? pistas.lugar

  if (tipo === 'hotel') {
    const hoteles = vivas.filter(l => ranuraDeGrupo(l.grupo ?? null)?.slug === RANURA_HOTEL)
    if (!args.sinHabitacion) {
      const destino = opcionDelMismoHotel(lectura, hoteles.map(l => ({ id: l.id, tarifa: leerTarifaPax(l.tarifa_pax) })))
      if (destino) {
        const suyas = habitacionesDeTarifa(destino.tarifa)
        const sobra = mismaImagenEnHabitaciones(suyas, lectura.huellaImagen) || sobraLaCaptura(suyas, lectura, grupoViaje)
        const linea = hoteles.find(l => l.id === destino.id)!
        return { como: 'habitacion', itemId: destino.id, grupo: normalizarGrupo(linea.grupo ?? null) ?? (linea.grupo as string), sobra }
      }
    }
    // Con fechas en la captura y en la ranura, mandan las fechas: iguales (y un destino que no
    // se contradiga) es otra opción; distintas es otra ranura, aunque sea la misma ciudad.
    // Las ranuras sin fechas leídas quedan para decidir por el lugar, como siempre.
    const sinFechas: string[] = []
    const conFechasEnCaptura = !!claveOpcionHotel(lectura)
    for (const r of ranurasConLugar(vivas, 'hotel')) {
      const clave = normalizarGrupo(r.grupo)
      const leidas = hoteles
        .filter(l => normalizarGrupo(l.grupo ?? null) === clave)
        .flatMap(l => habitacionesDeTarifa(leerTarifaPax(l.tarifa_pax)).slice(0, 1))
        .map(h => h.lectura)
        .filter(l => !!claveOpcionHotel(l))
      if (!conFechasEnCaptura || leidas.length === 0) {
        sinFechas.push(r.grupo)
        continue
      }
      if (leidas.some(l => mismasFechasHotel(l, lectura)) && lugaresCompatibles(r.lugar, lugarLeido) !== false) {
        return { como: 'hermana', grupo: r.grupo }
      }
    }
    const captura: CapturaDetectada = { tipo, lugar: lugarLeido, origen: pistas.origen, destino: pistas.destino }
    const u = ubicarCaptura(captura, ranurasConLugar(vivas, 'hotel')
      .filter(r => sinFechas.includes(r.grupo))
      .map(r => ({ grupo: r.grupo, tipo, lugar: r.lugar, origen: r.origen, destino: r.destino })))
    return u.como === 'hermana' ? { como: 'hermana', grupo: u.grupo } : { como: 'nueva' }
  }

  const captura: CapturaDetectada = { tipo, lugar: lugarLeido, origen: pistas.origen, destino: pistas.destino }
  const candidatas: RanuraCandidata[] = ranurasConLugar(vivas, tipo).map(r => ({
    grupo: r.grupo,
    tipo,
    lugar: r.lugar,
    origen: r.origen,
    destino: r.destino,
  }))
  const u = ubicarCaptura(captura, candidatas)
  return u.como === 'hermana' ? { como: 'hermana', grupo: u.grupo } : { como: 'nueva' }
}
