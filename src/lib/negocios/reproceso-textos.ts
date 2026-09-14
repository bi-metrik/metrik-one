/**
 * Los textos del reproceso que dependen de una decisión, fuera del `'use server'` para
 * poder probarlos. Puro.
 */

import type { MotivoRetorno } from './retorno-reproceso'

/** `activity_log.contenido` tiene `CHECK (char_length(contenido) <= 280)`: más largo, el insert muere. */
export const MAX_CONTENIDO_ACTIVIDAD = 280

/**
 * Lo que quien reprocesa tiene que saber sobre a dónde volvió el caso, o `null` si el
 * retorno fue el declarado y no hay nada que explicar.
 */
export function avisoDelRetorno(input: {
  motivo: MotivoRetorno
  declarada: string
  efectiva: string
  seccional: string | null
}): string | null {
  const { motivo, declarada, efectiva, seccional } = input
  switch (motivo) {
    case 'no_aplica':
      return `Este caso no pasa por ${declarada} según su ruta registrada, así que vuelve a ${efectiva}.`
    case 'no_aplica_derivado':
      return (
        `Este caso no pasa por ${declarada}` +
        (seccional ? ` (seccional ${seccional})` : '') +
        `, así que vuelve a ${efectiva}. No tenía la respuesta registrada: revísalo.`
      )
    case 'sin_respuesta':
      return `El caso volvió a ${declarada}, pero no hay una respuesta registrada que diga si pasa por ahí. Revísalo.`
    default:
      return null
  }
}

/** La línea del timeline de un error registrado sin devolver el caso. Cabe en el CHECK. */
export function contenidoErrorSinRetorno(input: {
  tipo: string
  causa: 'error_propio' | 'criterio_tercero'
  etapaActual: string | null
  detalle: string
}): string {
  const causa = input.causa === 'error_propio' ? 'error propio' : 'criterio del tercero'
  const donde = input.etapaActual ? ` El caso sigue en ${input.etapaActual}.` : ''
  const cabeza = `Error registrado sin devolver el caso — ${input.tipo}. Causa: ${causa}.${donde} `
  const espacio = MAX_CONTENIDO_ACTIVIDAD - cabeza.length
  const detalle = input.detalle.trim()
  if (detalle.length <= espacio) return cabeza + detalle
  return cabeza + detalle.slice(0, Math.max(0, espacio - 1)).trimEnd() + '…'
}
