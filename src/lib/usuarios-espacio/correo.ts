/**
 * El correo que recibe una persona cuando le dan acceso a un espacio de ONE. Puro (arma el HTML);
 * el envío va en `servidor.ts`.
 *
 * ## Por qué no lleva un enlace mágico
 *
 * El acceso ya queda creado del lado del servidor (usuario de Auth, perfil y staff en el espacio), así
 * que la persona entra por el login de siempre del subdominio de su espacio: escribe su correo y le
 * llega un código o un enlace. Un enlace de un solo uso en el correo de invitación se lo gastan los
 * filtros de correo corporativo (Microsoft Defender / Safe Links lo abren antes que la persona;
 * medido con ALMA el 2026-09-10), y además vence. Esta invitación no vence ni se gasta.
 */

import { PALETA } from '@/lib/marca/paleta'

export function escaparHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export interface DatosInvitacion {
  nombre: string
  /** Quien invita, para que la persona sepa de dónde viene. */
  invitadoPor: string | null
  espacioNombre: string
  rolEtiqueta: string
  urlIngreso: string
  correo: string
}

export function asuntoInvitacion(d: DatosInvitacion): string {
  return `Tienes acceso a ${d.espacioNombre} en MéTRIK ONE`
}

export function htmlInvitacion(d: DatosInvitacion): string {
  const nombre = escaparHtml(d.nombre)
  const espacio = escaparHtml(d.espacioNombre)
  const quien = d.invitadoPor ? `${escaparHtml(d.invitadoPor)} te dio acceso` : 'Te dieron acceso'
  const correo = escaparHtml(d.correo)
  const url = escaparHtml(d.urlIngreso)
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Acceso a MéTRIK ONE</title></head>
<body style="margin:0;padding:0;background:${PALETA.papel};font-family:'Helvetica Neue',Arial,sans-serif;color:${PALETA.tinta};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#FFFFFF;border-radius:8px;border:1px solid #E5E7EB;">
        <tr><td style="padding:24px 28px 4px 28px;">
          <div style="font-size:20px;font-weight:700;color:${PALETA.tinta};">MéTRIK ONE</div>
          <div style="height:2px;width:42px;background:${PALETA.acento};margin-top:4px;"></div>
        </td></tr>
        <tr><td style="padding:12px 28px 0 28px;font-size:14px;line-height:1.6;">
          <p style="margin:0 0 10px 0;">Hola, ${nombre}.</p>
          <p style="margin:0 0 10px 0;">${quien} a <strong>${espacio}</strong> en MéTRIK ONE, como ${escaparHtml(d.rolEtiqueta)}.</p>
          <p style="margin:0 0 10px 0;">Para entrar, abre el enlace, escribe este correo (${correo}) y te enviaremos un código para ingresar. No necesitas contraseña.</p>
          <p style="margin:18px 0 0 0;">
            <a href="${url}" style="display:inline-block;padding:11px 22px;background:${PALETA.acento};color:#FFFFFF;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">Ingresar</a>
          </p>
          <p style="margin:14px 0 0 0;font-size:12px;color:${PALETA.tintaSuave};">Si el botón no abre, copia esta dirección en tu navegador: ${url}</p>
        </td></tr>
        <tr><td style="padding:18px 28px 22px 28px;font-size:11px;color:${PALETA.tintaSuave};">
          Si no esperabas este correo, puedes ignorarlo.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
