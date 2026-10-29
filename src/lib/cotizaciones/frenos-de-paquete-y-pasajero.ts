/**
 * Los dos frenos de «Enviar» que agrega la forma por pasos sobre `enviarCotizacion`, en UN solo sitio
 * (prueba real del bloqueo de Trappvel, 2026-10-29): el precio por pasajero que falta (P12) y el
 * paquete de bloqueo incompleto. Los usan `enviarPorPasos` (el control) y el PDF (la marca de
 * borrador): si «Enviar» frena, el PDF lo dice; con dos copias terminarían diciendo cosas distintas.
 *
 * Puro y SIN el interruptor de la forma por pasos (criterio N4: el PDF es lector de plata). Quien
 * llama dice si P12 aplica (`conPrecioPorPasajero`). El paquete no lo necesita: solo existe en un
 * viaje en bloqueo, que solo se arma por pasos.
 */

import { motivoPaquetesIncompletos, paquetesIncompletos, type LineaParaPaquete } from './bloqueo-incompleto'
import { itemsDelItinerario, itemsQueAportanAlTotal, type ItemConGrupo } from './itinerarios'
import { motivoSinPrecioPorPasajero, opcionesSinPrecio } from './precio-que-falta'
import type { Composicion } from './tarifa-pasajero'

export type LineaParaFrenos = ItemConGrupo & LineaParaPaquete & { nombre?: string | null }

export interface FrenosDePaqueteYPasajero {
  /** P12: una opción de vuelo o actividad que va al cliente sin el precio del niño o del infante. */
  precioPorPasajero: string | null
  /** Un paquete de bloqueo que se ofrece y está incompleto. */
  paquete: string | null
}

export function frenosDePaqueteYPasajero(args: {
  items: readonly LineaParaFrenos[]
  /** Las tarifas de la cotización (`leerItinerarios`). */
  tarifas: readonly { vaEnPropuesta: boolean; seleccion: string[] }[]
  composicion: Composicion | null
  /** P12 solo cuenta con la forma por pasos encendida (así lo exige `enviarPorPasos`). */
  conPrecioPorPasajero: boolean
}): FrenosDePaqueteYPasajero {
  const items = args.items as LineaParaFrenos[]
  const vanAlCliente = args.tarifas.filter(t => t.vaEnPropuesta)
  const ids = new Set(
    vanAlCliente.length > 0
      ? vanAlCliente.flatMap(t => itemsDelItinerario(items, t.seleccion))
      : itemsQueAportanAlTotal(items),
  )
  const precioPorPasajero = args.conPrecioPorPasajero
    ? motivoSinPrecioPorPasajero(opcionesSinPrecio(items.map(i => ({ ...i, nombre: i.nombre ?? null })), ids, args.composicion))
    : null
  const paquete = motivoPaquetesIncompletos(paquetesIncompletos(items, vanAlCliente.length > 0 ? ids : null, args.composicion))
  return { precioPorPasajero, paquete }
}
