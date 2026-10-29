/**
 * Confirmación en pantalla ante un pago a proveedor fuera de lo pactado (decisión de Mauricio,
 * 2026-10-29, QA Trappvel H1-2 y H9-2): «¿Estás seguro? Esto está por fuera de lo pactado», con
 * la cifra. No bloquea, no avisa a nadie y no guarda nada: es un `confirm` antes de registrar.
 *
 * Dos casos:
 *   (a) con este pago, lo pagado al servicio supera lo cotizado (cualquier peso de más; la
 *       aprobación de la dirección por `desviacion_costo` sigue con su umbral, en `reglas-pago`);
 *   (b) con este pago, lo pagado a todos los proveedores del viaje supera lo cobrado al cliente.
 *
 * Va ANTES del flujo de aprobación existente (no lo reemplaza ni lo duplica): si además el pago
 * pide a Edgar, después de confirmar el flujo sigue igual. Puro.
 */

export interface EntradaFueraDeLoPactado {
  /** Lo que se va a registrar ahora. */
  monto: number
  /** Lo ya pagado a este servicio. */
  pagadoAntesServicio: number
  /** Lo cotizado del servicio. */
  costoCotizado: number
  /** Lo ya pagado a todos los proveedores del viaje (incluye este servicio). */
  pagadoProveedores: number
  /** Cobrado confirmado al cliente en el negocio. */
  cobradoCliente: number
}

const pesos = (n: number) => '$' + Math.round(n).toLocaleString('es-CO').replace(/,/g, '.')

/** El texto de la confirmación, o `null` si el pago está dentro de lo pactado. */
export function confirmacionFueraDeLoPactado(e: EntradaFueraDeLoPactado): string | null {
  const monto = Math.round(Number(e.monto) || 0)
  if (!(monto > 0)) return null
  const partes: string[] = []

  const cotizado = Math.round(Number(e.costoCotizado) || 0)
  const totalServicio = Math.round(Number(e.pagadoAntesServicio) || 0) + monto
  if (cotizado <= 0) {
    partes.push(`este servicio no tiene valor cotizado y le vas a pagar ${pesos(monto)}`)
  } else if (totalServicio > cotizado) {
    partes.push(`con este pago el servicio queda en ${pesos(totalServicio)} y se cotizó en ${pesos(cotizado)} (${pesos(totalServicio - cotizado)} más)`)
  }

  const cobrado = Math.round(Number(e.cobradoCliente) || 0)
  const totalProveedores = Math.round(Number(e.pagadoProveedores) || 0) + monto
  if (totalProveedores > cobrado) {
    partes.push(`a proveedores se les habrá pagado ${pesos(totalProveedores)} y el cliente ha pagado ${pesos(cobrado)} (${pesos(totalProveedores - cobrado)} más)`)
  }

  if (partes.length === 0) return null
  return `¿Estás seguro? Esto está por fuera de lo pactado: ${partes.join('; y ')}.`
}
