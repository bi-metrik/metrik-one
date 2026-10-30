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
 *  2. Otro hotel con las mismas fechas → otra OPCIÓN de esa ranura, aunque el lugar leído sea
 *     otra zona (G1 · M5, 2026-10-29). Solo abre ranura nueva con otras fechas. Hasta el 2026-09-24 esto decidía solo
 *     por el lugar que leyó el detector, y «Providencia» contra «Isla de Providencia» abría
 *     «Hotel 2 en Providencia» (H1).
 *  3. Sin fechas que comparar, el lugar, como siempre (`ubicarCaptura`).
 *
 * ## Actividad (brief del 2026-10-05, «actividades tras la limpieza»)
 *
 * Siempre un bloque nuevo: dos actividades suman, no compiten.
 *
 * Los demás tipos siguen con `ubicarCaptura`.
 *
 * Puro: las líneas de la cotización entran por parámetro.
 */

import { ciudadComparable, lugarComparable, mismoLugar, ubicarCaptura, type CapturaDetectada, type RanuraCandidata } from './bandeja-capturas'
import {
  claveOpcionHotel,
  habitacionesDeTarifa,
  lecturaDeOpcion,
  mismaImagenEnHabitaciones,
  mismasFechasHotel,
  opcionDelMismoHotel,
  sobraLaCaptura,
} from './habitaciones'
import { normalizarGrupo } from './itinerarios'
import { lugarDeOpcion, puntasDelTrayecto, rutaDeVueloDeOpcion } from './opcion-viaje'
import { ranurasDelTipo, type TipoRanura } from './ranuras-cotizacion'
import { ranuraDeGrupo, resolverRanura } from './ranuras-pantallazo'
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

/**
 * Lo que NO hace de dos lugares el mismo destino aunque los dos lo nombren: un país grande. Que
 * «Cartagena / Colombia» y «San Andrés / Colombia» compartan «Colombia» no los vuelve opciones.
 * Una isla que es país (Curazao, Aruba) sí es el destino, y no está aquí.
 */
const PAISES_QUE_NO_SON_DESTINO: ReadonlySet<string> = new Set([
  'colombia', 'mexico', 'estados unidos', 'eeuu', 'usa', 'espana', 'francia', 'italia', 'alemania', 'portugal',
  'reino unido', 'peru', 'brasil', 'argentina', 'chile', 'ecuador', 'europa',
])

/**
 * ¿Dos hoteles pueden estar en el mismo destino? Como `lugaresCompatibles` y, además, por
 * partes: el lector escribe la ciudad del hotel como «zona / ciudad» («Otrobanda / Curacao»,
 * «Willemstad / Curacao») o sola («Curacao»). Basta con que una parte de uno sea (o contenga,
 * palabra por palabra) una parte del otro. COT-2026-0004 (2026-10-23): Renaissance en Otrobanda
 * abría «Hotel 3» y Dreams en Willemstad «Hotel 2», cuando eran tres alternativas de Curazao.
 */
export function lugaresDeHotelCompatibles(a: string | null | undefined, b: string | null | undefined): boolean | null {
  const entero = lugaresCompatibles(a, b)
  if (entero !== false) return entero
  const partes = (t: string | null | undefined) => (t ?? '')
    .split(/[/,|·]| - /)
    .map(p => lugarComparable(p)?.nombre ?? null)
    .filter((p): p is string => !!p && !PAISES_QUE_NO_SON_DESTINO.has(p))
  const pa = partes(a)
  const pb = partes(b)
  const contiene = (grande: string, chico: string) => ` ${grande} `.includes(` ${chico} `)
  return pa.some(x => pb.some(y => contiene(x, y) || contiene(y, x)))
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
    //
    // G1 · M5 (QA del 2026-10-29) · las mismas noches son la misma estadía aunque el lugar leído
    // no coincida: Ecohabs en «Parque Tayrona», Zuana en «Santa Marta · Bello Horizonte» y
    // Mendihuaca en «Mendihuaca» eran tres alternativas para los mismos 4 viajeros y abrían tres
    // bloques que sumaban ($27,2 M). La zona no es la ciudad, y el grupo no duerme en dos
    // hoteles a la vez. Con varias ranuras de esas fechas, primero la de un lugar compatible.
    const sinFechas: string[] = []
    const mismasNoches: { grupo: string; compatible: boolean }[] = []
    const conFechasEnCaptura = !!claveOpcionHotel(lectura)
    for (const r of ranurasConLugar(vivas, 'hotel')) {
      const clave = normalizarGrupo(r.grupo)
      const leidas = hoteles
        .filter(l => normalizarGrupo(l.grupo ?? null) === clave)
        // Con las correcciones de la ficha encima: la fecha corregida es la que vale.
        .map(l => lecturaDeOpcion(leerTarifaPax(l.tarifa_pax)))
        .filter((l): l is LecturaCasilla => !!l && !!claveOpcionHotel(l))
      if (!conFechasEnCaptura || leidas.length === 0) {
        sinFechas.push(r.grupo)
        continue
      }
      if (leidas.some(l => mismasFechasHotel(l, lectura))) {
        mismasNoches.push({ grupo: r.grupo, compatible: lugaresDeHotelCompatibles(r.lugar, lugarLeido) !== false })
      }
    }
    const porNoches = mismasNoches.find(m => m.compatible) ?? mismasNoches[0]
    if (porNoches) return { como: 'hermana', grupo: porNoches.grupo }
    const sinFechaLeida = ranurasConLugar(vivas, 'hotel').filter(r => sinFechas.includes(r.grupo))
    // Sin fechas que comparar, el lugar, por partes: un barrio y su ciudad son el mismo destino.
    const mismoDestino = lugarLeido ? sinFechaLeida.find(r => lugaresDeHotelCompatibles(r.lugar, lugarLeido) === true) : null
    if (mismoDestino) return { como: 'hermana', grupo: mismoDestino.grupo }
    const captura: CapturaDetectada = { tipo, lugar: lugarLeido, origen: pistas.origen, destino: pistas.destino }
    const u = ubicarCaptura(captura, sinFechaLeida
      .map(r => ({ grupo: r.grupo, tipo, lugar: r.lugar, origen: r.origen, destino: r.destino })))
    return u.como === 'hermana' ? { como: 'hermana', grupo: u.grupo } : { como: 'nueva' }
  }

  // Una actividad es un componente que SUMA: nace en su propio bloque aunque otra actividad sea
  // de la misma ciudad (brief del 2026-10-05, «actividades tras la limpieza», punto 1). Solo es
  // opción de otra si quien cotiza lo elige («+ Opción», «Mover a otro bloque», o «Agregar como
  // otra opción» de la misma actividad con otro precio, que resuelve el servidor por su id).
  //
  // ⚠️ Antes caía en `ubicarCaptura`: sin lugar leído y con UNA sola ranura de actividad iba como
  // hermana de esa ranura (la regla de «otra opción del mismo hotel»). En COT-2026-0021 el kayak
  // abrió la primera ranura y el buceo, sin ciudad, entró como su «Opción 2» y dejó de sumar.
  // «Otro servicio» igual: cada uno (asistencia médica, seguro, tarjeta de turismo) suma aparte.
  if (tipo === 'actividad' || tipo === 'otro') return { como: 'nueva' }

  if (tipo === 'vuelo') return ubicarVuelo(lectura, pistas, vivas)

  const captura: CapturaDetectada = { tipo, lugar: lugarLeido, origen: pistas.origen, destino: pistas.destino }
  const candidatas: RanuraCandidata[] = ranurasConLugar(vivas, tipo).map(r => ({
    grupo: r.grupo,
    tipo,
    lugar: r.lugar,
    origen: r.origen,
    destino: r.destino,
  }))
  const u = ubicarCaptura(captura, candidatas)
  if (u.como === 'hermana') return { como: 'hermana', grupo: u.grupo }
  // M9-1 (QA G9 · decisión 5 de Mauricio) · un tren del mismo trayecto y el mismo día que un vuelo
  // ya cotizado es su alternativa: va como opción de ese vuelo y la tarifa cobra solo una.
  if (tipo === 'tren') {
    const vuelo = vueloDelMismoTrayecto(lectura, vivas)
    if (vuelo) return { como: 'hermana', grupo: vuelo }
  }
  return { como: 'nueva' }
}

/**
 * El bloque de vuelo del que este tren es alternativa: mismas ciudades de salida y de llegada
 * (`mismoLugar`: «Paris Gare de Lyon» y «París CDG» son París) y el mismo día. Sin trayecto o sin
 * fecha en el tren, ninguno: no se junta a ciegas.
 */
export function vueloDelMismoTrayecto(lectura: LecturaCasilla, vivas: readonly LineaParaUbicar[]): string | null {
  const identidad = lectura.identidad ?? {}
  const puntas = puntasDelTrayecto(identidad.trayecto ?? null)
  const fecha = identidad.fecha_hora ?? null
  if (!puntas || !fechaComparable(fecha)) return null
  for (const r of ranurasDelTipo(vivas as { id: string; grupo?: string | null; es_ajuste?: boolean | null }[], 'vuelo')) {
    const clave = normalizarGrupo(r.grupo)
    const coincide = vivas
      .filter(l => normalizarGrupo(l.grupo ?? null) === clave)
      .map(l => rutaDeVueloDeOpcion({ nombre: l.nombre ?? null, grupo: l.grupo ?? null, tarifa_pax: l.tarifa_pax, tramos: l.tramos }))
      .some(ruta => mismoLugar(puntas[0], ruta.origen) === true
        && mismoLugar(puntas[1], ruta.destino) === true
        && mismaFecha(fecha, ruta.fecha) === true)
    if (coincide) return r.grupo
  }
  return null
}

/** La fecha comparable de un vuelo: «AAAA-MM-DD» o «--MM-DD», sin el día de la semana. */
function fechaComparable(f: string | null | undefined): { anio: string | null; mesDia: string } | null {
  const t = (f ?? '').trim()
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(t)
  if (iso) return { anio: iso[1], mesDia: `${iso[2]}-${iso[3]}` }
  const corta = /^--(\d{2})-(\d{2})/.exec(t)
  return corta ? { anio: null, mesDia: `${corta[1]}-${corta[2]}` } : null
}

/** `false` solo si las dos fechas se leen y son otro día. Sin una de las dos, no se sabe (`null`). */
function mismaFecha(a: string | null | undefined, b: string | null | undefined): boolean | null {
  const x = fechaComparable(a)
  const y = fechaComparable(b)
  if (!x || !y) return null
  if (x.anio && y.anio && x.anio !== y.anio) return false
  return x.mesDia === y.mesDia
}

/**
 * H9 (prueba Europa, 2026-10-14) · un vuelo es OPCIÓN de otro cuando sale de la misma ciudad,
 * llega al mismo destino FINAL y sale el mismo día. Las escalas no cuentan: Air France
 * BOG→CDG→MAD compite con Avianca BOG→MAD, no suma aparte.
 *
 * La ruta sale primero de la LECTURA (`destino` es la llegada final de la ida, por su
 * descripción en la ranura) y solo si no la dejó, de lo que dijo el detector, que a veces nombra
 * la llegada del primer tramo. Sin ruta en ninguno de los dos, como siempre (`ubicarCaptura`).
 */
function ubicarVuelo(
  lectura: LecturaCasilla,
  pistas: { lugar: string | null; origen: string | null; destino: string | null },
  vivas: readonly LineaParaUbicar[],
): DestinoDeLectura {
  const propia = rutaDeVueloDeOpcion({ nombre: lectura.nombre ?? null, grupo: 'vuelo', tarifa_pax: { casillas: { grupo_completo: lectura } } })
  const origen = propia.origen ?? pistas.origen
  const destino = propia.destino ?? pistas.destino
  const ranuras = ranurasDelTipo(vivas as { id: string; grupo?: string | null; es_ajuste?: boolean | null }[], 'vuelo')
  if (origen === null && destino === null) {
    const u = ubicarCaptura({ tipo: 'vuelo', lugar: null, origen: null, destino: null }, ranuras.map(r => ({ grupo: r.grupo, tipo: 'vuelo' as const, lugar: null, origen: null, destino: null })))
    return u.como === 'hermana' ? { como: 'hermana', grupo: u.grupo } : { como: 'nueva' }
  }
  const rutasDe = (grupo: string) => {
    const clave = normalizarGrupo(grupo)
    return vivas
      .filter(l => normalizarGrupo(l.grupo ?? null) === clave)
      .map(l => rutaDeVueloDeOpcion({ nombre: l.nombre ?? null, grupo: l.grupo ?? null, tarifa_pax: l.tarifa_pax, tramos: l.tramos }))
  }
  for (const r of ranuras) {
    const coincide = rutasDe(r.grupo).some(ruta =>
      mismoLugar(origen, ruta.origen) === true
      && mismoLugar(destino, ruta.destino) === true
      && mismaFecha(propia.fecha, ruta.fecha) !== false)
    if (coincide) return { como: 'hermana', grupo: r.grupo }
  }
  // G1 · M1 (viaje 07, QA del 2026-10-29) · el bloque que abriría esta captura se llamaría
  // igual que uno que ya está («Vuelo Miami–Bogotá»): es el mismo trayecto, aunque sus opciones
  // no dejen leer la ruta. Dos bloques con el mismo rótulo el mismo día se leen como uno y se
  // cobran como dos. Otro día sí es otro vuelo.
  const propio = rotuloDeRuta(origen, destino)
  if (propio) {
    for (const r of ranuras) {
      const nombre = resolverRanura(r.grupo)?.nombre ?? null
      if (rotuloDeRuta(...rutaDelRotulo(nombre)) !== propio) continue
      if (rutasDe(r.grupo).some(ruta => mismaFecha(propia.fecha, ruta.fecha) === false)) continue
      return { como: 'hermana', grupo: r.grupo }
    }
  }
  return { como: 'nueva' }
}

/** «Vuelo 2 Miami–Bogotá» → [«Miami», «Bogotá»]. Sin «–», nada. */
function rutaDelRotulo(nombre: string | null): [string | null, string | null] {
  const m = /^\s*vuelo(?:\s+\d+)?\s+(.+?)\s*[–-]\s*(.+?)\s*$/i.exec(nombre ?? '')
  return m ? [m[1], m[2]] : [null, null]
}

/** La ruta como la nombraría un bloque, comparable: «bogota>cartagena». Sin las dos puntas, `null`. */
function rotuloDeRuta(origen: string | null, destino: string | null): string | null {
  const o = ciudadComparable(origen)
  const d = ciudadComparable(destino)
  return o && d ? `${o}>${d}` : null
}

/**
 * «Agregar como otra opción» de una actividad (la bandeja la vio igual a `destinoId`, con otro
 * precio): quien cotiza ELIGIÓ que sea opción de esa, así que va como hermana en su bloque. Es la
 * única entrada de la bandeja que vuelve opción a una actividad (`ubicarLectura` siempre abre
 * bloque). `null` si no es una actividad o el destino ya no es una actividad de la cotización:
 * entonces decide `ubicarLectura`.
 */
export function opcionElegidaDeActividad(
  tipo: TipoRanura,
  destinoId: string | null | undefined,
  lineas: readonly LineaParaUbicar[],
): DestinoDeLectura | null {
  if (tipo !== 'actividad' || !destinoId) return null
  const linea = lineas.find(l => l.id === destinoId && l.es_ajuste !== true)
  if (!linea || ranuraDeGrupo(linea.grupo ?? null)?.slug !== 'actividad_detalle') return null
  const grupo = normalizarGrupo(linea.grupo ?? null)
  return grupo ? { como: 'hermana', grupo } : null
}
