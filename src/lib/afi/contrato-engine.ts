// Motor de armado del contrato AFI ↔ Cliente
// Toma productos contratados + datos del cliente + pricing y compone el DOCX
// usando la plantilla maestra CT-AFI-CLIENTE-MASTER.docx con section tags.
//
// Pricing v1 hardcoded — Lucia propuso valores en pricing-propuesto.md.
// Mauricio aprueba/ajusta. Posteriormente migrar a config_extra del workspace.

import PizZip from 'pizzip'
import Docxtemplater from 'docxtemplater'
import type { ProductosContratados, SarlaftRegimen } from './template-mapping'

export interface ClienteData {
  empresa_nombre: string
  empresa_nit: string
  rep_legal_nombre: string
  rep_legal_cc: string
  ciudad_firma?: string
}

export interface PricingConfig {
  diseno: {
    sarlaft_amp: number
    sarlaft_simp: number
    ptee: number
  }
  mensual: {
    oficial_solo: number
    seguimiento_solo: number
    oficial_y_seguimiento: number
  }
}

// Pricing propuesto por Lucia 2026-04-27 — pendiente aprobacion final Mauricio + Carmen
export const DEFAULT_PRICING: PricingConfig = {
  diseno: {
    sarlaft_amp: 2_000_000,
    sarlaft_simp: 700_000,
    ptee: 400_000,
  },
  mensual: {
    oficial_solo: 300_000,
    seguimiento_solo: 250_000,
    oficial_y_seguimiento: 400_000,
  },
}

function fmtCop(n: number): string {
  return new Intl.NumberFormat('es-CO').format(n)
}

const NUMEROS_LETRAS_MILLONES: Record<number, string> = {
  100_000: 'CIEN MIL',
  150_000: 'CIENTO CINCUENTA MIL',
  200_000: 'DOSCIENTOS MIL',
  250_000: 'DOSCIENTOS CINCUENTA MIL',
  300_000: 'TRESCIENTOS MIL',
  350_000: 'TRESCIENTOS CINCUENTA MIL',
  400_000: 'CUATROCIENTOS MIL',
  450_000: 'CUATROCIENTOS CINCUENTA MIL',
  500_000: 'QUINIENTOS MIL',
  550_000: 'QUINIENTOS CINCUENTA MIL',
  600_000: 'SEISCIENTOS MIL',
  650_000: 'SEISCIENTOS CINCUENTA MIL',
  700_000: 'SETECIENTOS MIL',
  750_000: 'SETECIENTOS CINCUENTA MIL',
  800_000: 'OCHOCIENTOS MIL',
  900_000: 'NOVECIENTOS MIL',
  1_000_000: 'UN MILLÓN',
  1_200_000: 'UN MILLÓN DOSCIENTOS MIL',
  1_500_000: 'UN MILLÓN QUINIENTOS MIL',
  2_000_000: 'DOS MILLONES',
  2_500_000: 'DOS MILLONES QUINIENTOS MIL',
  3_000_000: 'TRES MILLONES',
  4_000_000: 'CUATRO MILLONES',
  5_000_000: 'CINCO MILLONES',
}

function numeroALetras(n: number): string {
  if (NUMEROS_LETRAS_MILLONES[n]) return NUMEROS_LETRAS_MILLONES[n]
  // Fallback: convertir crudamente con miles/millones
  const millones = Math.floor(n / 1_000_000)
  const resto = n % 1_000_000
  const milesResto = Math.floor(resto / 1000)
  const partes: string[] = []
  if (millones > 0) partes.push(`${millones} MILLONES`.replace('1 MILLONES', 'UN MILLÓN'))
  if (milesResto > 0) partes.push(`${fmtCop(milesResto)} MIL`)
  return partes.join(' ').toUpperCase() || `${fmtCop(n)} PESOS`
}

const MESES_ES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']

function buildContext(productos: ProductosContratados, cliente: ClienteData, pricing: PricingConfig) {
  const regimen: SarlaftRegimen = productos.sarlaft_regimen
    ?? (productos.sarlaft_ampliado ? 'ampliado' : productos.sarlaft_simplificado ? 'simplificado' : 'ninguno')

  const SARLAFT_AMP = regimen === 'ampliado'
  const SARLAFT_SIMP = regimen === 'simplificado'
  const PTEE = !!productos.ptee
  const OFICIAL = !!productos.oficial
  const SEGUIMIENTO = !!productos.seguimiento

  const IMPLEMENTACION_HAY = SARLAFT_AMP || SARLAFT_SIMP || PTEE
  const MENSUAL_HAY = OFICIAL || SEGUIMIENTO
  const SOLO_IMPLEMENTACION = IMPLEMENTACION_HAY && !MENSUAL_HAY
  const COMBO_OFI_SEG = OFICIAL && SEGUIMIENTO
  const OFICIAL_SOLO = OFICIAL && !SEGUIMIENTO
  const SEG_SOLO = SEGUIMIENTO && !OFICIAL
  const NOTA_460_7 = SARLAFT_SIMP
  const SEGUIMIENTO_PTEE = SEGUIMIENTO && PTEE

  // Titulo del contrato
  const tituloPartes: string[] = []
  if (SARLAFT_AMP) tituloPartes.push('IMPLEMENTACIÓN SARLAFT RÉGIMEN AMPLIADO')
  if (SARLAFT_SIMP) tituloPartes.push('IMPLEMENTACIÓN SARLAFT RÉGIMEN SIMPLIFICADO')
  if (PTEE) tituloPartes.push('PTEE')
  if (OFICIAL) tituloPartes.push('OFICIAL DE CUMPLIMIENTO EXTERNO')
  if (SEGUIMIENTO) tituloPartes.push('SEGUIMIENTO Y ACOMPAÑAMIENTO')
  const TITULO_CONTRATO = tituloPartes.join(' — ') || 'SERVICIOS PROFESIONALES DE CUMPLIMIENTO'

  // Valores
  const valorDisenoSarlaftAmp = pricing.diseno.sarlaft_amp
  const valorDisenoSarlaftSimp = pricing.diseno.sarlaft_simp
  const valorDisenoPtee = pricing.diseno.ptee
  const valorMensualOficial = pricing.mensual.oficial_solo
  const valorMensualSeguimiento = pricing.mensual.seguimiento_solo
  const valorMensualOficialYSeg = pricing.mensual.oficial_y_seguimiento

  let valorTotalDiseno = 0
  if (SARLAFT_AMP) valorTotalDiseno += valorDisenoSarlaftAmp
  if (SARLAFT_SIMP) valorTotalDiseno += valorDisenoSarlaftSimp
  if (PTEE) valorTotalDiseno += valorDisenoPtee

  // Fecha firma — hoy (contrato se firma al generarse)
  const hoy = new Date()
  const FECHA_FIRMA_DIA = String(hoy.getDate()).padStart(2, '0')
  const FECHA_FIRMA_MES = MESES_ES[hoy.getMonth()]
  const FECHA_FIRMA_ANIO = String(hoy.getFullYear())

  return {
    // Flags condicionales
    SARLAFT_AMP, SARLAFT_SIMP, PTEE, OFICIAL, SEGUIMIENTO,
    IMPLEMENTACION_HAY, MENSUAL_HAY, SOLO_IMPLEMENTACION,
    COMBO_OFI_SEG, OFICIAL_SOLO, SEG_SOLO, NOTA_460_7, SEGUIMIENTO_PTEE,
    // Cliente
    EMPRESA_NOMBRE: cliente.empresa_nombre,
    EMPRESA_NIT: cliente.empresa_nit,
    REP_LEGAL_NOMBRE: cliente.rep_legal_nombre,
    REP_LEGAL_CC: cliente.rep_legal_cc,
    CIUDAD_FIRMA: cliente.ciudad_firma || 'Bogotá D.C.',
    FECHA_FIRMA_DIA, FECHA_FIRMA_MES, FECHA_FIRMA_ANIO,
    // Titulo
    TITULO_CONTRATO,
    // Valores
    VALOR_DISENO_SARLAFT_AMP: numeroALetras(valorDisenoSarlaftAmp),
    VALOR_DISENO_SARLAFT_AMP_NUM: `$${fmtCop(valorDisenoSarlaftAmp)}`,
    VALOR_DISENO_SARLAFT_SIMP: numeroALetras(valorDisenoSarlaftSimp),
    VALOR_DISENO_SARLAFT_SIMP_NUM: `$${fmtCop(valorDisenoSarlaftSimp)}`,
    VALOR_DISENO_PTEE: numeroALetras(valorDisenoPtee),
    VALOR_DISENO_PTEE_NUM: `$${fmtCop(valorDisenoPtee)}`,
    VALOR_TOTAL_DISENO: numeroALetras(valorTotalDiseno),
    VALOR_TOTAL_DISENO_NUM: `$${fmtCop(valorTotalDiseno)}`,
    VALOR_MENSUAL_OFICIAL: numeroALetras(valorMensualOficial),
    VALOR_MENSUAL_OFICIAL_NUM: `$${fmtCop(valorMensualOficial)}`,
    VALOR_MENSUAL_SEGUIMIENTO: numeroALetras(valorMensualSeguimiento),
    VALOR_MENSUAL_SEGUIMIENTO_NUM: `$${fmtCop(valorMensualSeguimiento)}`,
    VALOR_MENSUAL_OFICIAL_Y_SEGUIMIENTO: numeroALetras(valorMensualOficialYSeg),
    VALOR_MENSUAL_OFICIAL_Y_SEGUIMIENTO_NUM: `$${fmtCop(valorMensualOficialYSeg)}`,
  }
}

export interface GenerarContratoParams {
  templateBuffer: ArrayBuffer
  productos: ProductosContratados
  cliente: ClienteData
  pricing?: PricingConfig
}

export function generarContratoDocx(params: GenerarContratoParams): Buffer {
  const { templateBuffer, productos, cliente, pricing = DEFAULT_PRICING } = params
  const zip = new PizZip(Buffer.from(templateBuffer))

  const doc = new Docxtemplater(zip, {
    delimiters: { start: '{{', end: '}}' },
    paragraphLoop: true,
    linebreaks: true,
    nullGetter: () => '',
  })

  const ctx = buildContext(productos, cliente, pricing)
  doc.render(ctx)
  return doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' })
}
