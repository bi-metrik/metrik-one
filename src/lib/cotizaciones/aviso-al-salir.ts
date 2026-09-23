/**
 * El aviso antes de salir de una cotización de viaje con trabajo de la bandeja en el aire
 * (la MISMA condición del aviso al recargar). Aquí vive solo la regla pura de qué enlace
 * cuenta como salir; la escucha la pone la bandeja.
 */

export const PREGUNTA_AL_SALIR =
  'Hay pantallazos leyéndose o aceptándose en esta cotización. Si sales ahora, ese trabajo se corta. ¿Salir igual?'

/**
 * ¿Tocar este enlace saca de la página? No sale: un enlace a otra pestaña, a otro
 * protocolo (`tel:`, `mailto:`, WhatsApp en pestaña nueva) ni el ancla de la misma página.
 */
export function saleDeLaPagina(href: string, actual: string, target?: string | null): boolean {
  if (target && target !== '_self') return false
  let destino: URL
  let aqui: URL
  try {
    destino = new URL(href, actual)
    aqui = new URL(actual)
  } catch {
    return false
  }
  if (destino.protocol !== 'http:' && destino.protocol !== 'https:') return false
  return destino.origin !== aqui.origin || destino.pathname !== aqui.pathname || destino.search !== aqui.search
}
