import 'server-only'

/**
 * Correo al viajero (Vera C1): la copia automática de lo que la comercial manda por WhatsApp,
 * cuando el contacto tiene correo. Remitente con la marca de la agencia («Trappvel vía MéTRIK
 * ONE»), respuesta a la comercial, y traza en `avisos_cliente` (enviado, omitido o fallido): la
 * constancia de D6 es esa traza más el texto exacto.
 *
 * Nunca lanza: un correo que no sale no deshace lo que lo disparó (la confirmación ya quedó, el
 * pago ya se registró); queda trazado como fallido.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { correoValido } from './confirmacion'
import { remitenteAvisosPorDefecto, remitenteCliente } from '../../../supabase/functions/_shared/remitente-correo'

export type EstadoCorreo = { estado: 'enviado' | 'omitido' | 'fallido'; destino: string | null; motivo: string | null }

function escapar(t: string): string {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** El mismo texto del WhatsApp, en HTML: `*negrita*` a <strong> y saltos de línea. */
export function htmlDelMensaje(texto: string): string {
  const cuerpo = escapar(texto)
    .replace(/\*([^*\n]+)\*/g, '<strong>$1</strong>')
    .replace(/\n/g, '<br>')
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1A1A1A">${cuerpo}</div>`
}

/** El texto plano del correo: sin los asteriscos de WhatsApp. */
export function textoPlanoDelMensaje(texto: string): string {
  return texto.replace(/\*([^*\n]+)\*/g, '$1')
}

/**
 * «Trappvel vía MéTRIK ONE <avisos@avisos.metrikone.co>», o el remitente propio del workspace si declaró
 * `config_extra.remitente_correo` en un dominio permitido (ver _shared/remitente-correo.ts).
 */
export function remitenteViajero(agencia: string, configExtra: unknown): string {
  const nombre = agencia.replace(/[<>"]/g, '').trim() || 'Tu agencia'
  return remitenteCliente({
    configExtra,
    marca: nombre,
    porDefecto: remitenteAvisosPorDefecto(`${nombre} vía MéTRIK ONE`),
    contexto: 'correo-viajero',
  }).from
}

export async function enviarCorreoAlViajero(p: {
  workspaceId: string
  negocioId: string
  para: string | null
  replyTo: string | null
  agencia: string
  asunto: string
  texto: string
  /** Una por hecho: el reintento del mismo hecho no manda dos correos (Resend la respeta 24 h). */
  idempotencyKey: string
  /** Archivos adjuntos (el paquete de viaje en PDF), en base64. */
  adjuntos?: Array<{ filename: string; content: string }>
}): Promise<EstadoCorreo> {
  const svc = createServiceClient()
  const registrar = async (e: EstadoCorreo, proveedorId: string | null = null): Promise<EstadoCorreo> => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (svc.from('avisos_cliente') as any).insert({
      workspace_id: p.workspaceId,
      negocio_id: p.negocioId,
      canal: 'email',
      estado: e.estado,
      destino: e.destino,
      copia_a: p.replyTo,
      motivo: e.motivo,
      titulo: p.asunto.slice(0, 200),
      proveedor_id: proveedorId,
    })
    if (error) console.error('[correo-viajero] no se pudo trazar el aviso:', error.message)
    return e
  }

  const destino = p.para?.trim() ?? null
  if (!destino || !correoValido(destino)) return registrar({ estado: 'omitido', destino: null, motivo: 'sin_correo' })
  const key = process.env.RESEND_API_KEY
  if (!key) return registrar({ estado: 'fallido', destino, motivo: 'sin_resend_api_key' })

  // El remitente propio del workspace, si lo declaró. Leerlo nunca frena el correo: ante
  // cualquier falla sale el remitente de siempre.
  let configExtra: unknown = null
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ws = await (svc.from('workspaces') as any).select('config_extra').eq('id', p.workspaceId).maybeSingle()
    if (ws.error) console.error('[correo-viajero] no se pudo leer config_extra, sale el remitente de siempre:', ws.error.message)
    configExtra = (ws.data as { config_extra?: unknown } | null)?.config_extra ?? null
  } catch (e) {
    console.error('[correo-viajero] no se pudo leer config_extra, sale el remitente de siempre:', e instanceof Error ? e.message : String(e))
  }
  const remitente = remitenteViajero(p.agencia, configExtra)
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'Idempotency-Key': p.idempotencyKey },
      body: JSON.stringify({
        from: remitente,
        to: [destino],
        subject: p.asunto,
        html: htmlDelMensaje(p.texto),
        text: textoPlanoDelMensaje(p.texto),
        ...(p.replyTo && correoValido(p.replyTo) ? { reply_to: p.replyTo } : {}),
        ...(p.adjuntos && p.adjuntos.length > 0 ? { attachments: p.adjuntos } : {}),
      }),
    })
    if (!res.ok) {
      const err = (await res.json().catch(() => ({}))) as { message?: string }
      return registrar({ estado: 'fallido', destino, motivo: `resend_${res.status}${err.message ? `: ${err.message}` : ''}`.slice(0, 200) })
    }
    const body = (await res.json().catch(() => ({}))) as { id?: string }
    return registrar({ estado: 'enviado', destino, motivo: null }, body.id ?? null)
  } catch (e) {
    return registrar({ estado: 'fallido', destino, motivo: (e instanceof Error ? e.message : String(e)).slice(0, 200) })
  }
}

/** La traza del WhatsApp que la comercial dice haber mandado (`wa_manual`). */
export async function trazarWhatsAppManual(p: {
  workspaceId: string
  negocioId: string
  telefono: string | null
  copiaA: string | null
  titulo: string
}): Promise<void> {
  const svc = createServiceClient()
  // `disparado`: lo mandó una persona desde su WhatsApp; ONE no sabe si le llegó.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (svc.from('avisos_cliente') as any).insert({
    workspace_id: p.workspaceId,
    negocio_id: p.negocioId,
    canal: 'whatsapp',
    estado: 'disparado',
    destino: p.telefono,
    copia_a: p.copiaA,
    motivo: 'wa_manual',
    titulo: p.titulo.slice(0, 200),
  })
  if (error) console.error('[correo-viajero] no se pudo trazar el WhatsApp:', error.message)
}
