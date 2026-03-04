/**
 * Motor fiscal centralizado MéTRIK ONE — v2
 *
 * Fuente de verdad para todos los cálculos fiscales colombianos.
 * Spec: [98B] §7. Validación: Felipe [55A], Hana [53C], Emilio [56].
 *
 * Consumidores: Cotización Flash, Editor de cotización, PDF, (futuro) Edge Function.
 *
 * Cadena de cortocircuitos §7.2:
 * 1. ¿estado_fiscal tenant = pendiente? → STOP
 * 2. ¿Perfil A (no responsable IVA)? → IVA = $0, solo retenciones + alerta tope
 * 3. ¿Servicio excluido/exento? → IVA = $0 para ese ítem
 * 4. IVA = precio × tarifa_iva del servicio
 * 5. ¿Tenant es autorretenedor? → cliente NO retiene (D92)
 * 6. ¿Cliente retiene IVA? → ReteIVA
 * 7. ReteICA
 * 8. Neto
 */

import type { FiscalProfile, Client } from '@/types/database'
import {
  UVT_2026,
  TOPE_NO_RESPONSABLE_IVA_COP,
  RETEFUENTE_HONORARIOS_DECLARANTE_PCT,
  RETEFUENTE_HONORARIOS_NO_DECLARANTE_PCT,
  RETEFUENTE_SERVICIOS_PJ_PCT,
  RETEFUENTE_SERVICIOS_BASE_COP,
  IVA_PCT,
  RETEIVA_SOBRE_IVA_PCT,
  SEGURIDAD_SOCIAL_EFECTIVO_PCT,
  getTarifaICA,
} from './constants'

// =============================================
// PERFILES FISCALES — §2.10, D88
// =============================================

export type PerfilFiscalLetra = 'A' | 'B' | 'C' | 'D'

/**
 * Clasifica al tenant en uno de los 4 perfiles fiscales adaptativos.
 * Fuente: casilla 53 RUT + tipo persona + régimen (D88).
 *
 * A: Independiente no responsable IVA (~45% ICP)
 * B: PN responsable IVA, régimen ordinario (~25%)
 * C: PJ responsable IVA (~20%)
 * D: Régimen Simple (~10%)
 */
export function clasificarPerfilFiscal(perfil: FiscalProfile): PerfilFiscalLetra {
  const u = adaptPerfilUsuario(perfil)

  // D: Régimen Simple (cualquier tipo persona)
  if (u.regimen_tributario === 'simple') return 'D'

  // A: No responsable de IVA
  if (!u.responsable_iva) return 'A'

  // C: PJ responsable de IVA
  if (u.tipo_contribuyente === 'persona_juridica') return 'C'

  // B: PN responsable de IVA (ordinario)
  return 'B'
}

// =============================================
// TIPOS IVA POR SERVICIO — §2.8, D78, D80
// =============================================

export type TipoIVA = 'gravado_19' | 'gravado_5' | 'exento' | 'excluido'

const TARIFA_IVA_MAP: Record<TipoIVA, number> = {
  gravado_19: 19,
  gravado_5: 5,
  exento: 0,
  excluido: 0,
}

export function getTarifaIVAPorTipo(tipoIva: TipoIVA): number {
  return TARIFA_IVA_MAP[tipoIva] ?? IVA_PCT
}

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

function adaptPerfilUsuario(fp: FiscalProfile) {
  return {
    tipo_contribuyente: fp.person_type || 'persona_natural',
    regimen_tributario: fp.tax_regime || 'ordinario',
    responsable_iva: fp.iva_responsible ?? false,
    es_declarante: fp.is_declarante ?? true, // conservador: asumir declarante
    autorretenedor: fp.self_withholder ?? false,
    ciudad: fp.ica_city || '',
  }
}

function adaptFiscalCliente(client: Client) {
  return {
    tipo_cliente: client.person_type || 'persona_natural',
    regimen_simple: client.tax_regime === 'simple',
    agente_retenedor: client.agente_retenedor ?? false,
    gran_contribuyente: client.gran_contribuyente ?? false,
  }
}

// =============================================
// CALCULO DE IVA
// =============================================

/**
 * Determina si se debe cobrar IVA y calcula el valor.
 * Cortocircuitos §7.2:
 *   paso 2: Perfil A (no responsable IVA) → IVA = $0
 *   paso 3: Servicio exento/excluido → IVA = $0
 *   paso 4: IVA = precio × tarifa_iva del servicio
 *
 * @param tipoIva — tipo IVA del servicio (D78, D80). Default: gravado_19.
 */
export function calcularIVA(
  perfil: FiscalProfile,
  precioBase: number,
  tipoIva: TipoIVA = 'gravado_19'
): CalculoIVA {
  const u = adaptPerfilUsuario(perfil)

  // Cortocircuito §7.2.2: Perfil A / no responsable IVA → IVA = $0
  if (!u.responsable_iva) {
    return {
      aplica_iva: false,
      iva_pct: 0,
      iva_valor: 0,
      total_con_iva: precioBase,
    }
  }

  // Cortocircuito §7.2.3: Servicio exento o excluido → IVA = $0
  const tarifaIva = getTarifaIVAPorTipo(tipoIva)
  if (tarifaIva === 0) {
    return {
      aplica_iva: false,
      iva_pct: 0,
      iva_valor: 0,
      total_con_iva: precioBase,
    }
  }

  // §7.2.4: IVA = precio × tarifa_iva del servicio
  const ivaValor = Math.round(precioBase * (tarifaIva / 100))
  return {
    aplica_iva: true,
    iva_pct: tarifaIva,
    iva_valor: ivaValor,
    total_con_iva: precioBase + ivaValor,
  }
}

// =============================================
// CALCULO DE RETENCIONES
// =============================================

/**
 * Calcula retenciones que aplica el cliente al pagar.
 * Implementa cortocircuitos §7.2 pasos 5-7.
 *
 * Orden de evaluación (D92):
 * 1. Si tenant en Régimen Simple → NO retienen
 * 2. Si tenant es autorretenedor → cliente NO retiene en la fuente
 * 3. Si cliente es PN sin ser agente retenedor → NO retiene
 * 4. Si cliente en Régimen Simple → NO retiene
 * 5. Base mínima UVT: servicios/honorarios >= 4 UVT ($209,496)
 * 6. Tarifa según tipo_contribuyente + declarante
 * 7. ReteICA si cliente es agente retenedor
 * 8. ReteIVA si aplica
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

  // CORTOCIRCUITO 1: Tenant en Régimen Simple → NO le retienen
  if (u.regimen_tributario === 'simple') {
    return resultado
  }

  // CORTOCIRCUITO 2 (D92): Tenant es autorretenedor → cliente NO retiene en la fuente
  // ReteICA y ReteIVA pueden seguir aplicando
  const tenantAutorretenedor = u.autorretenedor

  // CORTOCIRCUITO 3: Cliente es PN sin ser agente retenedor → NO retiene
  if (c.tipo_cliente === 'persona_natural' && !c.agente_retenedor) {
    return resultado
  }

  // CORTOCIRCUITO 4: Cliente en Régimen Simple → NO retiene
  if (c.regimen_simple) {
    return resultado
  }

  // RETEFUENTE — solo si tenant NO es autorretenedor (D92)
  if (c.agente_retenedor && !tenantAutorretenedor) {
    // Base mínima: servicios/honorarios >= 4 UVT
    if (precioBase >= RETEFUENTE_SERVICIOS_BASE_COP) {
      if (u.tipo_contribuyente === 'persona_natural') {
        // PN declarante: 11%, PN no declarante: 10%
        resultado.retefuente_pct = u.es_declarante
          ? RETEFUENTE_HONORARIOS_DECLARANTE_PCT
          : RETEFUENTE_HONORARIOS_NO_DECLARANTE_PCT
      } else {
        // PJ: 4% servicios generales
        resultado.retefuente_pct = RETEFUENTE_SERVICIOS_PJ_PCT
      }
      resultado.retefuente_valor = Math.round(precioBase * (resultado.retefuente_pct / 100))
    }
  }

  // RETEICA — aplica independiente del autorretenedor
  if (c.agente_retenedor) {
    const tarifaICA = getTarifaICA(u.ciudad)
    if (tarifaICA > 0) {
      resultado.reteica_pct = tarifaICA
      resultado.reteica_valor = Math.round(precioBase * (tarifaICA / 100))
    }
  }

  // RETEIVA — 15% del IVA si aplica
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
 * Provisión seguridad social independientes.
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
 * Función principal que consolida todos los cálculos.
 */
export function generarResumenFiscal(
  perfil: FiscalProfile,
  client: Client,
  precioFinal: number,
  costoTotal: number = 0
): ResumenFiscal {
  const iva = calcularIVA(perfil, precioFinal)
  const totalPagaCliente = iva.total_con_iva
  const retenciones = calcularRetenciones(perfil, client, precioFinal, iva.iva_valor)
  const netoRecibido = totalPagaCliente - retenciones.total_retenciones
  const seguridadSocial = calcularSeguridadSocial(precioFinal)
  const gananciaReal = netoRecibido - costoTotal - seguridadSocial
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
// ALERTAS FISCALES — §7.8 D93 compliant
// =============================================

/**
 * Genera alertas condicionales basadas en el resumen fiscal.
 * D93: Sin verbos imperativos — informar, no instruir.
 */
export function generarAlertasFiscales(
  perfil: FiscalProfile,
  client: Client,
  resumen: ResumenFiscal,
  precioFinal: number,
  costoTotal: number,
  facturacionAcumulada: number = 0
): AlertaFiscal[] {
  const u = adaptPerfilUsuario(perfil)
  const c = adaptFiscalCliente(client)
  const perfilLetra = clasificarPerfilFiscal(perfil)
  const alertas: AlertaFiscal[] = []

  // Perfil A: Alerta tope 3.500 UVT (D86)
  if (perfilLetra === 'A' && facturacionAcumulada > 0) {
    const pctTope = (facturacionAcumulada / TOPE_NO_RESPONSABLE_IVA_COP) * 100
    if (pctTope >= 100) {
      alertas.push({
        tipo: 'danger',
        mensaje: `Facturación acumulada supera el tope de no responsable de IVA.`,
        detalle: `Al superar 3.500 UVT ($${TOPE_NO_RESPONSABLE_IVA_COP.toLocaleString('es-CO')}), la ley requiere inscripción como responsable (Art. 506 ET).`,
      })
    } else if (pctTope >= 80) {
      alertas.push({
        tipo: 'warning',
        mensaje: `Facturación acumulada: ${Math.round(pctTope)}% del tope de no responsable de IVA.`,
        detalle: `Tope anual: $${TOPE_NO_RESPONSABLE_IVA_COP.toLocaleString('es-CO')} (3.500 UVT).`,
      })
    }
  }

  // Ganancia negativa
  if (resumen.ganancia_real < 0) {
    alertas.push({
      tipo: 'danger',
      mensaje: 'Ganancia real negativa en este proyecto.',
      detalle: 'Los costos + impuestos superan el precio de venta.',
    })
  }
  // Margen real bajo
  else if (resumen.margen_real_neto_pct < 15 && resumen.margen_real_neto_pct >= 0) {
    const margenBruto = costoTotal > 0
      ? ((precioFinal - costoTotal) / precioFinal) * 100
      : 0
    alertas.push({
      tipo: 'warning',
      mensaje: `Margen bruto del ${Math.round(margenBruto)}% baja a ${resumen.margen_real_neto_pct}% después de impuestos.`,
    })
  }

  // Cliente PN no retiene — provisionar para declaración
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
        mensaje: 'Sin retenciones en este pago.',
        detalle: `Provisión sugerida para declaración de renta: ~$${provisionEstimada.toLocaleString('es-CO')}.`,
      })
    }
  }

  // Información sobre Régimen Simple
  if (
    u.regimen_tributario === 'ordinario' &&
    u.tipo_contribuyente === 'persona_natural' &&
    resumen.retefuente_valor > 0
  ) {
    alertas.push({
      tipo: 'info',
      mensaje: `En Régimen Simple no aplica retención en la fuente: +$${resumen.retefuente_valor.toLocaleString('es-CO')} de flujo en este proyecto.`,
    })
  }

  return alertas
}

// =============================================
// UTILIDADES
// =============================================

/**
 * Calcula precio sugerido desde costo total y margen esperado.
 * Fórmula: precio = costo / (1 - margen)
 */
export function calcularPrecioSugerido(costoTotal: number, margenPct: number): number {
  if (margenPct >= 100) return costoTotal * 10
  if (margenPct <= 0) return costoTotal
  return Math.round(costoTotal / (1 - margenPct / 100))
}

/**
 * Calcula margen real desde precio y costo.
 * Fórmula: margen = (precio - costo) / precio × 100
 */
export function calcularMargenReal(precioFinal: number, costoTotal: number): number {
  if (precioFinal <= 0) return 0
  return Math.round(((precioFinal - costoTotal) / precioFinal) * 1000) / 10
}
