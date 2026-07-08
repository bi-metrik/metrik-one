/**
 * Tarifa UPME — cálculo INFORMATIVO de la tarifa que SOENA paga a la UPME.
 *
 * Fórmula pública: Resolución UPME 135/2025, Art. 13 (ruta GEE, aplica a EV/HEV).
 * Confirmada contra el texto oficial vía gestor normativo CREG. La Res. 070/2026
 * solo cambió los ciclos de recepción, NO la tarifa.
 *
 *   Beneficio estimado (UVT) = (Valor_inversión_sin_IVA_en_UVT − 3.305) × 40,5%
 *   Tarifa (pago mínimo)     = MIN( 13,4·UVT + (Beneficio_en_pesos × 0,5%) ; 275·UVT )
 *
 * donde Valor_inversión = valor del vehículo sin IVA (COP) → a UVT dividiendo por
 * el UVT del año, y el resultado de la tarifa se devuelve en COP.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * REGLA DURA (Mauricio): este cálculo es SOLO INFORMATIVO. En NINGÚN caso puede
 * (a) bloquear el avance de etapa, (b) descartar/rechazar un negocio, (c) ser un
 * gate, ni (d) impedir editar. El valor FINAL de la tarifa lo tiene la plataforma
 * UPME. Lo calculado es una REFERENCIA editable que el operador puede sobrescribir.
 *
 * Por debajo del umbral de 3.305 UVT el beneficio es negativo: NO se descarta ni
 * se frena — se devuelve lo que dé la fórmula (queda por debajo de 13,4·UVT).
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Helper PURO, reutilizable e independiente del surfacing. La propuesta económica
 * (Ola 2) también lo consumirá, por eso no depende de UI ni de la base de datos.
 */

import { uvtDelAnio } from './uvt'

/** Umbral de beneficio (Art. 13): 3.305 UVT restados antes del factor 40,5%. */
export const UMBRAL_BENEFICIO_UVT = 3_305

/** Factor de beneficio sobre el excedente del umbral: 40,5%. */
export const FACTOR_BENEFICIO = 0.405

/** Componente fijo del pago mínimo: 13,4 UVT. */
export const TARIFA_FIJO_UVT = 13.4

/** Porcentaje del beneficio que suma al pago mínimo: 0,5%. */
export const FACTOR_TARIFA_BENEFICIO = 0.005

/** Tope de la tarifa: 275 UVT. */
export const TARIFA_TOPE_UVT = 275

export interface TarifaUpmeDetalle {
  /** Valor sin IVA recibido, en COP. */
  valorSinIvaCop: number
  /** UVT usado en el cálculo, en COP. */
  uvtCop: number
  /** Valor sin IVA convertido a UVT. */
  valorSinIvaUvt: number
  /** Beneficio estimado en UVT (puede ser negativo bajo el umbral). */
  beneficioUvt: number
  /** Beneficio estimado en COP. */
  beneficioCop: number
  /** Componente 13,4·UVT + (beneficio × 0,5%), en COP. */
  pagoMinimoCop: number
  /** Tope 275·UVT, en COP. */
  topeCop: number
  /** Tarifa final = MIN(pagoMinimo, tope), redondeada a peso. */
  tarifaCop: number
}

/**
 * Calcula el detalle completo de la tarifa UPME a partir del valor del vehículo
 * sin IVA (COP) y el valor del UVT (COP).
 *
 * @param valorSinIvaCop valor del vehículo SIN IVA, en pesos colombianos.
 * @param uvtCop         valor del UVT del año, en pesos colombianos.
 */
export function calcularTarifaUpmeDetalle(
  valorSinIvaCop: number,
  uvtCop: number,
): TarifaUpmeDetalle {
  const valorSinIvaUvt = valorSinIvaCop / uvtCop
  const beneficioUvt = (valorSinIvaUvt - UMBRAL_BENEFICIO_UVT) * FACTOR_BENEFICIO
  const beneficioCop = beneficioUvt * uvtCop
  const pagoMinimoCop = TARIFA_FIJO_UVT * uvtCop + beneficioCop * FACTOR_TARIFA_BENEFICIO
  const topeCop = TARIFA_TOPE_UVT * uvtCop
  const tarifaCop = Math.round(Math.min(pagoMinimoCop, topeCop))

  return {
    valorSinIvaCop,
    uvtCop,
    valorSinIvaUvt,
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
