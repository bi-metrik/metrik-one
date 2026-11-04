/**
 * El correo del día en que la suscripción de un CDA entra en Suspendida por pago (Términos del Plan CDA
 * v1.5, cláusula 11.2; D6 y D8 del diseño del 4-nov-2026). Puro: arma asunto, texto y HTML, y decide qué
 * períodos impagos la sostienen. El envío, a quién y el registro van en `aviso-suspendida-servidor.ts`.
 *
 * Va a los correos registrados del CDA (cláusula 15.1: el correo de facturación de la empresa) y a la
 * persona designada. Lleva montos: no lo reciben los usuarios operativos.
 *
 * ⚠️ Texto propuesto por Max el 2026-11-04, pendiente del visto de Vera.
 */

import { formatCOP, formatFechaLetras } from '@/lib/cobros/format'
import { PALETA } from '@/lib/marca/paleta'
import { escaparHtml } from '@/lib/usuarios-espacio/correo'
import type { CuotaConEstado } from './pago-pendiente'
import { periodoDeCuota, periodosImpagosCumplidos, REGLA_MORA_CDA } from './plazos'

/** Contacto oficial de MéTRIK para dudas del pago (revisión de Sofía, 4-nov). */
const CORREO_DUDAS = 'mauricio.moreno@metrik.com.co'
const WHATSAPP_DUDAS = '+57 315 950 9103'

export interface PeriodoImpago {
  /** «del 23 de octubre al 22 de noviembre de 2026», o «la cuota 2» si el concepto no trae período. */
  periodo: string
  /** Lo que falta de esa cuota. */
  saldo: number
  /** El enlace de pago vigente de esa cuota (de una pasarela conocida), o `null`. */
  enlacePago: string | null
}

export interface DatosAvisoSuspendida {
  /** La razón social del CDA. */
  razonSocial: string
  /** 'YYYY-MM-DD': desde cuándo está Suspendida por pago (`restringeDesde`). */
  suspendidaDesde: string
  /** 'YYYY-MM-DD': desde cuándo queda Cancelada si no se paga (`corteDesde`). */
  canceladaDesde: string
  /** Los períodos que, sin pagar, la mantienen Suspendida (`periodosQueSuspenden`). Al menos uno. */
  periodos: PeriodoImpago[]
  /** `/suscripcion?tab=pagos` del espacio del CDA. */
  urlPagos: string
}

/** «del 23 de octubre al 22 de noviembre de 2026» (un solo año si coinciden). */
export function periodoEnLetrasConAnio(c: { concepto: string | null; fechaVencimiento: string }): string | null {
  const p = periodoDeCuota(c)
  if (!p) return null
  const desde = formatFechaLetras(p.desde)
  const hasta = formatFechaLetras(p.hasta)
  const desdeCorto = p.desde.slice(0, 4) === p.hasta.slice(0, 4) ? desde.replace(/ de \d{4}$/, '') : desde
  return `del ${desdeCorto} al ${hasta}`
}

/**
 * Las cuotas del servicio que, sin pagar, tienen hoy la suscripción Suspendida por pago: con saldo, y
 * con su fecha de renovación (`vencimientoConTransicion`) más los días de la 11.2 ya cumplida. Pagar
 * solo una de dos no la levanta: por eso el correo nombra todas. `cuotas` es el reparto de la pestaña
 * Pagos (`cuotasConEstado`); `tipos` dice el tipo de cada cuota por su número, para dejar fuera las de
 * usuarios adicionales (no suspenden el servicio).
 */
export function periodosQueSuspenden(p: {
  cuotas: readonly CuotaConEstado[]
  tipoDeCuota: (numero: number) => string | undefined
  ignorarTipos: readonly string[]
  transicion: string
  hoy: string
}): CuotaConEstado[] {
  return periodosImpagosCumplidos({ ...p, dias: REGLA_MORA_CDA.diaRestriccion })
}

export function asuntoCorreoSuspendida(d: Pick<DatosAvisoSuspendida, 'razonSocial' | 'suspendidaDesde'>): string {
  return `Valida: la suscripción de ${d.razonSocial} está Suspendida por pago desde el ${formatFechaLetras(d.suspendidaDesde)}`
}

function impagos(d: DatosAvisoSuspendida): string {
  const nombres = d.periodos.map((p) => p.periodo)
  if (nombres.length === 1) return `no está pagado el período ${nombres[0]}`
  return `no están pagados los períodos ${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
}

function parrafos(d: DatosAvisoSuspendida): { intro: string[]; pagos: string[]; cierre: string[] } {
  const varios = d.periodos.length > 1
  return {
    intro: [
      `Desde el ${formatFechaLetras(d.suspendidaDesde)}, la suscripción de Valida de ${d.razonSocial} está Suspendida por pago, ` +
        `porque ${impagos(d)} (cláusula 11.2 de los Términos).`,
      'Mientras esté Suspendida por pago, tu equipo no puede hacer consultas nuevas, individuales ni masivas. Sí puede ' +
        'entrar a Valida, ver el historial, descargar los reportes ya generados y descargar la bitácora.',
      `Si se paga, las consultas vuelven y tu fecha de renovación no cambia. Si no se paga, desde el ` +
        `${formatFechaLetras(d.canceladaDesde)} la suscripción queda Cancelada.`,
    ],
    pagos: [
      varios ? 'Para volver a consultar hay que pagar todos estos períodos:' : 'Para volver a consultar hay que pagar este período:',
      ...d.periodos.map(
        (p) => `Período ${p.periodo}: ${formatCOP(p.saldo)}. ${p.enlacePago ? `Pagar en línea: ${p.enlacePago}` : 'Se paga desde Suscripción (enlace abajo).'}`,
      ),
    ],
    cierre: [
      `La persona designada por tu empresa puede ver y pagar ${varios ? 'los períodos' : 'el período'} en la sección Suscripción de MéTRIK ONE: ${d.urlPagos}`,
      'Si ya hiciste este pago, no tienes que hacer nada: las consultas vuelven cuando el pago quede registrado (cláusula 11.5).',
      `Si tienes alguna duda con el pago, escríbenos a ${CORREO_DUDAS} o al WhatsApp ${WHATSAPP_DUDAS}.`,
    ],
  }
}

export function textoCorreoSuspendida(d: DatosAvisoSuspendida): string {
  const p = parrafos(d)
  return ['Hola.', '', ...p.intro.flatMap((l) => [l, '']), ...p.pagos, '', ...p.cierre.flatMap((l) => [l, '']), 'METRIK IA S.A.S.'].join('\n')
}

export function htmlCorreoSuspendida(d: DatosAvisoSuspendida): string {
  const p = parrafos(d)
  const url = escaparHtml(d.urlPagos)
  const filas = d.periodos
    .map(
      (r) =>
        `<tr><td style="padding:6px 12px 6px 0;vertical-align:top;">Período ${escaparHtml(r.periodo)}</td>` +
        `<td style="padding:6px 12px 6px 0;font-weight:600;white-space:nowrap;vertical-align:top;">${escaparHtml(formatCOP(r.saldo))}</td>` +
        `<td style="padding:6px 0;vertical-align:top;">${
          r.enlacePago
            ? `<a href="${escaparHtml(r.enlacePago)}" style="color:${PALETA.acento};font-weight:600;">Pagar en línea</a>`
            : `<a href="${url}" style="color:${PALETA.acento};font-weight:600;">Pagar en Suscripción</a>`
        }</td></tr>`,
    )
    .join('')
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Suscripción Suspendida por pago</title></head>
<body style="margin:0;padding:0;background:${PALETA.papel};font-family:'Helvetica Neue',Arial,sans-serif;color:${PALETA.tinta};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#FFFFFF;border-radius:8px;border:1px solid #E5E7EB;">
        <tr><td style="padding:24px 28px 4px 28px;">
          <div style="font-size:20px;font-weight:700;color:${PALETA.tinta};">MéTRIK</div>
          <div style="height:2px;width:42px;background:${PALETA.acento};margin-top:4px;"></div>
        </td></tr>
        <tr><td style="padding:12px 28px 0 28px;font-size:14px;line-height:1.6;">
          <p style="margin:0 0 10px 0;">Hola.</p>
          ${p.intro.map((l) => `<p style="margin:0 0 12px 0;">${escaparHtml(l)}</p>`).join('\n          ')}
          <p style="margin:6px 0 4px 0;">${escaparHtml(p.pagos[0])}</p>
          <table role="presentation" cellspacing="0" cellpadding="0" style="font-size:14px;margin:0 0 6px 0;">${filas}</table>
          <p style="margin:18px 0 0 0;">
            <a href="${url}" style="display:inline-block;padding:11px 22px;background:${PALETA.acento};color:#FFFFFF;text-decoration:none;border-radius:6px;font-weight:600;font-size:14px;">Ver y pagar en Suscripción</a>
          </p>
          ${p.cierre.map((c) => `<p style="margin:14px 0 0 0;font-size:13px;color:${PALETA.tintaSuave};">${escaparHtml(c)}</p>`).join('\n          ')}
        </td></tr>
        <tr><td style="padding:18px 28px 22px 28px;font-size:11px;color:${PALETA.tintaSuave};">
          METRIK IA S.A.S. · Recibes este correo porque es un correo registrado de la suscripción de ${escaparHtml(d.razonSocial)}.
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}
