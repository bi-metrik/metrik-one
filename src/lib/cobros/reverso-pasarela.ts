/**
 * El reverso de un pago en línea: la pasarela aprobó el pago y después devolvió la plata al pagador
 * (ePayco: estado 6, «Reversada»). Caso real: la 390720992 de ePayco, aprobada y reversada desde el
 * panel el 2026-10-22, sin que ePayco avisara por la confirmación; el cobro se anuló a mano por SQL.
 *
 * Lo que ONE hace solo (`reverso-pasarela-servidor.ts`):
 *   - anula el cobro con los mismos campos de la anulación manual (`anulacion.ts`): `monto` 0, el valor
 *     en `monto_anulado`, `anulado_at`, el motivo y la nota; `anulado_por` queda en null porque no lo
 *     hizo una persona. Con eso el cobro deja de sumar y el emisor de facturas no lo factura;
 *   - avisa a MéTRIK por correo interno (nunca al cliente).
 *
 * Lo que NO hace, y queda para que Mauricio lo decida (Términos, con Emilio): cancelar o suspender la
 * suscripción, cerrar el ciclo de consultas de Valida, volver a cobrar la cuota o hacer la nota crédito
 * de una factura ya emitida (la factura no se toca: solo se avisa).
 *
 * Puro: textos y nada más.
 */

import { formatCOP } from './format'
import { MOTIVO_ANULACION_MAX, notaAnulacion } from './anulacion'

/** A dónde va el aviso interno. Es de MéTRIK, nunca del cliente. */
export const AVISO_REVERSO_PARA = 'mauricio.moreno@metrik.com.co'

const NOMBRE_PASARELA: Record<string, string> = { epayco: 'ePayco', bold: 'Bold' }

export function nombrePasarela(pasarela: string): string {
  return NOMBRE_PASARELA[pasarela] ?? pasarela
}

/** `anulacion_motivo`: dice qué pasó y que no lo hizo una persona. */
export function motivoAnulacionPorReverso(pasarela: string, referenciaPago: string): string {
  return `${nombrePasarela(pasarela)} reversó el pago ${referenciaPago}: la plata volvió al pagador. Anulado por ONE al detectar el reverso.`.slice(0, MOTIVO_ANULACION_MAX)
}

/** Las notas del cobro con la marca de anulación adelante, como la anulación manual. */
export function notasConReverso(motivo: string, ahoraIso: string, notas: string | null): string {
  return `${notaAnulacion(motivo, ahoraIso)}${notas ? ` · ${notas}` : ''}`.slice(0, 1000)
}

export interface DatosAvisoReverso {
  pasarela: string
  referenciaPago: string
  cobroId: string
  monto: number
  /** Quién paga: la razón social de la suscripción o el negocio. */
  cliente: string | null
  numeroCuota: number | null
  /** La factura del cobro: `numero` si existe, `null` si no hay, `'desconocida'` si no se pudo leer. */
  factura: { numero: string; fecha: string | null } | null | 'desconocida'
}

/** La frase de la factura, para el detalle del evento y para el correo. */
export function fraseFactura(f: DatosAvisoReverso['factura']): string {
  if (f === 'desconocida') return 'No se pudo leer si el cobro tenía factura: revisarlo antes de emitir o de hacer nota crédito.'
  if (f) return `El cobro YA tenía la factura ${f.numero}${f.fecha ? ` (${f.fecha})` : ''}: no se tocó; hace falta la nota crédito.`
  return 'El cobro no tenía factura: anulado, ya no se factura.'
}

/** Lo que queda abierto para una persona. Va igual en el detalle del evento y en el correo. */
export const PENDIENTE_DECISION =
  'ONE NO canceló la suscripción ni cerró el ciclo de consultas, y no vuelve a cobrar la cuota: decidirlo a mano.'

export function detalleReverso(d: DatosAvisoReverso): string {
  return [
    `${nombrePasarela(d.pasarela)} reversó el pago ${d.referenciaPago}: cobro anulado (${formatCOP(d.monto)} quedan en monto_anulado).`,
    fraseFactura(d.factura),
    PENDIENTE_DECISION,
  ].join(' ')
}

function escapar(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

export function correoAvisoReverso(d: DatosAvisoReverso): { subject: string; text: string; html: string } {
  const p = nombrePasarela(d.pasarela)
  const quien = d.cliente ?? 'cliente sin identificar'
  const subject = `Reverso en ${p}: cobro anulado (${quien}, ${formatCOP(d.monto)})`
  const lineas = [
    `${p} reversó un pago que ONE ya tenía registrado. La plata volvió al pagador.`,
    '',
    `Cliente: ${quien}`,
    `Pago: ${d.referenciaPago}`,
    `Monto: ${formatCOP(d.monto)}`,
    ...(d.numeroCuota ? [`Cuota: ${d.numeroCuota}`] : []),
    `Cobro en ONE: ${d.cobroId}`,
    '',
    'Lo que hizo ONE: anuló el cobro (monto en 0, el valor en monto_anulado). Ya no suma y no se factura.',
    fraseFactura(d.factura),
    '',
    `Falta decidir: ${PENDIENTE_DECISION}`,
  ]
  const text = lineas.join('\n')
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1A1A1A">${lineas
    .map((l) => (l ? `<p style="margin:0 0 6px 0">${escapar(l)}</p>` : '<br/>'))
    .join('')}</div>`
  return { subject, text, html }
}
