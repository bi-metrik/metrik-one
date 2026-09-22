/**
 * El IVA de una cotización cuando la agencia vende A NOMBRE DE TERCEROS.
 *
 * ## Por qué existe
 *
 * Una agencia de viajes que intermedia (modelo de mandato) no le cobra IVA al viajero
 * sobre todo el paquete: la parte del tercero (la aerolínea, el hotel, el operador) la
 * factura el tercero, y la agencia pone IVA solo sobre lo que se queda. La DIAN lo dice
 * así (Oficio 7414 de 2025) y así factura hoy Trappvel: «al FEE se le cobra IVA; al resto
 * de la factura no». El motor fiscal de ONE ponía el 19 % sobre el total de la cotización.
 *
 * La regla la fijó Felipe el 2026-09-22 y NO se decide aquí: este módulo es el mecanismo,
 * y el valor de cada parámetro lo pone la configuración.
 *
 *  · `config_extra.iva_cotizacion.base` del WORKSPACE: `valor_completo` (lo de siempre,
 *    el defecto de todos) o `ingreso_propio`.
 *  · `items.base_iva` de cada LÍNEA, cuando la línea no sigue al workspace:
 *      - `ingreso_propio`: la línea se vende a nombre de un tercero; el IVA va sobre
 *        precio − lo que se le paga al tercero. Es el defecto con la base encendida.
 *      - `valor_completo`: un servicio que la agencia presta con recursos propios, sin
 *        tercero detrás. El IVA va sobre el precio entero.
 *      - `sin_iva`: una línea comisionable (venta = costo): la comisión se la factura la
 *        agencia al proveedor, con su IVA, en OTRO documento. Hacia el viajero, $0.
 *
 * ## Tres decisiones que no son obvias
 *
 * 1. **Lo que se le paga al tercero es el costo de la línea SIN administrativos.** El AIU
 *    es plata que la agencia no le gira a nadie, así que es ingreso propio. (En Trappvel
 *    el AIU es 0 y la diferencia no existe.)
 * 2. **El IVA se redondea por línea y se suma.** Una sola regla: la misma cifra sale en el
 *    editor, en el cobro y en el documento, y el documento puede repartirlo entre sus
 *    líneas sin que su columna deje de sumar el total.
 * 3. **Una línea con precio y sin costo no tiene ingreso propio medible.** No se inventa
 *    una base: la línea queda marcada (`sinCosto`) y la cotización `calculable = false`.
 *    Quien llama decide qué hacer: el editor lo dice en la línea, el PDF sale como
 *    borrador y aprobar se rechaza. Hay dos excepciones que NO son un costo que falta: el
 *    recargo fijo y el ítem de cuadre, que son plata de la agencia por diseño.
 *
 * Con la base apagada (`valor_completo`, el defecto) nadie llama a este módulo: cada
 * superficie sigue por su camino de siempre y ningún workspace cambia un peso.
 *
 * Puro: sin base, sin red.
 */

import { calcularRetenciones } from './calculos-fiscales'
import { IVA_PCT } from './constants'
import type { FiscalResult } from './calculos'
import type { Client, FiscalProfile } from '@/types/database'

// ── La configuración del workspace ───────────────────────────────────────────

export type BaseIvaLinea = 'ingreso_propio' | 'valor_completo' | 'sin_iva'

export const BASES_IVA_LINEA: readonly BaseIvaLinea[] = ['ingreso_propio', 'valor_completo', 'sin_iva']

/** Cómo sale el IVA en el documento del cliente. Lo decide Edgar, no Felipe. */
export type IvaEnDocumento = 'linea_incluida' | 'oculto'

export interface ConfigIvaCotizacion {
  base: 'valor_completo' | 'ingreso_propio'
  enDocumento: IvaEnDocumento
}

/** Lo de siempre: IVA sobre el total. Es lo que recibe todo workspace que no declare nada. */
export const CONFIG_IVA_POR_DEFECTO: ConfigIvaCotizacion = {
  base: 'valor_completo',
  enDocumento: 'linea_incluida',
}

export function esBaseIvaLinea(valor: unknown): valor is BaseIvaLinea {
  return typeof valor === 'string' && (BASES_IVA_LINEA as readonly string[]).includes(valor)
}

/**
 * Lee `config_extra.iva_cotizacion` del workspace.
 *
 * Solo el valor exacto enciende la base nueva. Un jsonb con otra forma, una clave mal
 * escrita o un valor desconocido caen al defecto, que es el comportamiento de siempre:
 * un error de configuración no puede cambiarle el precio con IVA a una cotización.
 */
export function leerConfigIvaCotizacion(configExtra: unknown): ConfigIvaCotizacion {
  const cfg = (configExtra ?? null) as { iva_cotizacion?: unknown } | null
  const iva = cfg && typeof cfg === 'object' ? cfg.iva_cotizacion : null
  if (!iva || typeof iva !== 'object') return CONFIG_IVA_POR_DEFECTO
  const { base, en_documento } = iva as { base?: unknown; en_documento?: unknown }
  return {
    base: base === 'ingreso_propio' ? 'ingreso_propio' : 'valor_completo',
    enDocumento: en_documento === 'oculto' ? 'oculto' : 'linea_incluida',
  }
}

/** ¿La cotización liquida el IVA por línea, sobre el ingreso propio? */
export function ivaSobreIngresoPropio(config: ConfigIvaCotizacion): boolean {
  return config.base === 'ingreso_propio'
}

/**
 * La tarifa que el vendedor cobra: la general si es responsable de IVA, 0 si no.
 *
 * Se lee del perfil fiscal de la BASE (`iva_responsible`), el mismo que usa el editor.
 */
export function tarifaIvaDelVendedor(perfil: Pick<FiscalProfile, 'iva_responsible'> | null | undefined): number {
  return perfil?.iva_responsible === true ? IVA_PCT : 0
}

// ── La liquidación ───────────────────────────────────────────────────────────

/** Una línea tal como la deja la cascada, más lo que hace falta para su IVA. */
export interface LineaParaIva {
  id: string
  nombre: string | null
  /** Precio de la línea SIN adicionales y antes del descuento comercial (`precioLinea`). */
  precio: number
  /** Lo que se le paga al tercero por la línea: `costoLinea`, sin administrativos. */
  costoTerceros: number
  /** Precio y costo de los adicionales de la variante. 0 si no tiene. */
  precioAdicionales: number
  costoAdicionales: number
  /** `items.base_iva`. `null` o ausente: sigue al workspace. */
  baseDeclarada?: BaseIvaLinea | null
  /**
   * Toda su plata es de la agencia aunque no tenga costo: el recargo fijo y el ítem de
   * cuadre. Sin base declarada, su IVA va sobre el precio entero y NUNCA se marca como
   * «falta el costo»: no le falta nada.
   */
  esDeLaAgencia?: boolean
}

export interface IvaDeLinea {
  id: string
  nombre: string | null
  base: BaseIvaLinea
  /** Lo que queda gravado, antes de la tarifa. */
  baseGravable: number
  /** IVA sobre la parte base de la línea. */
  ivaBase: number
  /** IVA sobre los adicionales de la línea. */
  ivaAdicionales: number
  /** `ivaBase + ivaAdicionales`. */
  iva: number
  /** Precio sin costo: su ingreso propio no se puede separar y su IVA NO se calculó. */
  sinCosto: boolean
}

export interface LiquidacionIva {
  lineas: IvaDeLinea[]
  baseGravable: number
  iva: number
  /** Las líneas sin costo medible, por nombre. Vacío = el IVA es completo. */
  sinCosto: string[]
  /** `false` si alguna línea no tiene costo: el IVA de arriba le falta esa parte. */
  calculable: boolean
  tarifaPct: number
}

function redondear(n: number): number {
  return Math.round(n)
}

/**
 * El IVA de un juego de líneas: la cotización vigente, o una tarifa.
 *
 * El descuento comercial se aplica a cada línea en proporción a su precio, que es como
 * lo aplica la cascada al total: la parte del tercero no se descuenta —el tercero cobra
 * lo suyo—, así que el descuento sale del ingreso propio.
 */
export function liquidarIva(
  lineas: readonly LineaParaIva[],
  opciones: { tarifaPct: number; descuentoComercialPct?: number | null },
): LiquidacionIva {
  const tarifa = Math.max(0, Number(opciones.tarifaPct) || 0)
  const desc = Math.min(100, Math.max(0, Number(opciones.descuentoComercialPct) || 0))
  const factor = 1 - desc / 100

  const resultado: IvaDeLinea[] = []
  for (const l of lineas) {
    const base: BaseIvaLinea = l.baseDeclarada ?? (l.esDeLaAgencia ? 'valor_completo' : 'ingreso_propio')
    const precio = (Number(l.precio) || 0) * factor
    const costo = Math.max(0, Number(l.costoTerceros) || 0)
    const precioAdic = (Number(l.precioAdicionales) || 0) * factor
    const costoAdic = Math.max(0, Number(l.costoAdicionales) || 0)

    let gravableBase = 0
    let gravableAdic = 0
    let sinCosto = false
    if (base === 'valor_completo') {
      gravableBase = Math.max(0, precio)
      gravableAdic = Math.max(0, precioAdic)
    } else if (base === 'ingreso_propio') {
      // Con precio y sin costo no hay ingreso propio que separar. No se inventa: se marca.
      sinCosto = precio > 0 && costo <= 0 && !l.esDeLaAgencia
      gravableBase = sinCosto ? 0 : Math.max(0, precio - costo)
      gravableAdic = Math.max(0, precioAdic - costoAdic)
    }
    // `sin_iva`: todo en cero. La línea comisionable no le cobra IVA al viajero.

    const ivaBase = redondear((gravableBase * tarifa) / 100)
    const ivaAdicionales = redondear((gravableAdic * tarifa) / 100)
    resultado.push({
      id: l.id,
      nombre: l.nombre,
      base,
      baseGravable: redondear(gravableBase + gravableAdic),
      ivaBase,
      ivaAdicionales,
      iva: ivaBase + ivaAdicionales,
      sinCosto,
    })
  }

  const sinCosto = resultado.filter(l => l.sinCosto).map(l => (l.nombre ?? '').trim() || 'Línea sin nombre')
  return {
    lineas: resultado,
    baseGravable: resultado.reduce((a, l) => a + l.baseGravable, 0),
    iva: resultado.reduce((a, l) => a + l.iva, 0),
    sinCosto,
    calculable: sinCosto.length === 0,
    tarifaPct: tarifa,
  }
}

/** Lo mínimo de la cascada por línea. `LineaCalculada` lo cumple. */
export interface LineaDeCascada {
  id?: string
  precioLinea: number
  costoLinea: number
  precioAdicionales: number
  costoAdicionales: number
}

/** Lo mínimo del ítem: nombre, su base declarada y si es plata de la agencia. */
export interface MetaDeLineaParaIva {
  nombre: string | null
  baseIva?: BaseIvaLinea | null
  esDeLaAgencia?: boolean
}

/**
 * Las líneas de una cascada, listas para liquidar.
 *
 * Es el único puente entre la cascada y el IVA: el costo del tercero NO se recalcula aquí,
 * sale de la cascada (`costoLinea`), la misma cuenta que usa el margen.
 */
export function lineasParaIva(
  lineas: readonly LineaDeCascada[],
  metaDe: (id: string) => MetaDeLineaParaIva | undefined,
): LineaParaIva[] {
  return lineas
    .filter((l): l is LineaDeCascada & { id: string } => typeof l.id === 'string')
    .map(l => {
      const meta = metaDe(l.id)
      return {
        id: l.id,
        nombre: meta?.nombre ?? null,
        precio: l.precioLinea,
        costoTerceros: l.costoLinea,
        precioAdicionales: l.precioAdicionales,
        costoAdicionales: l.costoAdicionales,
        baseDeclarada: meta?.baseIva ?? null,
        esDeLaAgencia: meta?.esDeLaAgencia === true,
      }
    })
}

// ── El resultado fiscal con la base nueva ────────────────────────────────────

/**
 * El resultado fiscal de la cotización con el IVA sobre el ingreso propio.
 *
 * Misma forma que `calcularFiscal` (lo que ya reciben el PDF y el servicio externo). Las
 * retenciones van sobre la MISMA base que el IVA (Felipe, punto 5): un cliente empresa
 * retiene sobre la remuneración de la agencia, no sobre lo recibido para terceros.
 */
export function fiscalSobreIngresoPropio(args: {
  subtotal: number
  liquidacion: LiquidacionIva
  /** Sin perfil fiscal no hay retenciones que calcular (y la tarifa ya llegó en 0). */
  perfil: FiscalProfile | null
  cliente: Client
}): FiscalResult {
  const { subtotal, liquidacion, perfil, cliente } = args
  const iva = liquidacion.iva
  const ret = perfil
    ? calcularRetenciones(perfil, cliente, liquidacion.baseGravable, iva)
    : { retefuente_pct: 0, retefuente_valor: 0, reteica_pct: 0, reteica_valor: 0, reteiva_pct: 0, reteiva_valor: 0, total_retenciones: 0 }
  const totalBruto = subtotal + iva
  return {
    subtotal,
    iva,
    ivaRate: iva > 0 ? liquidacion.tarifaPct / 100 : 0,
    reteFuente: ret.retefuente_valor,
    reteFuenteRate: ret.retefuente_pct / 100,
    reteICA: ret.reteica_valor,
    reteICARate: ret.reteica_pct / 100,
    reteIVA: ret.reteiva_valor,
    reteIVARate: ret.reteiva_pct > 0 ? ret.reteiva_pct / 100 : 0,
    totalBruto,
    totalRetenciones: ret.total_retenciones,
    teQueda: totalBruto - ret.total_retenciones,
    aplica: {
      iva: iva > 0,
      reteFuente: ret.retefuente_valor > 0,
      reteICA: ret.reteica_valor > 0,
      reteIVA: ret.reteiva_valor > 0,
    },
  }
}

/**
 * El cliente de la cotización, en la forma que piden las retenciones.
 *
 * `empresas` guarda el vocabulario viejo (`natural`/`juridica`, `simplificado`); el motor
 * fiscal lee el de `fiscal_profiles`. Es la misma traducción que hace `calcularFiscal`
 * adentro, escrita aquí porque aquella no se exporta.
 */
export function clienteParaRetenciones(empresa: {
  tipo_persona?: string | null
  regimen_tributario?: string | null
  agente_retenedor?: boolean | null
  gran_contribuyente?: boolean | null
}): Client {
  const tipo = empresa.tipo_persona ?? 'juridica'
  const regimen = empresa.regimen_tributario ?? ''
  return {
    person_type: tipo === 'natural' || tipo === 'persona_natural' ? 'persona_natural' : 'persona_juridica',
    tax_regime: regimen === 'simplificado' || regimen === 'simple' ? 'simple' : 'ordinario',
    agente_retenedor: empresa.agente_retenedor ?? false,
    gran_contribuyente: empresa.gran_contribuyente ?? false,
  } as unknown as Client
}

/** La frase del documento. Una sola, para que el PDF y la prueba digan lo mismo. */
export function textoIvaIncluido(iva: number, formato: (n: number) => string): string {
  return `Incluye IVA de ${formato(iva)} sobre la tarifa de servicio de la agencia.`
}

/** Cómo se le dice a una persona cada base de una línea. */
export const ETIQUETA_BASE_IVA: Record<BaseIvaLinea, string> = {
  ingreso_propio: 'A nombre de un tercero: IVA sobre lo que queda a la agencia',
  valor_completo: 'Servicio propio: IVA sobre el precio entero',
  sin_iva: 'Comisionable: sin IVA al viajero',
}

/** Lo que dice el editor en una línea sin costo. */
export const TEXTO_IVA_SIN_CALCULAR = 'IVA sin calcular: falta el costo'

/** Por qué el PDF sale como borrador o aprobar se rechaza. */
export function motivoIvaSinCalcular(sinCosto: readonly string[]): string {
  const nombres = sinCosto.map(n => `«${n}»`).join(', ')
  return sinCosto.length === 1
    ? `La línea ${nombres} tiene precio y no tiene costo: su IVA no se puede calcular. Carga el costo o márcala como servicio propio.`
    : `Las líneas ${nombres} tienen precio y no tienen costo: su IVA no se puede calcular. Carga el costo o márcalas como servicio propio.`
}
