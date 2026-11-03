/**
 * Un doble pago que igual entró (brief del 2026-11-03): un pago aprobado sobre una cuota que ya estaba
 * pagada por otro camino (el enlace de Bold y la tarjeta, o dos veces el mismo enlace). La plata ya salió
 * del cliente: queda MARCADO PARA DEVOLUCIÓN en el evento (`pasarela_eventos`, en `requiere_revision`) y en
 * la historia del cliente, y se avisa a MéTRIK por correo. No se devuelve sola: si se automatiza lo decide
 * Carmen.
 *
 * Puro: el texto del correo y de la marca. El envío lo hace el repositorio del pago en línea
 * (`pago-en-linea-servidor.ts`), con la llave de idempotencia de la transacción.
 */

import { formatCOP } from './format'
import { nombrePasarela } from './reverso-pasarela'

/** A quién va el aviso. El mismo destino del aviso de un reverso. */
export { AVISO_REVERSO_PARA as AVISO_DOBLE_PAGO_PARA } from './reverso-pasarela'

/** La marca que se agrega al detalle del evento y a la historia del cliente. */
export const MARCA_DEVOLUCION = 'PARA DEVOLUCIÓN'

export interface DatosDoblePago {
  pasarela: string
  referenciaPago: string
  monto: number | null
  cobroId: string
  /** El pago que ya tenía la cuota: su fecha y su referencia. */
  pagoPrevio: { fecha: string | null; referencia: string | null }
}

export function idempotenciaAvisoDoblePago(pasarela: string, transaccionId: string): string {
  return `doble-pago-${pasarela}-${transaccionId}`
}

/** La frase que se agrega al detalle: marca, lo que falta decidir y si salió el aviso. */
export function fraseDevolucion(aviso: { ok: true } | { ok: false; error: string }): string {
  const correo = aviso.ok ? 'Aviso enviado a MéTRIK.' : `El aviso a MéTRIK NO salió (${aviso.error}).`
  return `${MARCA_DEVOLUCION}: la devolución la hace una persona (no se automatiza sin decisión de Carmen). ${correo}`
}

function escapar(t: string): string {
  return t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)
}

export function correoAvisoDoblePago(d: DatosDoblePago): { subject: string; text: string; html: string } {
  const p = nombrePasarela(d.pasarela)
  const monto = d.monto !== null ? formatCOP(d.monto) : 'monto sin leer'
  const subject = `Doble pago en ${p}: devolver ${monto}`
  const lineas = [
    `Entró un pago por ${p} sobre una cuota que ya estaba pagada. La plata ya salió del cliente: hay que devolverla.`,
    '',
    `Pago nuevo: ${d.referenciaPago} (${monto})`,
    `Pago que ya tenía la cuota: ${d.pagoPrevio.referencia ?? 'sin referencia'}${d.pagoPrevio.fecha ? `, del ${d.pagoPrevio.fecha}` : ''}`,
    `Cobro en ONE: ${d.cobroId}`,
    '',
    'Lo que hizo ONE: NO registró el pago nuevo; el evento quedó en revisión, marcado para devolución.',
    'Falta: devolver el pago nuevo desde el panel de la pasarela y registrar la devolución en ONE.',
  ]
  const text = lineas.join('\n')
  const html = `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#1A1A1A">${lineas
    .map((l) => (l ? `<p style="margin:0 0 6px 0">${escapar(l)}</p>` : '<br/>'))
    .join('')}</div>`
  return { subject, text, html }
}
