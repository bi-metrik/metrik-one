/**
 * Referencia de comercio de un enlace de pago de ONE: `ONE-<id del cobro sin guiones>-<milisegundos>`.
 * Es de ONE, no de la pasarela: cualquier adaptador la manda como referencia al crear el enlace, y el
 * registro del pago la usa para volver al cobro.
 *
 * El prefijo es ESTABLE por cobro y el sufijo la hace ÚNICA por enlace (las pasarelas piden
 * referencias sin repetir, y un enlace vencido se reemplaza por otro del mismo cobro). 50 caracteres
 * y solo `[A-Za-z0-9-]`: cabe en los 60 de Bold y no usa nada que una pasarela suela rechazar.
 */

export function referenciaEnlaceCobro(cobroId: string, ahoraMs: number): string {
  return `ONE-${cobroId.replace(/-/g, '').toLowerCase()}-${Math.trunc(ahoraMs)}`
}

const RE_REFERENCIA_ONE = /^ONE-([0-9a-f]{32})-\d{10,16}$/i

/** El id del cobro dentro de una referencia de ONE, o `null` si la referencia no es de ONE. */
export function cobroDeReferencia(referencia: string | null | undefined): string | null {
  const m = RE_REFERENCIA_ONE.exec((referencia ?? '').trim())
  if (!m) return null
  const h = m[1].toLowerCase()
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`
}
