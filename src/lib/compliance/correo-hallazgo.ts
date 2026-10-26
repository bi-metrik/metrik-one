/**
 * El correo de hallazgo para la oficial de cumplimiento, sin red.
 *
 * Sale cuando una consulta (manual o masiva) abre una alarma nueva. Uno por
 * consulta puntual; uno por lote en el masivo, con todos los hallazgos del lote:
 * un masivo de 500 terceros no puede convertirse en 40 correos.
 *
 * Cada renglón lleva su propio enlace a la ficha de la contraparte: el correo
 * tiene que dejar a la oficial a un clic de decidir, no en la bandeja entera.
 */

import { escaparHtml } from '@/lib/propuesta/terminos'
import { PALETA } from '@/lib/marca/paleta'
import { RUTA_LIBERACIONES } from './alarma-hallazgo'

export type AvisoHallazgo = {
  /** El mismo texto de la campana. */
  texto: string
  /** Ruta relativa (ver `enlaceContraparte`). */
  enlace: string
}

export function correoHallazgos(input: {
  avisos: AvisoHallazgo[]
  workspaceNombre: string
  workspaceSlug: string
  baseDomain: string
  /** Título del lote, si el correo resume un masivo. */
  tituloLote?: string | null
}): { asunto: string; html: string } {
  const n = input.avisos.length
  const asunto = n === 1
    ? 'Listas restrictivas: un hallazgo espera tu decisión'
    : `Listas restrictivas: ${n} hallazgos esperan tu decisión`
  const protocolo = input.baseDomain.startsWith('localhost') ? 'http' : 'https'
  const base = `${protocolo}://${input.workspaceSlug}.${input.baseDomain}`
  const items = input.avisos
    .map((a) => `<li style="margin:0 0 12px">${escaparHtml(a.texto)}<br><a href="${base}${escaparHtml(a.enlace)}" style="color:${PALETA.acento};font-weight:600;text-decoration:none">Abrir la ficha</a></li>`)
    .join('')
  const origen = input.tituloLote
    ? `La consulta masiva «${escaparHtml(input.tituloLote)}» devolvió coincidencias en listas.`
    : 'Una consulta en listas devolvió coincidencias.'

  const html = `<!DOCTYPE html>
<html lang="es"><body style="margin:0;padding:24px;background:${PALETA.papel};font-family:Helvetica,Arial,sans-serif;color:${PALETA.tinta}">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E5E7EB;border-radius:12px;padding:28px">
    <p style="margin:0 0 6px;font-size:11px;letter-spacing:.08em;text-transform:uppercase;color:${PALETA.tintaSuave}">Cumplimiento · ${escaparHtml(input.workspaceNombre)}</p>
    <h1 style="margin:0 0 14px;font-size:19px;line-height:1.35">${n === 1 ? 'Un hallazgo espera tu decisión' : `${n} hallazgos esperan tu decisión`}</h1>
    <p style="margin:0 0 14px;font-size:14px;line-height:1.6;color:#374151">${origen} Son coincidencias devueltas por la fuente: la decisión sigue siendo tuya. El aviso se cierra cuando la registras.</p>
    <ul style="margin:0 0 22px;padding-left:18px;font-size:14px;line-height:1.5;color:#374151">${items}</ul>
    <a href="${base}${RUTA_LIBERACIONES}" style="display:inline-block;background:${PALETA.acento};color:#fff;text-decoration:none;padding:11px 20px;border-radius:8px;font-size:14px;font-weight:600">Ver la bandeja</a>
    <p style="margin:24px 0 0;font-size:11px;color:#9CA3AF;border-top:1px solid #E5E7EB;padding-top:14px">Enviado por MéTRIK ONE. El mismo aviso está en la campana.</p>
  </div>
</body></html>`

  return { asunto, html }
}
