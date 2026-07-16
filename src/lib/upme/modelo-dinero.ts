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
  /**
   * Tarifa UPME de REFERENCIA calculada (Art. 13) desde el valor del vehículo,
   * SOLO para mostrar cuando la propuesta no guardó `tarifa_upme`. NO la leen los
   * gates (handoff/anticipo usan `tarifa_upme`). Informativa.
   */
  tarifa_upme_ref?: number
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

/**
 * Umbral de recaudo para SOLTAR el negocio a operaciones (handoff Documentación →
 * Cargue): el cliente debe haber pagado a SOENA todo el precio EXCEPTO el saldo
 * legítimamente diferido por la modalidad. Como `precio_aprobado = tarifa_UPME +
 * honorario_completo`, el umbral queda:
 *   - Plan 1 (50/50): tarifa + 50% honorario   (100% UPME + anticipo)
 *   - Plan 2 (único): tarifa + 100% honorario   (100% UPME + honorario)
 * Es decir `precio − saldoEsperadoPorModalidad`. Nunca negativo.
 */
export function umbralRecaudoHandoff(precioAprobado: number, modelo: ModeloDinero | null): number {
  const precio = Number.isFinite(precioAprobado) && precioAprobado > 0 ? precioAprobado : 0
  return Math.max(0, Math.round(precio - saldoEsperadoPorModalidad(modelo)))
}

/** Desglose del recaudo pendiente para el handoff a operaciones. */
export interface PendienteHandoff {
  /** Umbral exigido = precio − saldo diferido. */
  umbral: number
  /** Recaudo real del cliente considerado. */
  recaudado: number
  /** Falta total para alcanzar el umbral (nunca negativo). */
  pendienteTotal: number
  /** Falta del componente UPME (pasante). Se cubre primero. */
  pendienteUpme: number
  /** Falta del componente honorario del plan. */
  pendienteHonorario: number
  /** true si el recaudo cubre el umbral (con tolerancia de 1 peso por redondeo). */
  cubierto: boolean
}

/**
 * Calcula el pendiente para el handoff a operaciones, desglosado en UPME vs
 * honorario. Coherente con `repartirPagoTarifaHonorario`: el recaudo cubre la
 * tarifa UPME PRIMERO, así que el chequeo agregado (recaudado ≥ umbral) ya
 * garantiza ambas bolsas; el desglose es para comunicar qué falta.
 *
 * @param precioAprobado precio del negocio (honorario + tarifa), en COP.
 * @param modelo         modelo de dinero del negocio (plan + honorario + tarifa).
 * @param recaudado      recaudo real del cliente (suma de cobros reales), en COP.
 */
export function calcularPendienteHandoff(
  precioAprobado: number,
  modelo: ModeloDinero | null,
  recaudado: number,
): PendienteHandoff {
  const umbral = umbralRecaudoHandoff(precioAprobado, modelo)
  const rec = Number.isFinite(recaudado) && recaudado > 0 ? recaudado : 0

  const tarifa = modelo && Number.isFinite(modelo.tarifa_upme) && modelo.tarifa_upme > 0 ? modelo.tarifa_upme : 0
  // Reparto tarifa-primero: la UPME se cubre antes que el honorario.
  const recUpme = Math.min(rec, tarifa)
  const pendienteUpme = Math.max(0, Math.round(tarifa - recUpme))
  const honorarioRequerido = Math.max(0, umbral - tarifa)
  const recHonorario = Math.max(0, rec - tarifa)
  const pendienteHonorario = Math.max(0, Math.round(honorarioRequerido - recHonorario))

  const pendienteTotal = Math.max(0, Math.round(umbral - rec))
  return {
    umbral,
    recaudado: rec,
    pendienteTotal,
    pendienteUpme,
    pendienteHonorario,
    cubierto: pendienteTotal <= 1,
  }
}
