/**
 * Constantes fiscales Colombia 2026
 * Fuente: DIAN, Resolución 000238 dic 2025
 *
 * IMPORTANTE: Estos valores deben actualizarse cada año fiscal.
 * La tabla fiscal_params en BD permite override por workspace.
 */

// =============================================
// UVT Y TOPES 2026
// =============================================

export const UVT_2026 = 52_374

/** Tope para NO ser responsable de IVA: 3.500 UVT */
export const TOPE_NO_RESPONSABLE_IVA_UVT = 3_500
export const TOPE_NO_RESPONSABLE_IVA_COP = TOPE_NO_RESPONSABLE_IVA_UVT * UVT_2026

/** Tope para Régimen Simple de Tributación: 100.000 UVT */
export const TOPE_RST_UVT = 100_000
export const TOPE_RST_COP = TOPE_RST_UVT * UVT_2026

// =============================================
// TARIFAS DE RETENCIÓN
// =============================================

/** Retefuente por honorarios — Persona Natural declarante o no */
export const RETEFUENTE_HONORARIOS_PCT = 11

/** Retefuente por servicios — PJ o PN declarante, desde 2 UVT */
export const RETEFUENTE_SERVICIOS_PJ_PCT = 4
export const RETEFUENTE_SERVICIOS_BASE_UVT = 2

/** ReteIVA — 15% del IVA facturado (aplica cuando usuario es responsable de IVA) */
export const RETEIVA_SOBRE_IVA_PCT = 15

/** IVA general Colombia */
export const IVA_PCT = 19

// =============================================
// SEGURIDAD SOCIAL INDEPENDIENTES
// =============================================

/**
 * Base: 40% de ingresos brutos (facturación)
 * Tarifa: 28.5% (salud 12.5% + pensión 16%)
 * Sobre facturación: 40% x 28.5% = 11.4%
 */
export const SEGURIDAD_SOCIAL_BASE_PCT = 40
export const SEGURIDAD_SOCIAL_TARIFA_PCT = 28.5
export const SEGURIDAD_SOCIAL_EFECTIVO_PCT = 11.4

// =============================================
// TARIFAS ICA POR CIUDAD (en ‰ — por mil)
// =============================================

export interface TarifaICA {
  ciudad: string
  consultoria: number // ‰ (por mil) — para convertir a % dividir entre 10
  rango_min: number
  rango_max: number
}

export const TARIFAS_ICA: TarifaICA[] = [
  { ciudad: 'Bogotá', consultoria: 9.66, rango_min: 4.14, rango_max: 13.8 },
  { ciudad: 'Medellín', consultoria: 9.66, rango_min: 4.14, rango_max: 11.04 },
  { ciudad: 'Cali', consultoria: 10.0, rango_min: 4.14, rango_max: 10.0 },
  { ciudad: 'Barranquilla', consultoria: 7.0, rango_min: 4.14, rango_max: 10.0 },
  { ciudad: 'Cartagena', consultoria: 7.0, rango_min: 4.14, rango_max: 10.0 },
  { ciudad: 'Bucaramanga', consultoria: 7.0, rango_min: 4.14, rango_max: 10.0 },
  { ciudad: 'Pereira', consultoria: 7.0, rango_min: 4.14, rango_max: 10.0 },
  { ciudad: 'Manizales', consultoria: 7.0, rango_min: 4.14, rango_max: 10.0 },
  { ciudad: 'Ibagué', consultoria: 7.0, rango_min: 4.14, rango_max: 10.0 },
  { ciudad: 'Villavicencio', consultoria: 7.0, rango_min: 4.14, rango_max: 10.0 },
]

/**
 * Obtiene la tarifa ICA de consultoría para una ciudad (en %)
 * @returns porcentaje (ej: 0.966 para Bogotá)
 */
export function getTarifaICA(ciudad: string): number {
  const tarifa = TARIFAS_ICA.find(t => t.ciudad === ciudad)
  if (!tarifa) return 0
  return tarifa.consultoria / 10
}
