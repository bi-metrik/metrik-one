/**
 * ¿Qué es un pantallazo que entra a la BANDEJA GENERAL de «Armar el viaje»? (`detectarCaptura`).
 *
 * ## Viaje en bloqueo (prueba con Haiku del 2026-11-04, viaje 02)
 *
 * Los 4 pantallazos del viaje 02 (hotel y vuelo de dos paquetes) subidos a la bandeja de un viaje en
 * Bloqueo salieron «No se reconoce qué es»: la detección de siempre dice «ninguno» a un PAQUETE vuelo
 * + hotel (su regla, para los viajes a medida), y la pregunta «¿hotel o vuelos del paquete?»
 * (`paqueteDeBloqueo`) solo corría dentro de «+ Paquete» y en el Ctrl+V. Con Gemini pasaba lo mismo
 * en el camino de subir: la QA de octubre pegó siempre en la casilla del paquete.
 *
 * La regla, la más simple que no toca los viajes a medida:
 *  · viaje A MEDIDA: igual que siempre, una sola llamada;
 *  · viaje en BLOQUEO: el hotel y el vuelo son del paquete (como en el pegado, `pegarEnBloqueo`). Si la
 *    detección de siempre dice hotel o vuelo, va al paquete con esa casilla; si dice «ninguno», se pregunta
 *    otra vez con el párrafo del paquete, y si es hotel o vuelo, va al paquete. Una actividad, un
 *    traslado o un tren siguen la lectura de siempre.
 *
 * Puro de red: el modelo entra por `detectarTipoDeCaptura` (los tests lo reemplazan).
 */

import { detectarTipoDeCaptura, type TipoDetectado } from '@/lib/ai/detectar-tipo-captura'
import type { ResultadoExtraccion } from '@/lib/ai/reintentar-extraccion'
import { casillaDesdeDeteccion, type CasillaPaquete } from './bloqueo-pegado'

export interface DeteccionDeBandeja {
  /** La detección de siempre (la que manda en un viaje a medida). */
  deteccion: ResultadoExtraccion<TipoDetectado>
  /** Viaje en bloqueo: el pantallazo es el hotel o el vuelo de un paquete. `null` = no va al paquete. */
  casilla: CasillaPaquete | null
}

/** «Ponlo en el paquete»: lo que ve la asesora si la bandeja no puede llevarlo sola al paquete. */
export function mensajePaqueteEnBandeja(casilla: CasillaPaquete): string {
  return `Es ${casilla === 'hotel' ? 'el hotel' : 'el vuelo'} de un paquete de bloqueo. Ponlo en el paquete con «+ Paquete».`
}

/**
 * @param enBloqueo si el viaje es en Bloqueo. Puede llegar como promesa: se lee en paralelo con la
 *   primera detección y no suma espera.
 */
export async function detectarEnLaBandeja(
  buffer: Buffer,
  mime: string,
  apiKey: string,
  enBloqueo: boolean | Promise<boolean>,
): Promise<DeteccionDeBandeja> {
  const [deteccion, bloqueo] = await Promise.all([
    detectarTipoDeCaptura(buffer, mime, apiKey),
    Promise.resolve(enBloqueo).catch(() => false),
  ])
  if (!bloqueo || !deteccion.data) return { deteccion, casilla: null }
  if (deteccion.data.tipo === 'hotel' || deteccion.data.tipo === 'vuelo') return { deteccion, casilla: deteccion.data.tipo }
  if (deteccion.data.tipo !== null) return { deteccion, casilla: null }
  const otra = await detectarTipoDeCaptura(buffer, mime, apiKey, { paqueteDeBloqueo: true })
  return { deteccion, casilla: casillaDesdeDeteccion(otra.data?.tipo ?? null) }
}
