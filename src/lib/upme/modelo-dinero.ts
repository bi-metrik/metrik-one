/**
 * Modelo de dinero SOENA (rediseño 2026-07-16) — helpers PUROS y testables.
 *
 * El cliente paga en UN recaudo dos componentes distintos:
 *   - HONORARIO de SOENA  → es el INGRESO. Vive en `negocios.precio_aprobado`.
 *   - TARIFA UPME (pasante) → SOENA solo la RECAUDA y la desembolsa a la UPME; NO
 *     es ingreso. Se confirma en Validación (bloque "Confirmar tarifa UPME") y vive
 *     en el `data` de ese bloque, NO en el precio del negocio.
 *
 * Regla cardinal del rediseño (GO Vera 2026-07-16, reemplaza el diseño "Ola 2"
 * donde `precio_aprobado = honorario + tarifa`):
 *
 *     precio_aprobado   = HONORARIO            (ingreso — lo que entra al P&L)
 *     valor_a_recaudar  = honorario + tarifa   (lo que el cliente le paga a SOENA)
 *
 * El P&L (`v_pyl_mes`) reconoce solo cobros NO-pasante, así que la tarifa nunca
 * infla EBITDA. Por eso `precio_aprobado` debe quedarse en honorario: es la señal
 * de ingreso en todo el sistema y mezclarle la tarifa la corrompe.
 *
 * Modalidad de la propuesta (aplica SOLO al honorario; la tarifa va completa por
 * adelantado en ambos planes):
 *   - Plan 1 = 50/50: tarifa COMPLETA + 50% honorario ahora, 50% después.
 *   - Plan 2 = único: todo ahora.
 *
 * Estos helpers NO tocan DB ni red — viven aparte de las server actions para poder
 * probarse sin mocks. Los `'use server'` (propuesta/conciliación/cobros) los consumen.
 *
 * REGLA DURA: nada aquí bloquea, descarta ni "gatea" — solo compone y reparte.
 */

/** Modelo de dinero de un negocio, leído de su propuesta aprobada + tarifa confirmada. */
export interface ModeloDinero {
  /**
   * Tarifa UPME (pasante) CONFIRMADA en Validación, completa por adelantado. 0 si
   * aún no se confirma. Es la que alimenta el reparto pasante/honorario y el gate
   * de handoff. NO es la referencia calculada (esa es `tarifa_upme_ref`).
   */
  tarifa_upme: number
  /** Modalidad: 1 = 50/50, 2 = único, null = sin modalidad. */
  aprobado_plan: 1 | 2 | null
  /** Honorario del plan elegido (= precio_aprobado del negocio). */
  aprobado_honorario: number | null
  /**
   * Tarifa UPME de REFERENCIA calculada (Art. 13) desde el valor del vehículo,
   * SOLO para mostrar/pre-llenar cuando la tarifa aún no se confirma. NO la leen
   * los gates ni el reparto (esos usan `tarifa_upme`). Informativa.
   */
  tarifa_upme_ref?: number
}

/**
 * Valor a recaudar del cliente = honorario (precio_aprobado) + tarifa UPME (pasante).
 * Es la base del saldo del bloque de Cobros y del umbral de handoff. NO se almacena:
 * se deriva del `precio_aprobado` del negocio (honorario) + la tarifa confirmada del
 * modelo. Sin tarifa (0), el valor a recaudar queda = honorario.
 *
 * @param precioAprobado precio_aprobado del negocio = HONORARIO, en COP.
 * @param modelo         modelo de dinero (aporta la tarifa confirmada). null → sin tarifa.
 */
export function valorARecaudar(precioAprobado: number, modelo: ModeloDinero | null): number {
  const honorario = Number.isFinite(precioAprobado) && precioAprobado > 0 ? precioAprobado : 0
  const tarifa = modelo && Number.isFinite(modelo.tarifa_upme) && modelo.tarifa_upme > 0 ? modelo.tarifa_upme : 0
  return Math.round(honorario + tarifa)
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
 * Saldo ESPERADO (pendiente legítimo) del HONORARIO según la modalidad. En 50/50 el
 * 2º 50% del honorario está pendiente por diseño hasta el pago de éxito → NO es
 * descuadre. La tarifa (pasante) va completa por adelantado, así que no cuenta como
 * pendiente. En único o sin modalidad → 0. Si no se conoce el honorario, 0 (no asume
 * pendiente para no ocultar un faltante real).
 */
export function saldoEsperadoPorModalidad(modelo: ModeloDinero | null): number {
  if (!modelo || modelo.aprobado_plan !== 1) return 0
  const honorario = modelo.aprobado_honorario ?? 0
  if (!Number.isFinite(honorario) || honorario <= 0) return 0
  return Math.round(honorario * 0.5)
}

/**
 * Umbral de recaudo para SOLTAR el negocio a operaciones (handoff Documentación →
 * Cargue): el cliente debe haber pagado a SOENA todo el VALOR A RECAUDAR excepto el
 * saldo legítimamente diferido por la modalidad. Como
 * `valor_a_recaudar = honorario + tarifa`, el umbral queda:
 *   - Plan 1 (50/50): tarifa + 50% honorario   (100% UPME + anticipo)
 *   - Plan 2 (único): tarifa + 100% honorario   (100% UPME + honorario)
 * Es decir `valor_a_recaudar − saldoEsperadoPorModalidad`. Nunca negativo.
 *
 * @param precioAprobado precio_aprobado del negocio = HONORARIO, en COP.
 * @param modelo         modelo de dinero (aporta la tarifa confirmada + modalidad).
 */
export function umbralRecaudoHandoff(precioAprobado: number, modelo: ModeloDinero | null): number {
  const vr = valorARecaudar(precioAprobado, modelo)
  return Math.max(0, Math.round(vr - saldoEsperadoPorModalidad(modelo)))
}

/** Desglose del recaudo pendiente para el handoff a operaciones. */
export interface PendienteHandoff {
  /** Umbral exigido = valor a recaudar − saldo diferido. */
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
 * @param precioAprobado precio_aprobado del negocio = HONORARIO, en COP.
 * @param modelo         modelo de dinero del negocio (plan + honorario + tarifa confirmada).
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
