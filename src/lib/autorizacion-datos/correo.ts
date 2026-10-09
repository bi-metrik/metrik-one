/**
 * El correo con el link de autorización: cuándo sale y qué dice. Puro.
 *
 * Sale solo (al crear un viaje) si el workspace lo encendió, el contacto tiene correo, no tiene
 * autorización vigente y no se le mandó ya uno reciente. La comercial lo puede mandar a mano desde
 * el bloque («Enviar por correo»); a mano se respeta solo un tope corto contra el doble toque.
 */

import type { EstadoAutorizacion } from './estado'
import { llenar, type ConfigAutorizacion, type Marcadores, type TextoAutorizacion } from './texto'

export type OrigenCorreo = 'al_crear' | 'manual'

export type MotivoSinCorreo =
  | 'apagado'
  | 'sin_contacto'
  | 'sin_correo'
  | 'ya_autorizo'
  | 'sin_texto'
  | 'enviado_reciente'

export const MENSAJE_SIN_CORREO: Record<MotivoSinCorreo, string> = {
  apagado: 'El correo automático está apagado en este espacio de trabajo.',
  sin_contacto: 'El negocio no tiene contacto.',
  sin_correo: 'El contacto no tiene correo registrado. Copia el link y envíaselo por WhatsApp.',
  ya_autorizo: 'El cliente ya autorizó: no hace falta mandarle el link.',
  sin_texto: 'Todavía no está publicado el texto de la autorización: el link no se puede firmar.',
  enviado_reciente: 'Ya se le mandó el correo hace muy poco.',
}

/** A mano: el mismo correo no sale dos veces en estos minutos (doble toque, reintento de red). */
const MINUTOS_ENTRE_ENVIOS_MANUALES = 10

const DIA_MS = 24 * 3600 * 1000

export function debeEnviarCorreo(
  p: {
    estado: EstadoAutorizacion
    config: ConfigAutorizacion
    origen: OrigenCorreo
    textoPublicado: boolean
    ahoraMs: number
  },
): { ok: true; email: string } | { ok: false; motivo: MotivoSinCorreo } {
  const { estado, config, origen } = p
  if (origen === 'al_crear' && !config.correoAlCrear) return { ok: false, motivo: 'apagado' }
  if (!estado.existe || !estado.contacto) return { ok: false, motivo: 'sin_contacto' }
  if (estado.vigente.generales) return { ok: false, motivo: 'ya_autorizo' }
  if (!p.textoPublicado) return { ok: false, motivo: 'sin_texto' }
  const email = (estado.contacto.email ?? '').trim()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, motivo: 'sin_correo' }
  const ultimo = estado.pendiente?.correo_enviado_at ? Date.parse(estado.pendiente.correo_enviado_at) : NaN
  if (Number.isFinite(ultimo)) {
    const ventana = origen === 'al_crear' ? config.diasReenvioCorreo * DIA_MS : MINUTOS_ENTRE_ENVIOS_MANUALES * 60_000
    if (p.ahoraMs - ultimo < ventana) return { ok: false, motivo: 'enviado_reciente' }
  }
  return { ok: true, email }
}

/** El momento antes del cual un envío previo ya no bloquea uno nuevo (para el UPDATE condicionado). */
export function corteDeReenvio(origen: OrigenCorreo, config: ConfigAutorizacion, ahoraMs: number): string {
  const ventana = origen === 'al_crear' ? config.diasReenvioCorreo * DIA_MS : MINUTOS_ENTRE_ENVIOS_MANUALES * 60_000
  return new Date(ahoraMs - ventana).toISOString()
}

// ─── El correo ─────────────────────────────────────────────────────────────

function escapar(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

export interface CorreoArmado {
  asunto: string
  texto: string
  html: string
}

/**
 * El correo de la pieza 3a. El link va como botón y, debajo, escrito: hay clientes de correo que
 * no muestran botones, y un link que no se ve es un correo que no sirve.
 */
export function armarCorreoAutorizacion(texto: TextoAutorizacion, m: Marcadores, color: string | null): CorreoArmado {
  const asunto = llenar(texto.mensajes.correoAsunto, m)
  const cuerpo = llenar(texto.mensajes.correoCuerpo, m)
  const link = m.link ?? ''
  const colorBoton = color && /^#[0-9a-f]{3,8}$/i.test(color) ? color : '#10B981'
  const parrafos = cuerpo.split(/\n{2,}/).map(p => p.trim()).filter(Boolean)
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1A1A1A;max-width:560px">',
    ...parrafos.map(p => {
      if (link && p === link) {
        return `<p style="margin:24px 0"><a href="${escapar(link)}" style="background:${colorBoton};color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:8px;display:inline-block;font-weight:bold">Revisar y autorizar</a></p>`
          + `<p style="font-size:12px;color:#6B7280;word-break:break-all">${escapar(link)}</p>`
      }
      return `<p>${escapar(p).replace(/\n/g, '<br>')}</p>`
    }),
    '</div>',
  ].join('')
  return { asunto, texto: cuerpo, html }
}

/** La copia al titular de lo que autorizó (Emilio, nota 2: «copia al correo del cliente si lo tiene»). */
export function armarCopiaAutorizacion(p: {
  agencia: string
  nombreCliente: string
  version: string
  casillas: Array<{ texto: string; marcada: boolean }>
  link: string
  fecha: string
}): CorreoArmado {
  const asunto = `${p.agencia}: copia de su autorización de datos`
  const lineas = [
    `Hola, ${p.nombreCliente}:`,
    `Quedó registrada su autorización del ${p.fecha} (versión ${p.version}). Esto fue lo que marcó:`,
    ...p.casillas.map(c => `${c.marcada ? '[x]' : '[ ]'} ${c.texto}`),
    `Puede ver lo que autorizó en este enlace cuando quiera: ${p.link}`,
    `Equipo de ${p.agencia}`,
  ]
  const html = [
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#1A1A1A;max-width:560px">',
    `<p>Hola, ${escapar(p.nombreCliente)}:</p>`,
    `<p>Quedó registrada su autorización del ${escapar(p.fecha)} (versión ${escapar(p.version)}). Esto fue lo que marcó:</p>`,
    '<ul>',
    ...p.casillas.map(c => `<li>${c.marcada ? '<strong>Sí</strong>' : 'No'}: ${escapar(c.texto)}</li>`),
    '</ul>',
    `<p>Puede ver lo que autorizó en este enlace cuando quiera: <a href="${escapar(p.link)}">${escapar(p.link)}</a></p>`,
    `<p>Equipo de ${escapar(p.agencia)}</p>`,
    '</div>',
  ].join('')
  return { asunto, texto: lineas.join('\n\n'), html }
}
