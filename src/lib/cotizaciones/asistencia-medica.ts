/**
 * La ASISTENCIA MÉDICA del viaje (cotización por pasos, 2026-10-13).
 *
 * Un «Otro servicio» que se llama «Asistencia médica» (escrito a mano con el atajo, o leído de un
 * pantallazo con «Es otro servicio») queda MARCADO en su lectura (`LecturaCasilla.asistenciaMedica`)
 * para que el negocio la muestre en «Documentos del viajero» (Noor, Paso 1 «Escribirlo a mano» y
 * §11). La marca se decide UNA vez, al leer, y viaja con el dato: quien lee después (los servicios
 * del viaje, la entrega) no vuelve a adivinar por el nombre.
 *
 * Solo marca lo que dice «asistencia médica» o «asistencia al viajero» (el nombre comercial de los
 * planes): un «Seguro de viaje» es otro servicio, sin la marca. Un grupo libre viejo («seguro»,
 * «asistencia») no se toca: no es una ranura «otro».
 *
 * Puro.
 */

import type { TipoRanura } from './ranuras-cotizacion'
import { leerTarifaPax, type LecturaCasilla } from './tarifa-pasajero'

const sinTildes = (t: string) => t.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim()

/** ¿El texto nombra una asistencia médica? «ASISTENCIA MÉDICA», «Asistencia al viajero Assist Card». */
export function esAsistenciaMedica(texto: string | null | undefined): boolean {
  return /\basistencia (medica|al viajero)\b/.test(sinTildes(texto ?? ''))
}

/**
 * Pone la marca en la lectura de un «Otro servicio» que es una asistencia médica, y la quita en
 * cualquier otra. El nombre de la lectura es el campo «Servicio» (`resumenDeLinea`). Devuelve la
 * misma lectura.
 */
export function marcarAsistenciaMedica(tipo: TipoRanura, lectura: LecturaCasilla): LecturaCasilla {
  if (tipo === 'otro' && esAsistenciaMedica(lectura.nombre)) lectura.asistenciaMedica = true
  else delete lectura.asistenciaMedica
  return lectura
}

/** ¿La línea es una asistencia médica marcada? Lee la marca de su lectura, nada más. */
export function lineaConAsistenciaMedica(item: { tarifa_pax?: unknown }): boolean {
  return leerTarifaPax(item.tarifa_pax).casillas?.grupo_completo?.asistenciaMedica === true
}
