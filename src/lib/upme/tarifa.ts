/**
 * Tarifa UPME — cálculo de la tarifa (pago mínimo) que SOENA paga a la UPME.
 *
 * Fórmula pública: Resolución UPME 135/2025, Art. 13 (ruta GEE, aplica a EV/HEV).
 * Confirmada contra el texto oficial (gestor normativo CREG + PDF con anexos).
 * Vigencia revisada 2026-07-14: ni la Res. 070/2026 ni la Res. 400/2026 tocaron
 * la tarifa — solo cambiaron la recepción de solicitudes (070 ajustó ciclos, 400
 * los eliminó por ventanilla continua). El Art. 13 sigue plenamente vigente.
 *
 * El Art. 13 tiene DOS TRAMOS según el valor de la inversión (sin IVA, en UVT):
 *
 *  1) TRAMO BAJO — inversión < 3.305 UVT → TABLA ESCALONADA (numeral 1):
 *       [0,      275)   UVT →  1,2 UVT
 *       [275,    826)   UVT →  3,4 UVT
 *       [826,  1.652)   UVT →  6,7 UVT
 *       [1.652, 3.305)  UVT → 13,4 UVT
 *
 *  2) TRAMO ALTO — inversión ≥ 3.305 UVT → FÓRMULA (numeral 2):
 *       Beneficio estimado (UVT) = (Valor_inversión_UVT − 3.305) × 40,5%
 *       Pago mínimo = MIN( 13,4·UVT + (Beneficio_en_pesos × 0,5%) ; 275·UVT )
 *
 * donde Valor_inversión = costo sin IVA (COP) de los bienes/servicios de la
 * solicitud → a UVT dividiendo por el UVT del año vigente; la tarifa se devuelve
 * en COP redondeada a peso. El tope de 275·UVT es el máximo a pagar en todo caso.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * NOTA (Mauricio): la tarifa es una REFERENCIA. El valor FINAL lo acredita la
 * plataforma UPME; el operador puede sobrescribirla. Cuando alimente un control
 * de saldo (gate de handoff), el valor que entra al umbral debe ser el confirmado
 * del negocio, con este cálculo como respaldo.
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Helper PURO, reutilizable e independiente del surfacing. La propuesta económica
 * (Ola 2) también lo consume, por eso no depende de UI ni de la base de datos.
 *
 * CORRECCIÓN 2026-07-14: antes se aplicaba la fórmula del tramo alto a TODOS los
 * valores; para inversiones < 3.305 UVT (la mayoría de los EV/HEV de SOENA, por
 * debajo de ~$173M sin IVA) eso daba un valor incorrecto (recta decreciente en
 * vez de los escalones de la tabla). Ahora cada tramo usa su regla.
 */

import { uvtDelAnio } from './uvt'

/** Umbral entre tramos (Art. 13): 3.305 UVT. */
export const UMBRAL_BENEFICIO_UVT = 3_305

/** Factor de beneficio sobre el excedente del umbral: 40,5% (tramo alto). */
export const FACTOR_BENEFICIO = 0.405

/** Componente fijo del pago mínimo del tramo alto: 13,4 UVT. */
export const TARIFA_FIJO_UVT = 13.4

/** Porcentaje del beneficio que suma al pago mínimo: 0,5% (tramo alto). */
export const FACTOR_TARIFA_BENEFICIO = 0.005

/** Tope de la tarifa: 275 UVT (máximo a pagar en todo caso). */
export const TARIFA_TOPE_UVT = 275

/**
 * Tabla escalonada del tramo bajo (Art. 13 numeral 1). Cada escalón vale hasta
 * (sin incluir) su `hastaUvt`; el último cubre hasta el umbral de 3.305 UVT.
 */
export const ESCALONES_TRAMO_BAJO: ReadonlyArray<{ hastaUvt: number; pagoUvt: number }> = [
  { hastaUvt: 275, pagoUvt: 1.2 },
  { hastaUvt: 826, pagoUvt: 3.4 },
  { hastaUvt: 1_652, pagoUvt: 6.7 },
  { hastaUvt: UMBRAL_BENEFICIO_UVT, pagoUvt: 13.4 },
]

/**
 * Devuelve el pago mínimo en UVT del tramo bajo (< 3.305 UVT) para un valor de
 * inversión en UVT, según la tabla escalonada del Art. 13 numeral 1.
 */
export function pagoEscalonTramoBajoUvt(valorSinIvaUvt: number): number {
  for (const escalon of ESCALONES_TRAMO_BAJO) {
    if (valorSinIvaUvt < escalon.hastaUvt) return escalon.pagoUvt
  }
  // No debería alcanzarse (valor ≥ 3.305 es tramo alto); defensivo → último escalón.
  return ESCALONES_TRAMO_BAJO[ESCALONES_TRAMO_BAJO.length - 1].pagoUvt
}

export interface TarifaUpmeDetalle {
  /** Valor sin IVA recibido, en COP. */
  valorSinIvaCop: number
  /** UVT usado en el cálculo, en COP. */
  uvtCop: number
  /** Valor sin IVA convertido a UVT. */
  valorSinIvaUvt: number
  /** Tramo aplicado: 'tabla' (< 3.305 UVT) o 'formula' (≥ 3.305 UVT). */
  tramo: 'tabla' | 'formula'
  /** Pago del escalón en UVT cuando aplica el tramo bajo; null en tramo alto. */
  pagoEscalonUvt: number | null
  /** Beneficio estimado en UVT (tramo alto; 0 en tramo bajo). */
  beneficioUvt: number
  /** Beneficio estimado en COP (tramo alto; 0 en tramo bajo). */
  beneficioCop: number
  /** Pago mínimo antes del tope, en COP (13,4·UVT + beneficio×0,5% en tramo alto; escalón×UVT en tramo bajo). */
  pagoMinimoCop: number
  /** Tope 275·UVT, en COP. */
  topeCop: number
  /** Tarifa final = MIN(pagoMinimo, tope), redondeada a peso. */
  tarifaCop: number
}

/**
 * Calcula el detalle completo de la tarifa UPME a partir del valor de la inversión
 * sin IVA (COP) y el valor del UVT (COP). Aplica el tramo correcto del Art. 13.
 *
 * @param valorSinIvaCop valor de la inversión (vehículo) SIN IVA, en pesos colombianos.
 * @param uvtCop         valor del UVT del año vigente, en pesos colombianos.
 */
export function calcularTarifaUpmeDetalle(
  valorSinIvaCop: number,
  uvtCop: number,
): TarifaUpmeDetalle {
  const valorSinIvaUvt = valorSinIvaCop / uvtCop
  const topeCop = TARIFA_TOPE_UVT * uvtCop

  // Tramo bajo (< 3.305 UVT): tabla escalonada. Sin beneficio, siempre < 13,4·UVT,
  // nunca alcanza el tope.
  if (valorSinIvaUvt < UMBRAL_BENEFICIO_UVT) {
    const pagoEscalonUvt = pagoEscalonTramoBajoUvt(valorSinIvaUvt)
    const pagoMinimoCop = pagoEscalonUvt * uvtCop
    return {
      valorSinIvaCop,
      uvtCop,
      valorSinIvaUvt,
      tramo: 'tabla',
      pagoEscalonUvt,
      beneficioUvt: 0,
      beneficioCop: 0,
      pagoMinimoCop,
      topeCop,
      tarifaCop: Math.round(pagoMinimoCop),
    }
  }

  // Tramo alto (≥ 3.305 UVT): fórmula del beneficio con tope de 275·UVT.
  const beneficioUvt = (valorSinIvaUvt - UMBRAL_BENEFICIO_UVT) * FACTOR_BENEFICIO
  const beneficioCop = beneficioUvt * uvtCop
  const pagoMinimoCop = TARIFA_FIJO_UVT * uvtCop + beneficioCop * FACTOR_TARIFA_BENEFICIO
  const tarifaCop = Math.round(Math.min(pagoMinimoCop, topeCop))

  return {
    valorSinIvaCop,
    uvtCop,
    valorSinIvaUvt,
    tramo: 'formula',
    pagoEscalonUvt: null,
    beneficioUvt,
    beneficioCop,
    pagoMinimoCop,
    topeCop,
    tarifaCop,
  }
}

/**
 * Tarifa UPME en COP (redondeada a peso). Atajo sobre {@link calcularTarifaUpmeDetalle}.
 *
 * @param valorSinIvaCop valor del vehículo SIN IVA, en pesos.
 * @param uvtCop         valor del UVT del año, en pesos.
 */
export function calcularTarifaUpme(valorSinIvaCop: number, uvtCop: number): number {
  return calcularTarifaUpmeDetalle(valorSinIvaCop, uvtCop).tarifaCop
}

/**
 * Variante por año: resuelve el UVT internamente desde la tabla `UVT_POR_ANIO`.
 * Útil para el surfacing (que solo conoce el valor sin IVA y el año en curso).
 */
export function calcularTarifaUpmePorAnio(valorSinIvaCop: number, anio?: number): number {
  return calcularTarifaUpme(valorSinIvaCop, uvtDelAnio(anio))
}
