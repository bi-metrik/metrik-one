/**
 * El freno de salida por pantallazos de otros pasajeros, del lado del SERVIDOR.
 *
 * Decisión de Mauricio (2026-09-22, pendiente #1 del #825): mientras una línea tenga una
 * captura o un costo confirmado de OTROS pasajeros, la cotización no sale de borrador hacia
 * el cliente. Lo llaman las cuatro puertas que la sacan: los dos «Enviar»
 * (`enviarCotizacion`, `enviarCotizacionNegocio`), «Aprobar» desde borrador
 * (`aceptarCotizacionNegocio`, que con `skip_enviar` se salta el envío) y el `estado` por
 * la puerta genérica `updateCotizacion`. El botón del editor se deshabilita con el mismo
 * texto, pero el que manda es esto: una server action es un endpoint alcanzable con
 * cualquier id.
 *
 * La regla NO se reescribe aquí: `lineasDesactualizadas` y `motivoParaNoEnviar` son las
 * mismas funciones que pintan el aviso de la cotización. Esto solo lee lo que ellas
 * necesitan.
 *
 * ## Qué no frena
 *
 *  · El PDF: descargarlo en borrador sale igual, con el aviso (`avisosCaptura`).
 *  · Aprobar una cotización que ya salió (`enviada`): registra lo que el cliente aceptó.
 *  · Nada de lo que no tenga tarifa por pasajero (R6): sin casillas ni costo confirmado no
 *    se leen los pasajeros del viaje, y la cotización sale como antes.
 *
 * ## El lado seguro
 *
 * Si algo de lo que hace falta para comprobarlo no se puede leer, la cotización NO sale y
 * el motivo dice que se reintente. Un `?? []` aquí convertiría un error de lectura en
 * «no hay nada viejo» y dejaría pasar justo lo que el freno existe para detener.
 */

import {
  hayTarifaPorPasajero,
  lineasDesactualizadas,
  motivoParaNoEnviar,
  type LineaParaAviso,
} from './captura-desactualizada'
import { leerViajeDelNegocio } from './viaje-negocio'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

export const MENSAJE_SIN_COTIZACION =
  'No se pudo leer la cotización para comprobar los pantallazos: vuelve a intentarlo.'
export const MENSAJE_SIN_LINEAS =
  'No se pudieron leer las líneas de la cotización para comprobar los pantallazos: vuelve a intentarlo.'
export const MENSAJE_SIN_PASAJEROS =
  'No se pudieron leer los pasajeros del viaje para comprobar los pantallazos: vuelve a intentarlo.'

/** El estado al que se quiere llevar la cotización. */
export type EstadoDeSalida = 'enviada' | 'aceptada'

/**
 * `null` si la cotización puede salir; si no, el motivo en lenguaje de operadora.
 *
 * `aceptada` solo se frena si la cotización está en borrador: aprobar la que ya se envió
 * no la saca de borrador. `enviada` se frena desde cualquier estado: volver a mandar una
 * rechazada también la pone delante del cliente.
 *
 * Lecturas, con el cliente de la SESIÓN (RLS por workspace): las líneas siempre; la
 * cotización solo si hace falta su estado o su negocio; los pasajeros del viaje solo si
 * alguna línea tiene tarifa por pasajero.
 */
export async function motivoPorCapturasDesactualizadas(
  supabase: Supabase,
  args: { cotizacionId: string; destino: EstadoDeSalida },
): Promise<string | null> {
  let negocioId: string | null = null
  let cotizacionLeida = false

  if (args.destino === 'aceptada') {
    const { data: cot, error } = await supabase
      .from('cotizaciones')
      .select('estado, negocio_id')
      .eq('id', args.cotizacionId)
      .maybeSingle()
    if (error) return MENSAJE_SIN_COTIZACION
    // Sin cotización no hay nada que frenar aquí: la acción dirá que no la encuentra.
    if (!cot) return null
    if ((cot as { estado: string }).estado !== 'borrador') return null
    negocioId = (cot as { negocio_id: string | null }).negocio_id
    cotizacionLeida = true
  }

  const { data: items, error: errItems } = await supabase
    .from('items')
    .select('id, nombre, grupo, es_ajuste, tarifa_pax')
    .eq('cotizacion_id', args.cotizacionId)
  if (errItems) return MENSAJE_SIN_LINEAS
  const lineas = (items ?? []) as LineaParaAviso[]

  // R6: sin tarifa por pasajero no hay nada que pueda quedar viejo.
  if (!hayTarifaPorPasajero(lineas)) return null

  if (!cotizacionLeida) {
    const { data: cot, error } = await supabase
      .from('cotizaciones')
      .select('negocio_id')
      .eq('id', args.cotizacionId)
      .maybeSingle()
    if (error) return MENSAJE_SIN_COTIZACION
    if (!cot) return null
    negocioId = (cot as { negocio_id: string | null }).negocio_id
  }

  const { viaje, error: errViaje } = await leerViajeDelNegocio(supabase, negocioId)
  if (errViaje) return MENSAJE_SIN_PASAJEROS

  return motivoParaNoEnviar(
    lineasDesactualizadas(lineas, viaje.composicion),
    args.destino === 'aceptada' ? 'aprobar' : 'enviar',
  )
}
