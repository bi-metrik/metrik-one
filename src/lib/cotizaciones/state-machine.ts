/**
 * F10: Cotizaciones State Machine
 *
 * States: borrador → enviada → aceptada / rechazada / vencida
 * Rechazada puede reabrir a enviada.
 * Aceptada y Vencida son terminales.
 *
 * Regla clave: Solo 1 cotización "enviada" por oportunidad.
 */

export type EstadoCotizacion = 'borrador' | 'enviada' | 'aceptada' | 'rechazada' | 'vencida'

export type AccionCotizacion = 'edit' | 'send' | 'accept' | 'reject' | 'reopen' | 'duplicate' | 'view'

// ── Transitions ────────────────────────────

const TRANSITIONS: Record<EstadoCotizacion, EstadoCotizacion[]> = {
  borrador: ['enviada'],
  enviada: ['aceptada', 'rechazada', 'vencida'],
  rechazada: ['enviada'],
  aceptada: [],
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

// ── Available actions by state ────────────

export function getAccionesDisponibles(status: EstadoCotizacion): AccionCotizacion[] {
  switch (status) {
    case 'borrador':
      return ['edit', 'send', 'duplicate', 'view']
    case 'enviada':
      return ['accept', 'reject', 'duplicate', 'view']
    case 'aceptada':
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
