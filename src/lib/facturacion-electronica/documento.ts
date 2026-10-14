/**
 * El contenido de la factura electrónica de un cobro y de su nota crédito, en el formato de Muisca.
 * Puro: sin red ni base.
 *
 * Reglas fiscales (Felipe, `proyectos/metrik/valida/docs/crecimiento-mrr/29-felipe-iva-suscripcion.md`):
 *   · el servicio está EXCLUIDO de IVA (art. 476 num. 21 ET): la línea no lleva impuesto y la nota
 *     de la factura lo dice;
 *   · el ítem se llama «Servicio de computación en la nube (SaaS) – acceso a Valida», NUNCA
 *     «licencia» (el Concepto DIAN 017056 deja por fuera el licenciamiento): `armarFactura` lanza si
 *     el texto que ve la DIAN la menciona;
 *   · una factura por cada cobro aprobado, el mismo día (Res. DIAN 165/2023, art. 5).
 *
 * Campos y catálogos, contra la doc de Muisca (leída el 2026-10-14):
 *   · `code` '01' factura de venta, `typeOperation` '10' estándar
 *     (https://doc.muisca.io/factura-electr%C3%B3nica-de-venta-2370906m0.md);
 *   · nota crédito: `code` '91', `typeOperation` '20' (referencia una factura), `conceptCode` 1-6
 *     (https://doc.muisca.io/notas-cr%C3%A9dito-y-d%C3%A9bito-de-factura-electr%C3%B3nica-de-venta-2370914m0.md);
 *   · cliente: `personType` '1' jurídica / '2' natural, `regimeType` '48' / '49', tipo de
 *     identificación '31' NIT / '13' cédula (listas de valores de la doc);
 *   · `unitMeasurementCode` '94' unidad; `standardType` '999' (código propio del contribuyente);
 *   · `paymentMeanCode` '48' tarjeta crédito, '1' instrumento no definido (lista «Medios de pagos»).
 *
 * Asumido y sin verificar contra una cuenta real (va en el reporte):
 *   · que un ítem excluido se manda SIN `taxes` (la doc no muestra un ejemplo excluido);
 *   · `responsibilities` como texto (el esquema dice string; la guía muestra un arreglo);
 *   · `firstName` / `lastName` para una persona jurídica (el esquema los pide siempre): se manda la
 *     razón social y un punto.
 */

import { calcularDvNit } from '@/lib/dian/nit'
import type { ModoMuisca } from './config'
import type { ResolucionMuisca } from './muisca'

// ── El concepto ──────────────────────────────────────────────────────────────────────────────

export interface ConceptoFacturable {
  /** Código interno del ítem (`lines[].code`). */
  codigo: string
  /** El nombre del ítem, tal cual lo ve la DIAN. */
  nombre: string
  /** La nota fiscal que va en la factura. */
  notaFiscal: string
}

/** Valida: texto de Mauricio (2026-10-14) y Felipe §3.1. */
export const CONCEPTO_VALIDA: ConceptoFacturable = {
  codigo: 'VALIDA-SAAS',
  nombre: 'Servicio de computación en la nube (SaaS) – acceso a Valida',
  notaFiscal: 'Excluido de IVA, art. 476 num. 21 ET.',
}

/**
 * El concepto según el módulo del servicio contratado (`catalogo_servicios.modulo`). Un módulo sin
 * concepto aquí no se factura solo. Para sumar otro producto de ONE: su concepto aprobado por
 * Felipe, una línea aquí y el alcance en `decidirFacturable`.
 */
const CONCEPTO_POR_MODULO: Readonly<Record<string, ConceptoFacturable>> = {
  valida_consulta: CONCEPTO_VALIDA,
}

function conceptoDelModulo(modulo: string | null | undefined): ConceptoFacturable | null {
  return modulo ? (CONCEPTO_POR_MODULO[modulo] ?? null) : null
}

const RE_LICENCIA = /licenc/i

// ── El comprador ─────────────────────────────────────────────────────────────────────────────

/** Lo que ONE sabe de la empresa que paga (`empresas` del cobrador). */
export interface EmpresaCompradora {
  razon_social: string | null
  nombre: string | null
  tipo_documento: string | null
  numero_documento: string | null
  tipo_persona: string | null
  regimen_tributario: string | null
  responsable_iva: boolean | null
  gran_contribuyente: boolean | null
  autorretenedor: boolean | null
  agente_retenedor: boolean | null
  telefono?: string | null
}

export interface Comprador {
  razonSocial: string
  identificacion: string
  dv: string
  tipoIdentificacion: '31' | '13'
  tipoPersona: '1' | '2'
  regimen: '48' | '49'
  responsabilidades: string
  responsableDe: '01' | 'ZZ'
  correo: string
  telefono: string | null
}

export type LecturaComprador = { ok: true; comprador: Comprador } | { ok: false; problema: string }

const RE_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * El comprador, de la empresa y del correo de facturación del contrato (en la cuenta
 * autogestionada, el correo que se verificó con el código al registrarse).
 *
 * El NIT: con guion, lo de después es el DV y TIENE que cuadrar con el cálculo; sin guion, todo es
 * la base y el DV se calcula. Nunca se parte un número sin separador (el último dígito puede ser
 * parte del NIT): ver `src/lib/dian/nit.ts`.
 */
export function leerComprador(e: EmpresaCompradora, correo: string | null | undefined): LecturaComprador {
  const razonSocial = (e.razon_social ?? e.nombre ?? '').trim()
  if (!razonSocial) return { ok: false, problema: 'La empresa no tiene razón social.' }
  const crudo = (e.numero_documento ?? '').trim()
  if (!crudo) return { ok: false, problema: 'La empresa no tiene NIT.' }
  const partes = crudo.split('-')
  if (partes.length > 2) return { ok: false, problema: `El NIT «${crudo}» tiene más de un guion.` }
  const base = partes[0].replace(/\D/g, '')
  if (base.length < 5) return { ok: false, problema: `El NIT «${crudo}» no es un número de identificación.` }
  const calculado = calcularDvNit(base)
  if (!calculado) return { ok: false, problema: `No se pudo calcular el DV de «${crudo}».` }
  if (partes.length === 2) {
    const dv = partes[1].replace(/\D/g, '')
    if (dv !== calculado) {
      return { ok: false, problema: `El DV de «${crudo}» no cuadra: con ${base} el DV es ${calculado}.` }
    }
  }
  const mail = (correo ?? '').trim().toLowerCase()
  if (!RE_CORREO.test(mail)) return { ok: false, problema: 'El contrato no tiene un correo de facturación válido.' }

  const natural = e.tipo_persona === 'natural'
  const cedula = /^(cc|cedula|cédula|13)$/i.test((e.tipo_documento ?? '').trim())
  const responsableIva = e.responsable_iva === true || e.regimen_tributario === 'comun' || e.regimen_tributario === 'simple'
  const responsabilidades = [
    e.gran_contribuyente ? 'O-13' : null,
    e.autorretenedor ? 'O-15' : null,
    e.agente_retenedor ? 'O-23' : null,
    e.regimen_tributario === 'simple' ? 'O-47' : null,
  ].filter((x): x is string => x !== null)

  return {
    ok: true,
    comprador: {
      razonSocial,
      identificacion: base,
      dv: calculado,
      tipoIdentificacion: natural && cedula ? '13' : '31',
      tipoPersona: natural ? '2' : '1',
      regimen: responsableIva ? '48' : '49',
      // Sin datos del RUT, «No aplica - Otros» (R-99-PN): es lo que acepta la DIAN para el adquirente.
      responsabilidades: responsabilidades.length > 0 ? responsabilidades.join(';') : 'R-99-PN',
      responsableDe: responsableIva ? '01' : 'ZZ',
      correo: mail,
      telefono: e.telefono?.replace(/[^\d+]/g, '') || null,
    },
  }
}

// ── La factura ───────────────────────────────────────────────────────────────────────────────

export interface DatosFactura {
  modo: ModoMuisca
  testSetId: string | null
  prefijo: string
  consecutivo: number
  resolucion: ResolucionMuisca
  comprador: Comprador
  concepto: ConceptoFacturable
  /** Pesos, entero, mayor que cero: lo que entró por el cobro. */
  monto: number
  /** 'YYYY-MM-DD' del pago. */
  fechaPago: string
  /** 'YYYY-MM-DD' de hoy en Bogotá: la factura es de contado. */
  hoy: string
  /** El periodo que paga, si se conoce. */
  periodo: { desde: string; hasta: string } | null
  /** Tarjeta (cobro con token) o un medio que ONE no distingue (enlace de pago). */
  medioPago: 'tarjeta_credito' | 'no_definido'
  /** La referencia del pago en la pasarela, para conciliar. */
  referenciaPago: string | null
  /** El id del cobro en ONE: va como orden de compra. */
  cobroId: string
}

const ddmmaaaa = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`

function textoPeriodo(p: { desde: string; hasta: string } | null): string | null {
  return p ? `Período ${ddmmaaaa(p.desde)}–${ddmmaaaa(p.hasta)}` : null
}

function cliente(c: Comprador) {
  const juridica = c.tipoPersona === '1'
  return {
    companyName: c.razonSocial,
    personType: c.tipoPersona,
    regimeType: c.regimen,
    firstName: juridica ? c.razonSocial : c.razonSocial.split(/\s+/).slice(0, -1).join(' ') || c.razonSocial,
    lastName: juridica ? '.' : c.razonSocial.split(/\s+/).slice(-1)[0],
    identification: c.identificacion,
    digitCheck: c.dv,
    identificationTypeCode: c.tipoIdentificacion,
    email: c.correo,
    ...(c.telefono ? { phone: c.telefono } : {}),
    responsibleFor: c.responsableDe,
    responsibilities: c.responsabilidades,
  }
}

function lineaYTotales(concepto: ConceptoFacturable, monto: number, periodo: DatosFactura['periodo']) {
  const descripcion = [textoPeriodo(periodo), concepto.notaFiscal].filter(Boolean).join('. ').replace(/\.\./g, '.')
  return {
    lines: [
      {
        code: concepto.codigo,
        name: concepto.nombre,
        description: descripcion,
        unitMeasurementCode: '94',
        unitMeasurementName: 'Unidad',
        standardType: '999',
        standardCode: concepto.codigo,
        price: monto,
        quantity: 1,
        // Excluido de IVA: sin impuesto en la línea.
      },
    ],
    totals: {
      amount: monto,
      prepaymentAmount: 0,
      taxesAmount: 0,
      withholdingAmount: 0,
      discountsAmount: 0,
      chargesAmount: 0,
    },
  }
}

function validarComun(concepto: ConceptoFacturable, monto: number, modo: ModoMuisca, testSetId: string | null) {
  if (RE_LICENCIA.test(concepto.nombre) || RE_LICENCIA.test(concepto.notaFiscal)) {
    throw new Error('El ítem de la factura no puede decir «licencia» (Felipe §3.1).')
  }
  if (!Number.isInteger(monto) || monto <= 0) throw new Error(`Monto de factura inválido: ${monto}.`)
  if (modo === 'Habilitation' && !testSetId) throw new Error('Habilitation exige testSetId.')
}

export function armarFactura(d: DatosFactura): Record<string, unknown> {
  validarComun(d.concepto, d.monto, d.modo, d.testSetId)
  if (d.prefijo !== d.resolucion.prefix) {
    throw new Error(`El prefijo ${d.prefijo} no es el de la resolución (${d.resolucion.prefix}).`)
  }
  if (d.consecutivo < d.resolucion.rangeInitial || d.consecutivo > d.resolucion.rangeFinal) {
    throw new Error(`El consecutivo ${d.consecutivo} está fuera del rango ${d.resolucion.rangeInitial}–${d.resolucion.rangeFinal}.`)
  }
  const notas = [
    `${d.concepto.notaFiscal.replace(/\.$/, '')}.`,
    `Pagado el ${ddmmaaaa(d.fechaPago)}${d.referenciaPago ? ` (referencia ${d.referenciaPago})` : ''}.`,
  ]
  return {
    code: '01',
    typeOperation: '10',
    mode: d.modo,
    ...(d.modo === 'Habilitation' ? { testSetId: d.testSetId } : {}),
    prefix: d.prefijo,
    consecutive: d.consecutivo,
    orderReference: d.cobroId,
    currencyCode: 'COP',
    dueAt: d.hoy,
    ...(d.periodo ? { periodStartDate: d.periodo.desde, periodEndDate: d.periodo.hasta } : {}),
    termDay: 0,
    paymentMeanCode: d.medioPago === 'tarjeta_credito' ? '48' : '1',
    resolution: d.resolucion,
    customer: cliente(d.comprador),
    ...lineaYTotales(d.concepto, d.monto, d.periodo),
    notes: notas,
  }
}

// ── La nota crédito ──────────────────────────────────────────────────────────────────────────

/** Conceptos de corrección de una nota crédito (lista de la doc). */
export type ConceptoNotaCredito = '1' | '2' | '3' | '4' | '5' | '6'

export interface FacturaReferida {
  prefijo: string
  consecutivo: number
  numero: string
  cufe: string
  /** 'YYYY-MM-DD'. */
  fechaEmision: string
}

export interface DatosNotaCredito extends Omit<DatosFactura, 'resolucion' | 'periodo' | 'fechaPago' | 'referenciaPago'> {
  /** La resolución de la FACTURA referida: la doc la pide también en la nota. */
  resolucion: ResolucionMuisca
  factura: FacturaReferida
  conceptoNota: ConceptoNotaCredito
  motivo: string
}

export function armarNotaCredito(d: DatosNotaCredito): Record<string, unknown> {
  validarComun(d.concepto, d.monto, d.modo, d.testSetId)
  if (!/^[0-9a-f]{96}$/.test(d.factura.cufe)) throw new Error('La factura referida no tiene un CUFE válido.')
  const motivo = d.motivo.trim()
  if (!motivo) throw new Error('La nota crédito necesita un motivo.')
  return {
    code: '91',
    typeOperation: '20',
    mode: d.modo,
    ...(d.modo === 'Habilitation' ? { testSetId: d.testSetId } : {}),
    prefix: d.prefijo,
    consecutive: d.consecutivo,
    orderReference: d.cobroId,
    currencyCode: 'COP',
    issuedAt: d.hoy,
    dueAt: d.hoy,
    termDay: 0,
    paymentMeanCode: d.medioPago === 'tarjeta_credito' ? '48' : '1',
    resolution: d.resolucion,
    customer: cliente(d.comprador),
    ...lineaYTotales(d.concepto, d.monto, null),
    conceptCode: d.conceptoNota,
    invoicePrefix: d.factura.prefijo,
    invoiceConsecutive: d.factura.consecutivo,
    invoiceCuv: d.factura.cufe,
    invoiceIssuedAt: d.factura.fechaEmision,
    invoiceSequence: d.factura.numero,
    notes: [motivo.slice(0, 500)],
  }
}

// ── ¿Este cobro se factura solo? ─────────────────────────────────────────────────────────────

export interface ContextoCobro {
  cobroId: string
  workspaceId: string
  monto: number
  /** 'YYYY-MM-DD' del pago; null = no está pagado. */
  fecha: string | null
  anulado: boolean
  modulo: string | null
  /** `negocios.metadata.origen` del negocio del cobro. */
  origenNegocio: string | null
  tieneContrato: boolean
  /** Ya hay una factura cargada a mano (`facturas_cobro` o `facturas_cuota`). */
  yaFacturadoAMano: boolean
}

export type Decision = { facturable: true; concepto: ConceptoFacturable } | { facturable: false; motivo: string }

/**
 * ALCANCE de hoy: solo las cuentas de Valida AUTOGESTIONADA (`negocios.metadata.origen =
 * 'valida_autogestion'`, lo escribe `valida_activar_autogestion`). Los 4 CDA comparten la ficha
 * (`valida-cda-licencia`) pero se facturan a mano por cuota (`facturas_cuota`): no entran. Para abrir
 * otro producto: su concepto en `CONCEPTO_POR_MODULO` y su origen en `ORIGENES_AUTOMATICOS`.
 */
export const ORIGENES_AUTOMATICOS: readonly string[] = ['valida_autogestion']

export function decidirFacturable(c: ContextoCobro, emisorWorkspaceId: string, desde: string | null): Decision {
  if (c.workspaceId !== emisorWorkspaceId) return { facturable: false, motivo: 'El cobro es de otro espacio cobrador.' }
  if (c.anulado) return { facturable: false, motivo: 'El cobro está anulado.' }
  if (!c.fecha) return { facturable: false, motivo: 'El cobro no está pagado.' }
  if (desde && c.fecha < desde) return { facturable: false, motivo: `Pagado antes de ${desde}: se facturó por fuera.` }
  if (!(c.monto > 0)) return { facturable: false, motivo: 'El cobro no tiene monto.' }
  if (!c.tieneContrato) return { facturable: false, motivo: 'El cobro no es de un servicio contratado.' }
  const concepto = conceptoDelModulo(c.modulo)
  if (!concepto) return { facturable: false, motivo: `El módulo ${c.modulo ?? '(ninguno)'} no tiene concepto de factura.` }
  if (!c.origenNegocio || !ORIGENES_AUTOMATICOS.includes(c.origenNegocio)) {
    return { facturable: false, motivo: 'Fuera del alcance automático: se factura a mano.' }
  }
  if (c.yaFacturadoAMano) return { facturable: false, motivo: 'Ya tiene una factura cargada a mano.' }
  return { facturable: true, concepto }
}
