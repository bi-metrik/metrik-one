/**
 * Motor de cálculos fiscales colombianos — MéTRIK ONE
 *
 * Parámetros fiscales 2026:
 * - UVT: $49.799 (seeded en fiscal_params)
 * - IVA general: 19%
 * - ReteFuente honorarios: 11% (declarante) / 10% (no declarante)
 * - ReteFuente servicios: 4% (>27 UVT) / 6% (>4 UVT)
 * - ReteICA Bogotá: 9.66‰ (0.966%)
 * - ReteIVA: 15% del IVA
 *
 * D51: Default conservador = PN + cliente jurídico + agente retenedor
 * D93: Disclaimer obligatorio
 * D94: Valores desde tabla fiscal_params (Supabase)
 */

// ── Types ──────────────────────────────────────────────

export interface FiscalProfile {
  personType: 'natural' | 'juridica'   // Tipo persona del usuario
  taxRegime: 'ordinario' | 'simple'    // Régimen tributario
  isDeclarante: boolean                // Declarante de renta
  ivaResponsible: boolean              // Responsable de IVA
  selfWithholder: boolean              // Autorretenedor
  icaRate: number                      // Tarifa ICA (‰)
  icaCity: string                      // Ciudad ICA
}

export interface ClientProfile {
  personType: 'natural' | 'juridica'
  agenteRetenedor: boolean
  granContribuyente: boolean
  taxRegime: 'ordinario' | 'simple'
}

export interface FiscalBreakdown {
  // Block 1: Cliente paga
  valorBruto: number
  iva: number
  totalClientePaga: number

  // Block 2: Te retienen
  reteFuente: number
  reteICA: number
  reteIVA: number
  totalRetenciones: number

  // Block 3: Te consignan
  netoRecibido: number

  // Meta
  reteFuenteRate: number
  ivaRate: number
  reteICARate: number
  reteIVARate: number
  hasIVA: boolean
  hasRetenciones: boolean
  isEstimated: boolean       // true if using defaults (no complete fiscal profile)
}

// ── Default Profiles (D51) ─────────────────────────────

export const DEFAULT_USER_PROFILE: FiscalProfile = {
  personType: 'natural',
  taxRegime: 'ordinario',
  isDeclarante: true,
  ivaResponsible: true,
  selfWithholder: false,
  icaRate: 9.66,            // Bogotá default (‰)
  icaCity: 'Bogotá',
}

export const DEFAULT_CLIENT_PROFILE: ClientProfile = {
  personType: 'juridica',
  agenteRetenedor: true,
  granContribuyente: false,
  taxRegime: 'ordinario',
}

// ── Fiscal Parameters ──────────────────────────────────

export interface FiscalParams {
  uvt: number
  ivaGeneral: number
  reteFuenteHonorarios11: number
  reteFuenteHonorarios10: number
  reteFuenteServicios4: number
  reteFuenteServicios6: number
  reteICABogotaDefault: number
  reteIVAPct: number
  topeReteFuenteServiciosUVT: number
  topeReteFuenteHonorariosUVT: number
}

export const DEFAULT_PARAMS: FiscalParams = {
  uvt: 49799,
  ivaGeneral: 19,
  reteFuenteHonorarios11: 11,
  reteFuenteHonorarios10: 10,
  reteFuenteServicios4: 4,
  reteFuenteServicios6: 6,
  reteICABogotaDefault: 9.66,
  reteIVAPct: 15,
  topeReteFuenteServiciosUVT: 4,
  topeReteFuenteHonorariosUVT: 27,
}

// ── Calculator ─────────────────────────────────────────

export function calcularFiscal(
  valorBruto: number,
  userProfile: FiscalProfile = DEFAULT_USER_PROFILE,
  clientProfile: ClientProfile = DEFAULT_CLIENT_PROFILE,
  params: FiscalParams = DEFAULT_PARAMS,
): FiscalBreakdown {
  // ── IVA ──
  const hasIVA = userProfile.ivaResponsible
  const ivaRate = hasIVA ? params.ivaGeneral : 0
  const iva = Math.round(valorBruto * (ivaRate / 100))
  const totalClientePaga = valorBruto + iva

  // ── Retenciones ──
  // No retenciones si:
  // - Cliente NO es agente retenedor
  // - Usuario en Régimen Simple
  // - Cliente en Régimen Simple (no retiene)
  const clientRetiene =
    clientProfile.agenteRetenedor &&
    userProfile.taxRegime !== 'simple' &&
    clientProfile.taxRegime !== 'simple'

  let reteFuente = 0
  let reteFuenteRate = 0
  let reteICA = 0
  let reteICARate = 0
  let reteIVA = 0
  let reteIVARate = 0

  if (clientRetiene) {
    // ── ReteFuente ──
    if (userProfile.personType === 'natural') {
      // Persona Natural → Honorarios
      const tope = params.topeReteFuenteHonorariosUVT * params.uvt
      if (valorBruto > tope) {
        reteFuenteRate = userProfile.isDeclarante
          ? params.reteFuenteHonorarios11
          : params.reteFuenteHonorarios10
        reteFuente = Math.round(valorBruto * (reteFuenteRate / 100))
      }
    } else {
      // Persona Jurídica → Servicios
      const tope = params.topeReteFuenteServiciosUVT * params.uvt
      if (valorBruto > tope) {
        reteFuenteRate = params.reteFuenteServicios4
        reteFuente = Math.round(valorBruto * (reteFuenteRate / 100))
      }
    }

    // ── ReteICA ──
    reteICARate = userProfile.icaRate // en por mil (‰)
    reteICA = Math.round(valorBruto * (reteICARate / 1000))

    // ── ReteIVA ──
    if (hasIVA && iva > 0) {
      reteIVARate = params.reteIVAPct
      reteIVA = Math.round(iva * (reteIVARate / 100))
    }
  }

  const totalRetenciones = reteFuente + reteICA + reteIVA
  const netoRecibido = totalClientePaga - totalRetenciones
  const hasRetenciones = totalRetenciones > 0

  return {
    valorBruto,
    iva,
    totalClientePaga,
    reteFuente,
    reteICA,
    reteIVA,
    totalRetenciones,
    netoRecibido,
    reteFuenteRate,
    ivaRate,
    reteICARate,
    reteIVARate,
    hasIVA,
    hasRetenciones,
    isEstimated: false,
  }
}

// ── Formatters ─────────────────────────────────────────

export function formatCOP(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value)
}

export function formatPct(value: number): string {
  return `${value}%`
}

export function formatPerMil(value: number): string {
  return `${value}‰`
}

// ── Disclaimer (D93) ───────────────────────────────────

export const FISCAL_DISCLAIMER =
  'Valores estimados con base en parámetros fiscales 2026. Consulta tu contador para cálculos definitivos.'
