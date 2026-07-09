/**
 * Modelo de dinero SOENA (cambio UPME 2026-07-08) — helpers PUROS y testables.
 *
 * El cliente paga en UN pago dos componentes: honorario de SOENA + tarifa UPME
 * (pasante — SOENA solo recauda y desembolsa). Modalidad de la propuesta:
 *   - Plan 1 = 50/50: tarifa COMPLETA + 50% honorario ahora, 50% después.
 *   - Plan 2 = único: todo ahora.
 *
 * Estos helpers NO tocan DB ni red — viven aparte de las server actions para poder
 * probarse sin mocks. Los `'use server'` (propuesta/conciliación) los consumen.
 *
 * REGLA DURA: nada aquí bloquea, descarta ni "gatea" — solo compone y reparte.
 */

/** Modelo de dinero de un negocio, leído de su propuesta aprobada. */
export interface ModeloDinero {
  /** Tarifa UPME (pasante) aprobada, completa por adelantado. */
  tarifa_upme: number
  /** Modalidad: 1 = 50/50, 2 = único, null = sin modalidad. */
  aprobado_plan: 1 | 2 | null
  /** Honorario del plan elegido (sin la tarifa). */
  aprobado_honorario: number | null
}

/**
 * Composición del precio del negocio: honorario del plan + tarifa (siempre completa).
 * Sin tarifa (0), el precio queda = honorario (comportamiento previo intacto).
 */
export function componerPrecioAprobado(honorario: number, tarifaUpme: number): number {
  const h = Number.isFinite(honorario) ? honorario : 0
  const t = Number.isFinite(tarifaUpme) && tarifaUpme > 0 ? tarifaUpme : 0
  return Math.round(h + t)
}

export interface RepartoPago {
  /** Porción que cubre la tarifa (pasante): min(pago, tarifa). */
  monto_pasante: number
  /** Resto = honorario: pago − monto_pasante (nunca negativo). */
  monto_honorario: number
}

/**
 * Reparte UN pago en tarifa (pasante) + honorario. La tarifa se cubre PRIMERO.
 * SIN BARRERAS: si el pago es menor a la tarifa, el pasante toma todo el pago y el
 * honorario queda en 0 (la diferencia la maneja la conciliación); si es mayor, el
 * excedente es honorario. Nunca rechaza ni lanza.
 */
export function repartirPagoTarifaHonorario(pago: number, tarifaUpme: number): RepartoPago {
  const p = Number.isFinite(pago) && pago > 0 ? pago : 0
  const t = Number.isFinite(tarifaUpme) && tarifaUpme > 0 ? tarifaUpme : 0
  const montoPasante = Math.min(p, t)
  const montoHonorario = Math.round((p - montoPasante) * 100) / 100
  return { monto_pasante: montoPasante, monto_honorario: montoHonorario }
}

/**
 * tipo_cobro del componente honorario según la modalidad:
 *   - 50/50 (plan 1) → 'anticipo' (el 1er pago es el anticipo; el saldo llega después)
 *   - único (plan 2) o sin modalidad → 'pago'
 */
export function tipoCobroHonorario(plan: 1 | 2 | null): 'anticipo' | 'pago' {
  return plan === 1 ? 'anticipo' : 'pago'
}

/**
 * Saldo ESPERADO (pendiente legítimo) según la modalidad. En 50/50 el 2º 50% del
 * honorario está pendiente por diseño hasta el pago de éxito → NO es descuadre. La
 * tarifa (pasante) va completa por adelantado, así que no cuenta como pendiente.
 * En único o sin modalidad → 0. Si no se conoce el honorario, 0 (no asume pendiente
 * para no ocultar un faltante real).
 */
export function saldoEsperadoPorModalidad(modelo: ModeloDinero | null): number {
  if (!modelo || modelo.aprobado_plan !== 1) return 0
  const honorario = modelo.aprobado_honorario ?? 0
  if (!Number.isFinite(honorario) || honorario <= 0) return 0
  return Math.round(honorario * 0.5)
}
