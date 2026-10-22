/**
 * TODOS los textos de cara al cliente para volver a entrar a su espacio:
 *
 *   - la pantalla de `metrikone.co/login` (la dirección del espacio y la vía «te la enviamos»);
 *   - el correo con la dirección de sus espacios (quien la olvidó);
 *   - el correo de bienvenida al terminar el alta autogestionada de Valida.
 *
 * Viven juntos para que se revisen y se corrijan en un solo lugar. Español llano, sin el léxico
 * vetado de marca (`cerebro/reglas/lexico-prohibido.md`). Puro: arma texto y HTML, no envía nada.
 *
 * ## Por qué los correos no traen un enlace mágico
 *
 * El mismo motivo de la invitación (`usuarios-espacio/correo.ts`): un enlace de un solo uso se lo
 * gastan los filtros de correo corporativo antes que la persona, y además vence. El enlace lleva al
 * login del subdominio del espacio, donde la persona escribe su correo y recibe un código. Ese enlace
 * no vence ni se gasta, y por eso se puede guardar.
 */

import { PALETA } from '@/lib/marca/paleta'
import { escaparHtml } from '@/lib/usuarios-espacio/correo'

/** El correo de contacto que se ofrece para dudas. Es el canal oficial de MéTRIK. */
const CORREO_AYUDA = 'mauricio.moreno@metrik.com.co'

/**
 * El ícono de marca, hospedado: es el mismo `public/icons/metrik-icono-192.png` del manifiesto de la
 * app, servido por el dominio de producción. Va por URL, no adjunto. Dirección fija a propósito: un
 * correo enviado desde un preview o en desarrollo tiene que mostrar el logo igual.
 */
export const LOGO_URL = 'https://metrikone.co/icons/metrik-icono-192.png'

/** El pie de marca de los correos de acceso: el tagline canónico y la razón social. */
export const PIE_MARCA = {
  linea1: 'MéTRIK ONE · Claridad para decidir',
  linea2: 'METRIK IA S.A.S. · metrikone.co',
} as const

// ── Pantalla de metrikone.co/login ───────────────────────────────────────────

export const TEXTOS_LOGIN = {
  titulo: 'Iniciar sesión',
  subtitulo: 'Escribe la dirección de tu espacio de trabajo',
  etiquetaEspacio: 'La dirección de tu espacio',
  ayudaEspacio: 'Está en el correo de bienvenida que te enviamos al crear tu cuenta.',
  faltaEspacio: 'Escribe la dirección de tu espacio',
  botonContinuar: 'Continuar',
  enlaceRecuperar: '¿No sabes la dirección de tu espacio? Te la enviamos a tu correo',

  recuperarTitulo: 'Recibe la dirección de tu espacio',
  recuperarSubtitulo: 'Escribe el correo con el que entras. Te enviaremos el enlace a tu espacio.',
  etiquetaCorreo: 'Tu correo',
  botonEnviar: 'Enviarme el enlace',
  enviando: 'Enviando...',
  correoInvalido: 'Escribe un correo válido.',
  errorRed: 'No pudimos enviar la solicitud. Inténtalo de nuevo.',
  /**
   * La respuesta es SIEMPRE esta, exista o no una cuenta con ese correo, y también cuando se pasó
   * el tope de solicitudes: así la pantalla no revela qué correos tienen cuenta.
   */
  respuestaNeutra:
    'Si ese correo tiene una cuenta, te enviamos el enlace a tu espacio. Revisa tu bandeja de entrada y la carpeta de correo no deseado.',
  volver: 'Volver',
} as const

// ── Lo común de los dos correos ──────────────────────────────────────────────

export interface CorreoArmado {
  subject: string
  text: string
  html: string
}

/** Un párrafo del correo: texto plano, o un enlace con su etiqueta. */
type Bloque =
  | { tipo: 'parrafo'; texto: string }
  | { tipo: 'boton'; etiqueta: string; url: string }
  | { tipo: 'espacio'; nombre: string; url: string }
  | { tipo: 'nota'; texto: string }

function htmlDeBloques(titulo: string, bloques: Bloque[]): string {
  const cuerpo = bloques
    .map((b) => {
      if (b.tipo === 'parrafo') return `<p style="margin:0 0 10px 0;">${escaparHtml(b.texto)}</p>`
      if (b.tipo === 'nota') {
        return `<p style="margin:14px 0 0 0;font-size:12px;color:${PALETA.tintaSuave};">${escaparHtml(b.texto)}</p>`
      }
      const url = escaparHtml(b.url)
      if (b.tipo === 'boton') {
        return `<p style="margin:18px 0 18px 0;"><a href="${url}" style="display:inline-block;padding:11px 22px;background:${PALETA.acento};color:#FFFFFF;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">${escaparHtml(b.etiqueta)}</a></p>`
      }
      return `<p style="margin:0 0 10px 0;"><strong>${escaparHtml(b.nombre)}</strong><br><a href="${url}" style="color:${PALETA.acento};">${url}</a></p>`
    })
    .join('\n          ')
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>${escaparHtml(titulo)}</title></head>
<body style="margin:0;padding:0;background:${PALETA.papel};font-family:'Helvetica Neue',Arial,sans-serif;color:${PALETA.tinta};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#FFFFFF;border-radius:8px;border:1px solid #E5E7EB;">
        <tr><td style="padding:24px 28px 4px 28px;">
          <table role="presentation" cellspacing="0" cellpadding="0"><tr>
            <td style="padding-right:12px;vertical-align:middle;"><img src="${LOGO_URL}" width="40" height="40" alt="MéTRIK" style="display:block;border:0;outline:none;text-decoration:none;border-radius:8px;"></td>
            <td style="vertical-align:middle;">
              <div style="font-size:20px;font-weight:700;color:${PALETA.tinta};">MéTRIK ONE</div>
              <div style="height:2px;width:42px;background:${PALETA.acento};margin-top:4px;"></div>
            </td>
          </tr></table>
        </td></tr>
        <tr><td style="padding:12px 28px 22px 28px;font-size:14px;line-height:1.6;">
          ${cuerpo}
        </td></tr>
        <tr><td style="padding:14px 28px 20px 28px;border-top:1px solid #E5E7EB;font-size:11px;line-height:1.5;color:${PALETA.tintaSuave};">
          <strong style="color:${PALETA.tinta};">${PIE_MARCA.linea1}</strong><br>
          ${PIE_MARCA.linea2}
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function textoDeBloques(bloques: Bloque[]): string {
  return bloques
    .map((b) => {
      if (b.tipo === 'parrafo' || b.tipo === 'nota') return b.texto
      if (b.tipo === 'boton') return `${b.etiqueta}: ${b.url}`
      return `${b.nombre}: ${b.url}`
    })
    .concat([`--\n${PIE_MARCA.linea1}\n${PIE_MARCA.linea2}`])
    .join('\n\n')
}

/** `https://acme.metrikone.co/valida` → `acme.metrikone.co`, para escribir la dirección sin adornos. */
function direccionLegible(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
}

// ── Correo: la dirección de tus espacios ─────────────────────────────────────

export interface EspacioParaCorreo {
  nombre: string
  /** El login del subdominio del espacio (`https://<slug>.metrikone.co/login`). */
  url: string
}

export function correoRecuperarEspacio(p: { correo: string; espacios: EspacioParaCorreo[] }): CorreoArmado {
  const varios = p.espacios.length > 1
  const subject = varios ? 'Las direcciones de tus espacios en MéTRIK ONE' : 'La dirección de tu espacio en MéTRIK ONE'
  const bloques: Bloque[] = [
    { tipo: 'parrafo', texto: 'Hola:' },
    {
      tipo: 'parrafo',
      texto: varios
        ? 'Pediste la dirección de tu espacio en MéTRIK ONE. Tienes acceso a estos espacios:'
        : 'Pediste la dirección de tu espacio en MéTRIK ONE. Es esta:',
    },
    ...p.espacios.map((e): Bloque => ({ tipo: 'espacio', nombre: e.nombre, url: e.url })),
    {
      tipo: 'parrafo',
      texto: `Para entrar, abre el enlace y escribe este correo (${p.correo}). Te enviaremos un código para ingresar; no necesitas contraseña.`,
    },
    { tipo: 'parrafo', texto: 'Guarda este correo para la próxima vez.' },
    { tipo: 'nota', texto: `Si no pediste este correo, puedes ignorarlo. ¿Dudas? Escribe a ${CORREO_AYUDA}.` },
  ]
  return { subject, text: textoDeBloques(bloques), html: htmlDeBloques(subject, bloques) }
}

// ── Correo: bienvenida al alta autogestionada de Valida ──────────────────────

export function correoBienvenidaValida(p: {
  razonSocial: string
  correo: string
  /** La entrada directa a Valida en el subdominio del espacio (`https://<slug>.metrikone.co/valida`). */
  urlValida: string
  /** Donde se pide la dirección si se olvida (`https://metrikone.co/login`). */
  urlLoginGeneral: string
}): CorreoArmado {
  const subject = 'Tu espacio en Valida está listo'
  const direccion = direccionLegible(p.urlValida)
  const bloques: Bloque[] = [
    { tipo: 'parrafo', texto: 'Hola:' },
    { tipo: 'parrafo', texto: `Ya creamos el espacio de ${p.razonSocial} en Valida.` },
    { tipo: 'parrafo', texto: `La dirección de tu espacio es ${direccion}. Guárdala: es por donde vas a entrar siempre.` },
    { tipo: 'boton', etiqueta: 'Entrar a Valida', url: p.urlValida },
    {
      tipo: 'parrafo',
      texto: `Para entrar, escribe este correo (${p.correo}) y te enviaremos un código. No necesitas contraseña.`,
    },
    {
      tipo: 'nota',
      texto: `Si olvidas la dirección, entra a ${p.urlLoginGeneral} y pide que te la enviemos. ¿Dudas? Escribe a ${CORREO_AYUDA}.`,
    },
  ]
  return { subject, text: textoDeBloques(bloques), html: htmlDeBloques(subject, bloques) }
}
