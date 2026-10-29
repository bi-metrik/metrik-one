/**
 * Visa en trámite (decisión de Mauricio 2026-10-29, QA Trappvel V8-2 y H8-1): si la solicitud
 * registra una visa pendiente, el PDF de la cotización y el mensaje de confirmación llevan una
 * condición visible. El anticipo se cobra igual, para dejar sentado el acuerdo; si niegan la visa,
 * Trappvel no responde por el valor pagado.
 *
 * ⚠️ El texto es lo que firma el cliente: vive SOLO aquí, en usted, y lo revisan Emilio y Vera
 * antes de que llegue a un cliente. Cambiarlo aquí lo cambia en el PDF y en el mensaje.
 *
 * Hoy la visa solo existe como texto libre en «Requisitos especiales» (`requisitos_especiales`
 * de la Solicitud, H8-1): se detecta por la palabra «visa». Puro (servidor y navegador).
 */

/** El título de la tarjeta en el PDF y del renglón en el mensaje (corto, sin punto: es subtítulo). */
export const TITULO_CONDICION_VISA = 'Visa en trámite'

/** La condición, tal cual la lee el cliente. */
export const CONDICION_VISA_EN_TRAMITE =
  'Hay una visa en trámite. El anticipo se cobra para dejar sentado el acuerdo del viaje. Si le niegan la visa a usted o a otro de los viajeros, Trappvel no responde por el valor pagado.'

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Lo que dice que la visa sigue pendiente. */
const PENDIENTE = /\b(tramite|tramitando|pendiente|cita|solicitud|solicitada|esperando|en proceso)\b/
/** Lo que dice que NO hay visa pendiente. */
const RESUELTA = /\b(no\s+(requiere|requieren|necesita|necesitan|pide|piden|aplica)\s+(la\s+)?visa|sin\s+visa|visas?\s+(ya\s+)?(aprobadas?|vigentes?|listas?|ok|al dia)|ya\s+tienen?\s+(la\s+|su\s+|sus\s+)?visas?)\b/

/**
 * ¿La solicitud registra una visa pendiente? Busca la palabra «visa» (no «Visanet» ni
 * «revisar»). Si la menciona como resuelta («no requiere visa», «visa aprobada») y nada más dice
 * que esté pendiente, no hay condición. Si solo dice «visa», sí: la condición de sobra es menos
 * grave que la que falta.
 */
export function visaEnTramite(requisitos: string | null | undefined): boolean {
  if (typeof requisitos !== 'string' || requisitos.trim() === '') return false
  const t = sinTildes(requisitos).replace(/\s+/g, ' ')
  if (!/\bvisas?\b/.test(t)) return false
  if (PENDIENTE.test(t)) return true
  return !RESUELTA.test(t)
}

/**
 * Los términos de la cotización con la condición al final, como una tarjeta propia
 * («Visa en trámite» y su viñeta). Sin visa en trámite, los términos tal cual.
 */
export function terminosConCondicionVisa(terminos: string | null, conVisa: boolean): string | null {
  if (!conVisa) return terminos
  const bloque = `${TITULO_CONDICION_VISA}\n- ${CONDICION_VISA_EN_TRAMITE}`
  const base = terminos?.trim()
  return base ? `${base}\n\n${bloque}` : bloque
}
