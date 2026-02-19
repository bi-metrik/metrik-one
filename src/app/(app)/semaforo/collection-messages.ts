/**
 * Generador de mensajes de cobro (F4 - Semáforo Financiero)
 * 3 tonos según antigüedad de la deuda:
 * - amable: < 30 días vencida
 * - firme: 30-60 días vencida
 * - urgente: > 60 días vencida
 */

const fmtShort = (v: number) => {
  if (v >= 1000000) return `$${(v / 1000000).toFixed(1)}M`
  return `$${v.toLocaleString('es-CO')}`
}

export function generarMensajeCobro(
  tipo: 'amable' | 'firme' | 'urgente',
  cliente: { nombre: string; monto: number; diasVencida: number }
): string {
  const montoFormateado = fmtShort(cliente.monto)

  if (tipo === 'amable') {
    return `Hola, buenos días.\n\nTe escribo por la factura de ${montoFormateado}.\n\n¿Podrías confirmarme cuándo programamos el pago?\n\nGracias.`
  } else if (tipo === 'firme') {
    return `Buen día.\n\nLa factura de ${montoFormateado} tiene ${cliente.diasVencida} días de vencida.\n\nNecesito programar el pago esta semana. ¿Qué día te funciona?\n\nQuedo atento.`
  } else {
    return `Hola.\n\nLa factura de ${montoFormateado} lleva ${cliente.diasVencida} días pendiente.\n\nDebo escalar esto si no recibo respuesta hoy.\n\n¿Podemos hablar?`
  }
}

export function getTipoCobro(diasVencida: number): 'amable' | 'firme' | 'urgente' {
  if (diasVencida > 60) return 'urgente'
  if (diasVencida > 30) return 'firme'
  return 'amable'
}
