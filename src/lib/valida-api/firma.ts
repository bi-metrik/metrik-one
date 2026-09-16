/**
 * Firma de las llamadas ONE → Valida (`/api/one/v1/*`, spec 2026-09-15 §5.3).
 *
 * Es el espejo EXACTO de `lib/one/firma.ts` y `lib/consumo/webhooks.ts#firmar` de
 * `bi-metrik/metrik-valida` (rama `main`), que son la fuente de verdad:
 *
 *   X-One-Firma:        t=<unix>,v1=<hex hmac_sha256(secreto, `${t}.${cuerpo}`)>
 *   X-One-Actor:        <uuid del usuario de ONE>
 *   X-One-Actor-Correo: <correo del usuario de ONE>
 *
 * `cuerpo` es el cuerpo crudo que se manda, **cadena vacía en un GET**. Valida acepta una
 * ventana de ±300 s contra su reloj.
 *
 * Funciones puras, sin `server-only`, para poder probarlas. El secreto nunca vive aquí: lo
 * pasa quien firma (`cliente.ts`), que lo lee de `ONE_VALIDA_SECRET`.
 */

import { createHmac } from 'node:crypto'

export const HEADER_FIRMA = 'X-One-Firma'
export const HEADER_ACTOR = 'X-One-Actor'
export const HEADER_ACTOR_CORREO = 'X-One-Actor-Correo'

/** hex(hmac_sha256(secreto, `${t}.${cuerpo}`)). Igual a `firmar()` de Valida. */
export function firmarOne(secreto: string, t: number, cuerpo: string): string {
  return createHmac('sha256', secreto).update(`${t}.${cuerpo}`).digest('hex')
}

/** `t=<unix>,v1=<hmac>`. */
export function headerFirmaOne(secreto: string, cuerpo: string, t: number): string {
  return `t=${t},v1=${firmarOne(secreto, t, cuerpo)}`
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CORREO = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

export interface ActorOne {
  usuario_id: string
  correo: string
}

/**
 * El actor que viaja en los encabezados y, en lo que escribe, también dentro del cuerpo
 * firmado. Valida rechaza con 400 un actor mal formado, así que se valida ANTES de gastar la
 * llamada: `null` = no hay a quién atribuir la operación y no se hace.
 */
export function actorValido(usuarioId: string | null | undefined, correo: string | null | undefined): ActorOne | null {
  const id = (usuarioId ?? '').trim()
  const mail = (correo ?? '').trim().toLowerCase()
  if (!UUID.test(id) || !CORREO.test(mail) || mail.length > 254) return null
  return { usuario_id: id, correo: mail }
}

/** Los tres encabezados de una llamada. */
export function encabezadosOne(
  secreto: string,
  actor: ActorOne,
  cuerpo: string,
  t: number,
): Record<string, string> {
  return {
    [HEADER_FIRMA]: headerFirmaOne(secreto, cuerpo, t),
    [HEADER_ACTOR]: actor.usuario_id,
    [HEADER_ACTOR_CORREO]: actor.correo,
  }
}
