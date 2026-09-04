/**
 * F10: Cotizaciones State Machine
 *
 * States: borrador → enviada → aceptada / rechazada / vencida
 * Rechazada puede reabrir a enviada.
 * Aceptada puede volver a borrador para CORREGIRLA, y solo mientras el negocio no
 * haya avanzado de etapa (ver `validateCorregir`). Vencida sí es terminal.
 *
 * Regla clave: Solo 1 cotización "enviada" por oportunidad.
 */

import { formatCOP } from '@/lib/cobros/format'

export type EstadoCotizacion = 'borrador' | 'enviada' | 'aceptada' | 'rechazada' | 'vencida'

export type AccionCotizacion = 'edit' | 'send' | 'accept' | 'reject' | 'reopen' | 'correct' | 'duplicate' | 'view'

// ── Transitions ────────────────────────────

const TRANSITIONS: Record<EstadoCotizacion, EstadoCotizacion[]> = {
  borrador: ['enviada'],
  enviada: ['aceptada', 'rechazada', 'vencida'],
  rechazada: ['enviada'],
  // Corregir: la aprobación se suelta y la cotización vuelve a borrador para editarla.
  // Que la transición exista NO significa que esté disponible: la condición de etapa
  // la impone `validateCorregir`, y el servidor la vuelve a medir contra la base.
  aceptada: ['borrador'],
  vencida: [],
}

export function canTransition(from: EstadoCotizacion, to: EstadoCotizacion): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false
}

// ── Validation ────────────────────────────

interface ValidateContext {
  currentStatus: EstadoCotizacion
  totalPrice: number
  otherQuotesInOpp?: { status: string }[]
  /**
   * ¿El negocio sigue parado en una etapa donde el bloque de cotización es editable?
   *
   * Entra como booleano ya resuelto —no como el negocio ni sus bloques— para que esta
   * función siga siendo pura y testeable sin base. Quien lo calcula es
   * `hayCotizacionEditableEnEtapa` (./etapa-editable), con los `bloque_configs` de la
   * etapa actual. Ausente = no se pudo comprobar = no se corrige: en un control, el
   * lado seguro de la duda es frenar.
   */
  negocioEnEtapaEditable?: boolean
  /**
   * Plata YA recibida por el negocio, en pesos.
   *
   * Entra resuelta, como el flag de etapa, y quien la calcula es `cobradoConfirmado`
   * (@/lib/cobros/saldo-negocio): solo los cobros con `fecha`, que es la definición
   * de "pago confirmado" que usa el resto del producto (la tarjeta del negocio, el
   * motor de bloques y el límite 2 de `revertirAprobacionPropuesta`). Una cuota
   * programada no es plata recibida, y un cobro anulado vale 0.
   *
   * Ausente = no se midió = no se corrige, por la misma razón que el flag de etapa.
   */
  recaudoConfirmado?: number
}

export function validateEnviar(ctx: ValidateContext): { valid: boolean; error?: string } {
  if (ctx.currentStatus !== 'borrador') {
    return { valid: false, error: 'Solo se puede enviar desde borrador' }
  }
  if (ctx.totalPrice <= 0) {
    return { valid: false, error: 'El precio debe ser mayor a 0' }
  }
  // Max 1 enviada por oportunidad
  const hasEnviada = ctx.otherQuotesInOpp?.some(q => q.status === 'enviada')
  if (hasEnviada) {
    return { valid: false, error: 'Ya hay una cotización enviada en esta oportunidad. Rechaza o acepta la actual primero.' }
  }
  return { valid: true }
}

export function validateAceptar(ctx: ValidateContext): { valid: boolean; error?: string } {
  if (ctx.currentStatus !== 'enviada') {
    return { valid: false, error: 'Solo se puede aceptar una cotización enviada' }
  }
  return { valid: true }
}

export function validateRechazar(ctx: ValidateContext): { valid: boolean; error?: string } {
  if (ctx.currentStatus !== 'enviada') {
    return { valid: false, error: 'Solo se puede rechazar una cotización enviada' }
  }
  return { valid: true }
}

export function validateReabrir(ctx: ValidateContext): { valid: boolean; error?: string } {
  if (ctx.currentStatus !== 'rechazada') {
    return { valid: false, error: 'Solo se puede reabrir una cotización rechazada' }
  }
  const hasEnviada = ctx.otherQuotesInOpp?.some(q => q.status === 'enviada')
  if (hasEnviada) {
    return { valid: false, error: 'Ya hay una cotización enviada. Resuélvela primero.' }
  }
  return { valid: true }
}

/**
 * Corregir una cotización aceptada: vuelve a borrador para editarla.
 *
 * Existe porque `aceptada` era terminal y la única salida ante un error en un ítem era
 * duplicar la cotización, que deja dos documentos donde hubo un acuerdo. La ventana es
 * el ÚNICO límite: mientras el negocio no se haya movido, nadie aguas abajo tomó
 * decisiones sobre ese precio. Si ya avanzó, corregir hacia atrás le cambiaría el piso
 * a esas decisiones — ahí sí la salida es duplicar.
 *
 * ## Y la segunda ventana: sin plata recibida
 *
 * Es el mismo límite 2 de `revertirAprobacionPropuesta`, por el mismo motivo: soltar
 * `precio_aprobado` con pagos confirmados deja el saldo del negocio apuntando a un
 * precio que dejó de existir, y eso reaparece como descuadre en conciliación. En el
 * caso de todos los días la guarda no estorba —el caso sigue en la etapa de cotizar y
 * todavía no ha entrado plata—: muerde justo donde tiene que morder.
 */
export function validateCorregir(ctx: ValidateContext): { valid: boolean; error?: string } {
  if (ctx.currentStatus !== 'aceptada') {
    return { valid: false, error: 'Solo se puede corregir una cotización aceptada' }
  }
  if (ctx.negocioEnEtapaEditable !== true) {
    return {
      valid: false,
      error: 'El caso ya avanzó de etapa: duplica la cotización en vez de corregirla',
    }
  }
  const recaudo = ctx.recaudoConfirmado
  if (typeof recaudo !== 'number' || !Number.isFinite(recaudo)) {
    return {
      valid: false,
      error: 'No se pudo comprobar si el negocio tiene pagos confirmados: no se corrige a ciegas',
    }
  }
  if (recaudo > 0) {
    return {
      valid: false,
      error: `Este negocio ya tiene pagos confirmados por ${formatCOP(recaudo)}: duplica la cotización en vez de corregirla`,
    }
  }
  return { valid: true }
}

// ── Available actions by state ────────────

export function getAccionesDisponibles(status: EstadoCotizacion): AccionCotizacion[] {
  switch (status) {
    case 'borrador':
      return ['edit', 'send', 'duplicate', 'view']
    case 'enviada':
      return ['accept', 'reject', 'duplicate', 'view']
    case 'aceptada':
      // `correct` NO se lista aquí: depende de la etapa del negocio, que este catálogo
      // por estado no conoce. Quien decide si se ofrece es `validateCorregir`.
      return ['duplicate', 'view']
    case 'rechazada':
      return ['reopen', 'duplicate', 'view']
    case 'vencida':
      return ['duplicate', 'view']
    default:
      return ['view']
  }
}

// ── Utilities ────────────────────────────

export function isEditable(status: EstadoCotizacion): boolean {
  return status === 'borrador'
}

export function isVencida(validUntil: string | null): boolean {
  if (!validUntil) return false
  return new Date(validUntil) < new Date()
}

export function getEstadoBadgeColor(status: EstadoCotizacion): string {
  switch (status) {
    case 'borrador':
      return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300'
    case 'enviada':
      return 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
    case 'aceptada':
      return 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
    case 'rechazada':
      return 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
    case 'vencida':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
    default:
      return 'bg-gray-100 text-gray-700'
  }
}

export const ESTADO_LABELS: Record<EstadoCotizacion, string> = {
  borrador: 'Borrador',
  enviada: 'Enviada',
  aceptada: 'Aceptada',
  rechazada: 'Rechazada',
  vencida: 'Vencida',
}
