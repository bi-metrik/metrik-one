/**
 * Colombian fiscal calculations for cotizaciones
 * Based on DIAN 2026 rates
 */

// UVT 2026 (approx — adjust to real value)
export const UVT_2026 = 49799

export interface FiscalProfile {
  tipo_persona: 'natural' | 'juridica'
  regimen_tributario: 'responsable' | 'no_responsable' | 'simplificado' | 'gran_contribuyente'
  gran_contribuyente: boolean
  agente_retenedor: boolean
  autorretenedor: boolean
  ica_rate: number | null
  ica_city: string | null
}

export interface FiscalResult {
  subtotal: number
  iva: number
  ivaRate: number
  reteFuente: number
  reteFuenteRate: number
  reteICA: number
  reteICARate: number
  reteIVA: number
  reteIVARate: number
  totalBruto: number      // subtotal + IVA
  totalRetenciones: number
  teQueda: number          // totalBruto - totalRetenciones
  aplica: {
    iva: boolean
    reteFuente: boolean
    reteICA: boolean
    reteIVA: boolean
  }
}

/**
 * Calculate fiscal deductions for a cotización
 *
 * Rules:
 * - IVA 19%: applies if vendor is "responsable de IVA"
 * - ReteFuente: if subtotal >= 27 UVT for services, rate 11% (juridica) or 10% (natural)
 * - ReteICA: if buyer is agente_retenedor AND vendor has ICA rate set
 * - ReteIVA: 15% of IVA, if buyer is gran_contribuyente or agente_retenedor
 */
export function calcularFiscal(
  subtotal: number,
  vendedor: FiscalProfile,
  comprador: FiscalProfile | null,
): FiscalResult {
  // IVA: 19% if responsable
  const aplicaIVA = vendedor.regimen_tributario === 'responsable' || vendedor.regimen_tributario === 'gran_contribuyente'
  const ivaRate = aplicaIVA ? 0.19 : 0
  const iva = Math.round(subtotal * ivaRate)

  // ReteFuente: services >= 27 UVT
  const umbralReteFuente = 27 * UVT_2026
  const aplicaReteFuente = comprador?.agente_retenedor === true && subtotal >= umbralReteFuente && !vendedor.autorretenedor
  const reteFuenteRate = aplicaReteFuente
    ? (vendedor.tipo_persona === 'natural' ? 0.10 : 0.11)
    : 0
  const reteFuente = Math.round(subtotal * reteFuenteRate)

  // ReteICA: if comprador es agente retenedor y vendedor tiene tarifa ICA
  const aplicaReteICA = comprador?.agente_retenedor === true && (vendedor.ica_rate ?? 0) > 0
  const reteICARate = aplicaReteICA ? (vendedor.ica_rate! / 1000) : 0
  const reteICA = Math.round(subtotal * reteICARate)

  // ReteIVA: 15% del IVA si comprador es gran contribuyente o agente retenedor
  const aplicaReteIVA = aplicaIVA && (comprador?.gran_contribuyente === true || comprador?.agente_retenedor === true)
  const reteIVARate = aplicaReteIVA ? 0.15 : 0
  const reteIVA = Math.round(iva * reteIVARate)

  const totalBruto = subtotal + iva
  const totalRetenciones = reteFuente + reteICA + reteIVA
  const teQueda = totalBruto - totalRetenciones

  return {
    subtotal,
    iva,
    ivaRate,
    reteFuente,
    reteFuenteRate,
    reteICA,
    reteICARate,
    reteIVA,
    reteIVARate,
    totalBruto,
    totalRetenciones,
    teQueda,
    aplica: {
      iva: aplicaIVA,
      reteFuente: aplicaReteFuente,
      reteICA: aplicaReteICA,
      reteIVA: aplicaReteIVA,
    },
  }
}

export function formatCOPFiscal(v: number): string {
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)
}
