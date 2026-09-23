/**
 * «Aprobar» con tarifas: el cliente escoge una, y ESA fija el precio del negocio.
 *
 * Decisión de Mauricio del 2026-09-22: la Recomendada manda el DOCUMENTO (su total es el
 * TOTAL del PDF), pero al aprobar se pregunta cuál escogió el cliente entre las que iban
 * en la propuesta. `negocios.precio_aprobado` toma el precio de esa, la elección queda en
 * `cotizaciones.tarifa_aceptada_id` —un campo, no un texto— y en `decisiones_combinacion`.
 *
 * Hasta ese día «Aprobar» copiaba `valor_total`, o sea el de la principal: si el cliente
 * escogía la Premium y nadie cambiaba la principal, el negocio quedaba con el precio de
 * otra tarifa y la cartera arrancaba mal.
 *
 * Módulo puro: la decisión de si la elección vale se puede ver fallar sin base.
 */

import { esRecomendada } from './tarifas'

/** Lo mínimo de una tarifa para validar la elección. `FilaItinerario` lo cumple. */
export interface TarifaElegible {
  id: string
  nombre: string | null
  orden: number
  vaEnPropuesta: boolean
}

export type Eleccion<T extends TarifaElegible> =
  | { ok: true; tarifa: T | null }
  | { ok: false; error: string }

/**
 * ¿La tarifa que llega del navegador es una que el cliente pudo escoger?
 *
 * - **Sin tarifas** (lista plana): se aprueba por el total, como siempre, y mandar una
 *   tarifa es un cliente desactualizado o una llamada directa → se rechaza.
 * - **Con tarifas**: hay que escoger, y solo entre las que iban en la propuesta. Una
 *   tarifa armada que nadie marcó no llegó al documento: el cliente no pudo escogerla.
 *
 * `null` en `tarifa` = aprobar por el total (sin tarifas).
 */
export function validarTarifaElegida<T extends TarifaElegible>(
  filas: readonly T[],
  itinerarioId: string | null | undefined,
): Eleccion<T> {
  const pedida = (itinerarioId ?? '').trim()
  if (filas.length === 0) {
    return pedida === ''
      ? { ok: true, tarifa: null }
      : { ok: false, error: 'Esta cotización no tiene tarifas: se aprueba por su total, sin escoger una.' }
  }
  if (pedida === '') {
    return { ok: false, error: 'Esta cotización tiene tarifas: escoge cuál tomó el cliente para aprobarla.' }
  }
  const tarifa = filas.find(f => f.id === pedida)
  if (!tarifa) return { ok: false, error: 'Esa tarifa no es de esta cotización.' }
  if (!tarifa.vaEnPropuesta) {
    return { ok: false, error: 'Esa tarifa no iba en la propuesta: el cliente no la tuvo delante.' }
  }
  return { ok: true, tarifa }
}

/**
 * Cuál se ofrece marcada al abrir la pregunta: la que el cliente ya había escogido (una
 * aprobación que se soltó para corregir un ítem no cambia lo que el cliente tomó), y si
 * no, la Recomendada. `null` si ninguna de las dos está entre las opciones.
 */
export function preseleccionDeAprobacion(
  opciones: readonly { itinerarioId: string; nombre: string | null }[],
  tarifaAceptadaId: string | null | undefined,
): string | null {
  if (tarifaAceptadaId && opciones.some(o => o.itinerarioId === tarifaAceptadaId)) return tarifaAceptadaId
  return opciones.find(o => esRecomendada(o.nombre))?.itinerarioId ?? null
}

/**
 * Lo que queda en el timeline del negocio. Dice la tarifa y el precio, y —si no fue la
 * Recomendada— cuánto era la Recomendada: es la diferencia que alguien va a preguntar al
 * ver un precio aprobado que no coincide con el TOTAL del documento.
 */
export function textoDeAprobacion(args: {
  codigo: string
  tarifa: string | null
  precio: string
  recomendada: { nombre: string | null; precio: string } | null
  eraLaRecomendada: boolean
}): string {
  const tarifa = args.tarifa?.trim() || 'sin nombre'
  const base = `${args.codigo} aprobada: el cliente escogió la tarifa ${tarifa}, por ${args.precio}.`
  if (args.eraLaRecomendada || !args.recomendada) return base
  return `${base} La Recomendada, que da el total del documento, era de ${args.recomendada.precio}.`
}
