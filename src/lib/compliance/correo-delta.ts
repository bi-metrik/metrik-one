/**
 * R3 — el correo de los avisos del monitoreo, sin red.
 *
 * Hasta el 2026-10-08 el barrido solo avisaba por la campanita. La oficial no vive dentro
 * de ONE: un cambio en una contraparte liberada podía pasar días sin que nadie lo viera.
 * El correo sale EXACTAMENTE cuando sale la campanita (hay delta y la notificación se
 * escribió), y va a quien es dueña del workspace: la oficial de cumplimiento.
 *
 * Uno por barrido, no uno por contraparte: si una corrida encuentra diez cambios, la
 * oficial recibe un correo con los diez, no diez correos.
 */

import { escaparHtml } from '@/lib/propuesta/terminos'
import { PALETA } from '@/lib/marca/paleta'

/** Mismo destino que la campanita (`deep_link` de la notificación). */
export const ENLACE_DELTA = '/compliance/liberaciones'

export function correoDeltaMonitoreo(input: {
  /** El mismo texto de cada notificación de campanita. */
  avisos: string[]
  workspaceNombre: string
  workspaceSlug: string
  baseDomain: string
}): { asunto: string; html: string } {
  const n = input.avisos.length
  const asunto = n === 1
    ? 'Monitoreo de listas: una contraparte cambió'
    : `Monitoreo de listas: ${n} contrapartes cambiaron`
  const protocolo = input.baseDomain.startsWith('localhost') ? 'http' : 'https'
  const enlace = `${protocolo}://${input.workspaceSlug}.${input.baseDomain}${ENLACE_DELTA}`
  const items = input.avisos
    .map((a) => `<li style="margin:0 0 10px">${escaparHtml(a)}</li>`)
    .join('')

  const html = `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:24px;background:${PALETA.papel};font-family:Helvetica,Arial,sans-serif;color:${PALETA.tinta}">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:28px">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${PALETA.tintaSuave}">Cumplimiento · ${escaparHtml(input.workspaceNombre)}</p>
    <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35">${n === 1 ? 'El monitoreo encontró un cambio' : `El monitoreo encontró ${n} cambios`}</h1>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#374151">La revalidación automática contra listas devolvió resultados distintos a los de la última consulta. Son coincidencias devueltas por la fuente: la decisión sigue siendo tuya.</p>
    <ul style="margin:0 0 22px;padding-left:18px;font-size:14px;line-height:1.5;color:#374151">${items}</ul>
    <a href="${enlace}" style="display:inline-block;background:${PALETA.acento};color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600">Revisar en ONE</a>
    <p style="margin:24px 0 0;font-size:11px;color:#9CA3AF;border-top:1px solid #E5E7EB;padding-top:14px">Enviado por MéTRIK ONE. El mismo aviso está en la campanita.</p>
  </div>
</body></html>`

  return { asunto, html }
}
