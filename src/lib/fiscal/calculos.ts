/**
 * Wrapper de compatibilidad — interfaz legacy para cotizacion-flash, pdf-actions, cotizacion-pdf.
 * Lógica interna delegada a calculos-fiscales.ts (motor fiscal v2).
 *
 * @deprecated Nuevos consumidores deben usar calculos-fiscales.ts directamente.
 */

import {
  calcularIVA,
  calcularRetenciones,
} from './calculos-fiscales'
import type { FiscalProfile as DBFiscalProfile, Client as DBClient } from '@/types/database'

export { UVT_2026 } from './constants'

// =============================================
// Legacy interfaces — cotizacion-flash, pdf-actions, cotizacion-pdf
// =============================================

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
  totalBruto: number
  totalRetenciones: number
  teQueda: number
  aplica: {
    iva: boolean
    reteFuente: boolean
    reteICA: boolean
    reteIVA: boolean
  }
}

// =============================================
// Adapters: legacy shapes → DB shapes
// =============================================

function isPN(tipo: string): boolean {
  return tipo === 'natural' || tipo === 'persona_natural'
}

function isSimple(regimen: string): boolean {
  return regimen === 'simplificado' || regimen === 'simple'
}

function isResponsableIVA(regimen: string): boolean {
  return regimen === 'responsable' || regimen === 'gran_contribuyente'
}

function toDBPerfil(fp: FiscalProfile) {
  return {
    person_type: isPN(fp.tipo_persona) ? 'persona_natural' : 'persona_juridica',
    tax_regime: isSimple(fp.regimen_tributario) ? 'simple' : 'ordinario',
    iva_responsible: isResponsableIVA(fp.regimen_tributario),
    is_declarante: true, // conservador: asumir declarante
    self_withholder: fp.autorretenedor,
    ica_city: fp.ica_city,
    ica_rate: fp.ica_rate,
  } as unknown as DBFiscalProfile
}

function toDBClient(buyer: FiscalProfile) {
  return {
    person_type: isPN(buyer.tipo_persona) ? 'persona_natural' : 'persona_juridica',
    tax_regime: isSimple(buyer.regimen_tributario) ? 'simple' : 'ordinario',
    agente_retenedor: buyer.agente_retenedor,
    gran_contribuyente: buyer.gran_contribuyente,
  } as unknown as DBClient
}

// =============================================
// CALCULO FISCAL — wrapper sobre motor v2
// =============================================

/**
 * Calculate fiscal deductions for a cotización.
 * Delegates to motor fiscal v2 (calculos-fiscales.ts).
 *
 * @deprecated Use generarResumenFiscal() from calculos-fiscales.ts for new code.
 */
export function calcularFiscal(
  subtotal: number,
  vendedor: FiscalProfile,
  comprador: FiscalProfile | null,
): FiscalResult {
  const dbPerfil = toDBPerfil(vendedor)
  const dbClient = comprador
    ? toDBClient(comprador)
    : ({
        person_type: 'persona_juridica',
        tax_regime: 'ordinario',
        agente_retenedor: false,
        gran_contribuyente: false,
      } as unknown as DBClient)

  const iva = calcularIVA(dbPerfil, subtotal)
  const ret = calcularRetenciones(dbPerfil, dbClient, subtotal, iva.iva_valor)

  const totalBruto = iva.total_con_iva
  const totalRetenciones = ret.total_retenciones

  return {
    subtotal,
    iva: iva.iva_valor,
    ivaRate: iva.aplica_iva ? iva.iva_pct / 100 : 0,
    reteFuente: ret.retefuente_valor,
    reteFuenteRate: ret.retefuente_pct / 100,
    reteICA: ret.reteica_valor,
    reteICARate: ret.reteica_pct / 100,
    reteIVA: ret.reteiva_valor,
    reteIVARate: ret.reteiva_pct > 0 ? ret.reteiva_pct / 100 : 0,
    totalBruto,
    totalRetenciones,
    teQueda: totalBruto - totalRetenciones,
    aplica: {
      iva: iva.aplica_iva,
      reteFuente: ret.retefuente_valor > 0,
      reteICA: ret.reteica_valor > 0,
      reteIVA: ret.reteiva_valor > 0,
    },
  }
}
