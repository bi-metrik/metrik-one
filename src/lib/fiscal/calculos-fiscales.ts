/**
 * Motor de cálculos fiscales para cotizaciones MéTRIK ONE
 *
 * Calcula retenciones, seguridad social y ganancia real
 * basándose en el perfil fiscal del usuario x perfil fiscal del cliente.
 */

import type { FiscalProfile, Client } from '@/types/database'
import {
  RETEFUENTE_HONORARIOS_PCT,
  RETEFUENTE_SERVICIOS_PJ_PCT,
  IVA_PCT,
  RETEIVA_SOBRE_IVA_PCT,
  SEGURIDAD_SOCIAL_EFECTIVO_PCT,
  getTarifaICA,
} from './constants'

// =============================================
// INTERFACES
// =============================================

export interface RetencionesCotizacion {
  retefuente_pct: number
  retefuente_valor: number
  reteica_pct: number
  reteica_valor: number
  reteiva_pct: number
  reteiva_valor: number
  total_retenciones: number
}

export interface CalculoIVA {
  aplica_iva: boolean
  iva_pct: number
  iva_valor: number
  total_con_iva: number
}

export interface ResumenFiscal {
  iva: number
  total_paga_cliente: number
  retefuente_pct: number
  retefuente_valor: number
  reteica_pct: number
  reteica_valor: number
  reteiva_pct: number
  reteiva_valor: number
  neto_recibido: number
  seguridad_social: number
  ganancia_real: number
  margen_real_neto_pct: number
}

export interface AlertaFiscal {
  tipo: 'warning' | 'danger' | 'info'
  mensaje: string
  detalle?: string
}

// =============================================
// Adapters: ONE types → fiscal logic
// =============================================

/**
 * Adapta FiscalProfile de ONE al formato que necesita el motor fiscal.
 * ONE usa: person_type, tax_regime, iva_responsible, ica_city
 */
function adaptPerfilUsuario(fp: FiscalProfile) {
  return {
    tipo_contribuyente: fp.person_type || 'persona_natural',
    regimen_tributario: fp.tax_regime || 'ordinario',
    responsable_iva: fp.iva_responsible,
    ciudad: fp.ica_city || '',
  }
}

/**
 * Adapta Client de ONE al formato fiscal del cliente.
 * ONE usa: person_type, tax_regime, gran_contribuyente, agente_retenedor
 */
function adaptFiscalCliente(client: Client) {
  return {
    tipo_cliente: client.person_type || 'persona_natural',
    regimen_simple: client.tax_regime === 'simple',
    agente_retenedor: client.agente_retenedor,
    gran_contribuyente: client.gran_contribuyente,
  }
}

// =============================================
// CALCULO DE IVA
// =============================================

/**
 * Determina si se debe cobrar IVA y calcula el valor
 */
export function calcularIVA(
  perfil: FiscalProfile,
  precioBase: number
): CalculoIVA {
  const u = adaptPerfilUsuario(perfil)

  if (!u.responsable_iva) {
    return {
      aplica_iva: false,
      iva_pct: 0,
      iva_valor: 0,
      total_con_iva: precioBase,
    }
  }

  const ivaValor = Math.round(precioBase * (IVA_PCT / 100))
  return {
    aplica_iva: true,
    iva_pct: IVA_PCT,
    iva_valor: ivaValor,
    total_con_iva: precioBase + ivaValor,
  }
}

// =============================================
// CALCULO DE RETENCIONES
// =============================================

/**
 * Calcula las retenciones que aplica el cliente al pagar.
 *
 * Matriz: perfil usuario x perfil cliente
 * - Si usuario = Régimen Simple → NO le retienen
 * - Si cliente = PN (no retiene) → NO retiene
 * - Si cliente = PJ + Régimen Simple → NO retiene retefuente/ICA
 * - Si cliente = PJ + Agente Retenedor → retiene retefuente + ICA
 * - Si cliente = Gran Contribuyente → retiene retefuente + ICA + posible reteIVA
 */
export function calcularRetenciones(
  perfil: FiscalProfile,
  client: Client,
  precioBase: number,
  ivaValor: number = 0
): RetencionesCotizacion {
  const u = adaptPerfilUsuario(perfil)
  const c = adaptFiscalCliente(client)

  const resultado: RetencionesCotizacion = {
    retefuente_pct: 0,
    retefuente_valor: 0,
    reteica_pct: 0,
    reteica_valor: 0,
    reteiva_pct: 0,
    reteiva_valor: 0,
    total_retenciones: 0,
  }

  // REGLA 1: Si usuario está en Régimen Simple → NO le retienen
  if (u.regimen_tributario === 'simple') {
    return resultado
  }

  // REGLA 2: Si el cliente es Persona Natural (no retiene) → NO retiene
  if (c.tipo_cliente === 'persona_natural' && !c.agente_retenedor) {
    return resultado
  }

  // REGLA 3: Si el cliente está en Régimen Simple → NO retiene retefuente/ICA
  if (c.regimen_simple) {
    return resultado
  }

  // RETEFUENTE
  if (c.agente_retenedor) {
    if (u.tipo_contribuyente === 'persona_natural') {
      resultado.retefuente_pct = RETEFUENTE_HONORARIOS_PCT
    } else {
      resultado.retefuente_pct = RETEFUENTE_SERVICIOS_PJ_PCT
    }
    resultado.retefuente_valor = Math.round(precioBase * (resultado.retefuente_pct / 100))
  }

  // RETEICA
  if (c.agente_retenedor) {
    const tarifaICA = getTarifaICA(u.ciudad)
    if (tarifaICA > 0) {
      resultado.reteica_pct = tarifaICA
      resultado.reteica_valor = Math.round(precioBase * (tarifaICA / 100))
    }
  }

  // RETEIVA
  if (u.responsable_iva && ivaValor > 0) {
    if (c.agente_retenedor || c.gran_contribuyente) {
      resultado.reteiva_pct = RETEIVA_SOBRE_IVA_PCT
      resultado.reteiva_valor = Math.round(ivaValor * (RETEIVA_SOBRE_IVA_PCT / 100))
    }
  }

  resultado.total_retenciones =
    resultado.retefuente_valor + resultado.reteica_valor + resultado.reteiva_valor

  return resultado
}

// =============================================
// CALCULO SEGURIDAD SOCIAL
// =============================================

/**
 * Calcula la provisión de seguridad social para independientes
 * Base: 40% de ingresos brutos, Tarifa: 28.5% → Efectivo: 11.4%
 */
export function calcularSeguridadSocial(precioBase: number): number {
  return Math.round(precioBase * (SEGURIDAD_SOCIAL_EFECTIVO_PCT / 100))
}

// =============================================
// RESUMEN FISCAL COMPLETO
// =============================================

/**
 * Genera el resumen fiscal completo de una cotización.
 * Esta es la función principal que consolida todos los cálculos.
 */
export function generarResumenFiscal(
  perfil: FiscalProfile,
  client: Client,
  precioFinal: number,
  costoTotal: number = 0
): ResumenFiscal {
  // 1. IVA
  const iva = calcularIVA(perfil, precioFinal)

  // 2. Total que paga el cliente
  const totalPagaCliente = iva.total_con_iva

  // 3. Retenciones
  const retenciones = calcularRetenciones(perfil, client, precioFinal, iva.iva_valor)

  // 4. Neto recibido = total_paga_cliente - retenciones
  const netoRecibido = totalPagaCliente - retenciones.total_retenciones

  // 5. Seguridad social (sobre precio base, no sobre total con IVA)
  const seguridadSocial = calcularSeguridadSocial(precioFinal)

  // 6. Ganancia real = neto_recibido - costos - seguridad_social
  const gananciaReal = netoRecibido - costoTotal - seguridadSocial

  // 7. Margen real neto (sobre precio final)
  const margenRealNeto = precioFinal > 0
    ? (gananciaReal / precioFinal) * 100
    : 0

  return {
    iva: iva.iva_valor,
    total_paga_cliente: totalPagaCliente,
    retefuente_pct: retenciones.retefuente_pct,
    retefuente_valor: retenciones.retefuente_valor,
    reteica_pct: retenciones.reteica_pct,
    reteica_valor: retenciones.reteica_valor,
    reteiva_pct: retenciones.reteiva_pct,
    reteiva_valor: retenciones.reteiva_valor,
    neto_recibido: netoRecibido,
    seguridad_social: seguridadSocial,
    ganancia_real: gananciaReal,
    margen_real_neto_pct: Math.round(margenRealNeto * 10) / 10,
  }
}

// =============================================
// ALERTAS FISCALES
// =============================================

/**
 * Genera alertas condicionales basadas en el resumen fiscal
 * ("Alertas de Felipe")
 */
export function generarAlertasFiscales(
  perfil: FiscalProfile,
  client: Client,
  resumen: ResumenFiscal,
  precioFinal: number,
  costoTotal: number
): AlertaFiscal[] {
  const u = adaptPerfilUsuario(perfil)
  const c = adaptFiscalCliente(client)
  const alertas: AlertaFiscal[] = []

  // Ganancia negativa
  if (resumen.ganancia_real < 0) {
    alertas.push({
      tipo: 'danger',
      mensaje: 'Estás perdiendo plata en este proyecto.',
      detalle: 'Revisa tus costos o sube el precio.',
    })
  }
  // Margen real bajo
  else if (resumen.margen_real_neto_pct < 15 && resumen.margen_real_neto_pct >= 0) {
    const margenBruto = costoTotal > 0
      ? ((precioFinal - costoTotal) / precioFinal) * 100
      : 0
    alertas.push({
      tipo: 'warning',
      mensaje: `Con margen del ${Math.round(margenBruto)}%, el margen REAL después de impuestos baja a ${resumen.margen_real_neto_pct}%.`,
    })
  }

  // Cliente no retiene (PN) — la plata no es toda tuya
  if (
    c.tipo_cliente === 'persona_natural' &&
    !c.agente_retenedor &&
    u.regimen_tributario === 'ordinario'
  ) {
    const provisionEstimada = resumen.retefuente_valor === 0
      ? Math.round(precioFinal * 0.11)
      : 0
    if (provisionEstimada > 0) {
      alertas.push({
        tipo: 'warning',
        mensaje: 'Te llega más plata pero NO es toda tuya.',
        detalle: `Provisiona ~$${provisionEstimada.toLocaleString('es-CO')} para impuestos.`,
      })
    }
  }

  // Podría beneficiarse de Régimen Simple
  if (
    u.regimen_tributario === 'ordinario' &&
    u.tipo_contribuyente === 'persona_natural' &&
    resumen.retefuente_valor > 0
  ) {
    alertas.push({
      tipo: 'info',
      mensaje: 'Si estuvieras en Régimen Simple: no te retienen retefuente.',
      detalle: `Eso significaría +$${resumen.retefuente_valor.toLocaleString('es-CO')} de flujo por este proyecto.`,
    })
  }

  return alertas
}

// =============================================
// UTILIDADES
// =============================================

/**
 * Formatea un valor en pesos colombianos
 */
export function formatCOP(valor: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(valor)
}

/**
 * Calcula precio sugerido desde costo total y margen esperado
 * Fórmula: precio = costo / (1 - margen)
 */
export function calcularPrecioSugerido(costoTotal: number, margenPct: number): number {
  if (margenPct >= 100) return costoTotal * 10
  if (margenPct <= 0) return costoTotal
  return Math.round(costoTotal / (1 - margenPct / 100))
}

/**
 * Calcula margen real desde precio y costo
 * Fórmula: margen = (precio - costo) / precio x 100
 */
export function calcularMargenReal(precioFinal: number, costoTotal: number): number {
  if (precioFinal <= 0) return 0
  return Math.round(((precioFinal - costoTotal) / precioFinal) * 1000) / 10
}
