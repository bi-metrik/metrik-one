/**
 * El correo que recibe la persona designada del contrato cuando el sistema le genera el enlace de pago
 * en línea de una cuota. Puro (arma asunto, texto y HTML); el envío va en `enlace-automatico-servidor.ts`.
 *
 * El botón lleva a `/suscripcion` del espacio del cliente, no al enlace de la pasarela: ahí la persona
 * ve la cuota en contexto (qué paga, qué ya pagó, sus facturas) y paga desde la misma tarjeta. Un
 * enlace de pasarela suelto en un correo no dice de qué es, y vence.
 */

import { PALETA } from '@/lib/marca/paleta'
import { escaparHtml } from '@/lib/usuarios-espacio/correo'
import { formatCOP, formatFechaLetras } from './format'

export interface DatosAvisoEnlace {
  /** Nombre completo de la persona designada; se saluda por el primero. */
  nombre: string | null
  correo: string
  /** Nombre del espacio del cliente (el CDA). */
  espacioNombre: string
  /** `concepto_detalle` de la cuota, tal cual. */
  concepto: string | null
  numeroCuota: number
  monto: number
  /** 'YYYY-MM-DD' */
  fechaVencimiento: string
  /** 'YYYY-MM-DD' de hoy en Bogotá: decide si se dice «vence» o «venció». */
  hoy: string
  /** ISO del vencimiento del enlace, si la pasarela lo dio. */
  enlaceExpira: string | null
  urlSuscripcion: string
}

const RE_PERIODO = /periodo del (\d{2})\/(\d{2})\/(\d{4}) al (\d{2})\/(\d{2})\/(\d{4})/i

/** «Licencia VALIDA · Starter — periodo del ...» → «Licencia VALIDA · Starter». */
export function conceptoSinPeriodo(concepto: string | null, numeroCuota: number): string {
  const limpio = (concepto ?? '').replace(RE_PERIODO, '').replace(/[\s—–-]+$/u, '').replace(/\s+/g, ' ').trim()
  return limpio || `Cuota ${numeroCuota}`
}

/** «periodo del 23/10/2026 al 22/11/2026» → «del 23 de octubre al 22 de noviembre de 2026». */
export function periodoEnLetras(concepto: string | null): string | null {
  const m = concepto ? RE_PERIODO.exec(concepto) : null
  if (!m) return null
  const desde = formatFechaLetras(`${m[3]}-${m[2]}-${m[1]}`)
  const hasta = formatFechaLetras(`${m[6]}-${m[5]}-${m[4]}`)
  // Mismo año: se dice una sola vez.
  const desdeCorto = m[3] === m[6] ? desde.replace(/ de \d{4}$/, '') : desde
  return `del ${desdeCorto} al ${hasta}`
}

function primerNombre(nombre: string | null): string | null {
  const n = (nombre ?? '').trim().split(/\s+/)[0]
  return n ? n : null
}

/** 'YYYY-MM-DD' de un instante ISO, en Bogotá (UTC-5, sin horario de verano). */
function fechaBogota(iso: string): string | null {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return null
  return new Date(t - 5 * 3_600_000).toISOString().slice(0, 10)
}

export function asuntoAvisoEnlace(d: DatosAvisoEnlace): string {
  const fecha = formatFechaLetras(d.fechaVencimiento)
  return d.fechaVencimiento < d.hoy
    ? `Tu cuota con MéTRIK está pendiente: ya puedes pagarla en línea`
    : `Ya puedes pagar en línea tu cuota con MéTRIK, vence el ${fecha}`
}

interface Renglon {
  etiqueta: string
  valor: string
}

function renglones(d: DatosAvisoEnlace): Renglon[] {
  const periodo = periodoEnLetras(d.concepto)
  const vencida = d.fechaVencimiento < d.hoy
  const filas: Renglon[] = [{ etiqueta: 'Concepto', valor: conceptoSinPeriodo(d.concepto, d.numeroCuota) }]
  if (periodo) filas.push({ etiqueta: 'Periodo', valor: periodo })
  filas.push({ etiqueta: 'Valor', valor: formatCOP(d.monto) })
  filas.push({ etiqueta: vencida ? 'Venció' : 'Vence', valor: formatFechaLetras(d.fechaVencimiento) })
  return filas
}

function parrafos(d: DatosAvisoEnlace): { saludo: string; intro: string; cierre: string[] } {
  const nombre = primerNombre(d.nombre)
  const vencida = d.fechaVencimiento < d.hoy
  const expira = d.enlaceExpira ? fechaBogota(d.enlaceExpira) : null
  const cierre = [
    `Para entrar, escribe este correo (${d.correo}) y te enviaremos un código. No necesitas contraseña.`,
  ]
  if (expira) cierre.push(`El enlace de pago está disponible hasta el ${formatFechaLetras(expira)}.`)
  cierre.push('Si ya hiciste este pago, no tienes que hacer nada.')
  return {
    saludo: nombre ? `Hola, ${nombre}.` : 'Hola.',
    intro: vencida
      ? `La cuota ${d.numeroCuota} de ${d.espacioNombre} sigue pendiente. Ya puedes pagarla en línea desde la sección Suscripción de MéTRIK ONE.`
      : `Ya puedes pagar en línea la cuota ${d.numeroCuota} de ${d.espacioNombre} desde la sección Suscripción de MéTRIK ONE.`,
    cierre,
  }
}

export function textoAvisoEnlace(d: DatosAvisoEnlace): string {
  const p = parrafos(d)
  return [
    p.saludo,
    '',
    p.intro,
    '',
    ...renglones(d).map((r) => `${r.etiqueta}: ${r.valor}`),
    '',
    `Ver y pagar: ${d.urlSuscripcion}`,
    '',
    ...p.cierre,
    '',
    'MéTRIK',
  ].join('\n')
}

export function htmlAvisoEnlace(d: DatosAvisoEnlace): string {
  const p = parrafos(d)
  const url = escaparHtml(d.urlSuscripcion)
  const filas = renglones(d)
    .map(
      (r) =>
        `<tr><td style="padding:6px 12px 6px 0;color:${PALETA.tintaSuave};white-space:nowrap;vertical-align:top;">${escaparHtml(r.etiqueta)}</td>` +
        `<td style="padding:6px 0;font-weight:600;color:${PALETA.tinta};">${escaparHtml(r.valor)}</td></tr>`,
    )
    .join('')
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Pago en línea de tu cuota</title></head>
<body style="margin:0;padding:0;background:${PALETA.papel};font-family:'Helvetica Neue',Arial,sans-serif;color:${PALETA.tinta};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;background:#FFFFFF;border-radius:8px;border:1px solid #E5E7EB;">
        <tr><td style="padding:24px 28px 4px 28px;">
          <div style="font-size:20px;font-weight:700;color:${PALETA.tinta};">MéTRIK</div>
          <div style="height:2px;width:42px;background:${PALETA.acento};margin-top:4px;"></div>
        </td></tr>
        <tr><td style="padding:12px 28px 0 28px;font-size:14px;line-height:1.6;">
          <p style="margin:0 0 10px 0;">${escaparHtml(p.saludo)}</p>
          <p style="margin:0 0 14px 0;">${escaparHtml(p.intro)}</p>
          <table role="presentation" cellspacing="0" cellpadding="0" style="font-size:14px;margin:0 0 6px 0;">${filas}</table>
          <p style="margin:18px 0 0 0;">
            <a href="${url}" style="display:inline-block;padding:11px 22px;background:${PALETA.acento};color:#FFFFFF;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">Ver y pagar</a>
          </p>
          ${p.cierre.map((c) => `<p style="margin:14px 0 0 0;font-size:13px;color:${PALETA.tintaSuave};">${escaparHtml(c)}</p>`).join('\n          ')}
          <p style="margin:14px 0 0 0;font-size:12px;color:${PALETA.tintaSuave};">Si el botón no abre, copia esta dirección en tu navegador: ${url}</p>
        </td></tr>
        <tr><td style="padding:18px 28px 22px 28px;font-size:11px;color:${PALETA.tintaSuave};">
          Recibes este correo porque eres la persona designada para la suscripción de ${escaparHtml(d.espacioNombre)}.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
