import { describe, expect, it } from 'vitest'
import {
  armarFactura,
  armarNotaCredito,
  CONCEPTO_VALIDA,
  decidirFacturable,
  leerComprador,
  type Comprador,
  type ContextoCobro,
  type DatosFactura,
  type EmpresaCompradora,
} from './documento'

const RESOLUCION = {
  key: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
  prefix: 'SETP',
  number: 18760000001,
  rangeInitial: 990000000,
  rangeFinal: 995000000,
  validFrom: '2019-01-19',
  validUntil: '2030-01-19',
}

const EMPRESA: EmpresaCompradora = {
  razon_social: 'Transportes La Ruta S.A.S.',
  nombre: 'La Ruta',
  tipo_documento: 'NIT',
  // NIT de prueba con su DV correcto (900156521 → 0).
  numero_documento: '900156521-0',
  tipo_persona: 'juridica',
  regimen_tributario: null,
  responsable_iva: null,
  gran_contribuyente: null,
  autorretenedor: null,
  agente_retenedor: null,
}

function comprador(): Comprador {
  const r = leerComprador(EMPRESA, 'Pagos@LaRuta.co')
  if (!r.ok) throw new Error(r.problema)
  return r.comprador
}

function datos(extra: Partial<DatosFactura> = {}): DatosFactura {
  return {
    modo: 'Habilitation',
    testSetId: '2f1c9f76-7a37-4d93-9e79-2fbe7b7a7b1a',
    prefijo: 'SETP',
    consecutivo: 990000001,
    resolucion: RESOLUCION,
    comprador: comprador(),
    concepto: CONCEPTO_VALIDA,
    monto: 150000,
    fechaPago: '2026-10-20',
    hoy: '2026-10-20',
    periodo: { desde: '2026-10-20', hasta: '2026-11-19' },
    medioPago: 'no_definido',
    referenciaPago: 'epayco:123',
    cobroId: '0f8e2f4a-1c2b-4d5e-9f00-112233445566',
    ...extra,
  }
}

describe('leerComprador', () => {
  it('NIT con guion: base y DV verificados; correo en minúscula; jurídica sin datos de RUT', () => {
    expect(comprador()).toEqual({
      razonSocial: 'Transportes La Ruta S.A.S.',
      identificacion: '900156521',
      dv: '0',
      tipoIdentificacion: '31',
      tipoPersona: '1',
      regimen: '49',
      responsabilidades: 'R-99-PN',
      responsableDe: 'ZZ',
      correo: 'pagos@laruta.co',
      telefono: null,
    })
  })

  it('NIT sin guion: todo es la base y el DV se calcula (no se parte el número)', () => {
    const r = leerComprador({ ...EMPRESA, numero_documento: '900156521' }, 'a@b.co')
    expect(r).toMatchObject({ ok: true, comprador: { identificacion: '900156521', dv: '0' } })
  })

  it('un DV que no cuadra no se factura', () => {
    const r = leerComprador({ ...EMPRESA, numero_documento: '900156521-7' }, 'a@b.co')
    expect(r).toMatchObject({ ok: false })
  })

  it('sin correo válido, sin NIT o sin razón social no se factura', () => {
    expect(leerComprador(EMPRESA, null).ok).toBe(false)
    expect(leerComprador(EMPRESA, 'no-es-correo').ok).toBe(false)
    expect(leerComprador({ ...EMPRESA, numero_documento: null }, 'a@b.co').ok).toBe(false)
    expect(leerComprador({ ...EMPRESA, razon_social: null, nombre: ' ' }, 'a@b.co').ok).toBe(false)
  })

  it('responsable de IVA y responsabilidades del RUT, separadas por punto y coma', () => {
    const r = leerComprador({ ...EMPRESA, responsable_iva: true, gran_contribuyente: true, agente_retenedor: true }, 'a@b.co')
    expect(r).toMatchObject({ ok: true, comprador: { regimen: '48', responsableDe: '01', responsabilidades: 'O-13;O-23' } })
  })
})

describe('armarFactura', () => {
  it('factura de venta estándar, excluida de IVA, con el concepto exacto', () => {
    const f = armarFactura(datos())
    expect(f).toMatchObject({
      code: '01',
      typeOperation: '10',
      mode: 'Habilitation',
      testSetId: '2f1c9f76-7a37-4d93-9e79-2fbe7b7a7b1a',
      prefix: 'SETP',
      consecutive: 990000001,
      currencyCode: 'COP',
      dueAt: '2026-10-20',
      periodStartDate: '2026-10-20',
      periodEndDate: '2026-11-19',
      paymentMeanCode: '1',
      resolution: RESOLUCION,
      totals: { amount: 150000, taxesAmount: 0, withholdingAmount: 0 },
    })
    const lineas = f.lines as Array<Record<string, unknown>>
    expect(lineas).toHaveLength(1)
    expect(lineas[0].name).toBe('Servicio de computación en la nube (SaaS) – acceso a Valida')
    expect(lineas[0].price).toBe(150000)
    expect(lineas[0].quantity).toBe(1)
    expect(lineas[0].taxes).toBeUndefined()
    expect(lineas[0].description).toBe('Período 20/10/2026–19/11/2026. Excluido de IVA, art. 476 num. 21 ET.')
    expect(f.notes).toEqual(['Excluido de IVA, art. 476 num. 21 ET.', 'Pagado el 20/10/2026 (referencia epayco:123).'])
    expect(f.customer).toMatchObject({ personType: '1', identification: '900156521', digitCheck: '0', identificationTypeCode: '31', email: 'pagos@laruta.co' })
  })

  it('ningún texto que ve la DIAN dice «licencia»', () => {
    expect(JSON.stringify(armarFactura(datos())).toLowerCase()).not.toContain('licenc')
    expect(() => armarFactura(datos({ concepto: { ...CONCEPTO_VALIDA, nombre: 'Licencia de Valida' } }))).toThrow(/licencia/)
  })

  it('en Production no va testSetId; en Habilitation es obligatorio', () => {
    expect(armarFactura(datos({ modo: 'Production', testSetId: null }))).not.toHaveProperty('testSetId')
    expect(() => armarFactura(datos({ testSetId: null }))).toThrow(/testSetId/)
  })

  it('sin periodo conocido no inventa fechas', () => {
    const f = armarFactura(datos({ periodo: null }))
    expect(f).not.toHaveProperty('periodStartDate')
    expect((f.lines as Array<Record<string, unknown>>)[0].description).toBe('Excluido de IVA, art. 476 num. 21 ET.')
  })

  it('el número tiene que caber en la resolución', () => {
    expect(() => armarFactura(datos({ consecutivo: 1 }))).toThrow(/fuera del rango/)
    expect(() => armarFactura(datos({ prefijo: 'FE' }))).toThrow(/prefijo/)
  })

  it('monto entero y positivo', () => {
    expect(() => armarFactura(datos({ monto: 0 }))).toThrow()
    expect(() => armarFactura(datos({ monto: 150000.5 }))).toThrow()
  })
})

describe('armarNotaCredito', () => {
  const factura = {
    prefijo: 'SETP',
    consecutivo: 990000001,
    numero: 'SETP990000001',
    cufe: 'ca2f628cac4a2f71a510cf28eaba9ad9703686681cb11e5ecea9a1d26f375e1cdc9899dea2e81a9eb1758382c3582b0f',
    fechaEmision: '2026-10-20',
  }
  it('code 91 / typeOperation 20 con la referencia completa a la factura', () => {
    const { periodo: _p, fechaPago: _f, referenciaPago: _r, ...base } = datos()
    const n = armarNotaCredito({ ...base, prefijo: 'NC', consecutivo: 1, factura, conceptoNota: '2', motivo: 'Devolución del pago.' })
    expect(n).toMatchObject({
      code: '91',
      typeOperation: '20',
      prefix: 'NC',
      consecutive: 1,
      conceptCode: '2',
      invoicePrefix: 'SETP',
      invoiceConsecutive: 990000001,
      invoiceCuv: factura.cufe,
      invoiceIssuedAt: '2026-10-20',
      invoiceSequence: 'SETP990000001',
      notes: ['Devolución del pago.'],
    })
  })
})

describe('decidirFacturable', () => {
  const EMISOR = 'ws-metrik'
  const ctx = (extra: Partial<ContextoCobro> = {}): ContextoCobro => ({
    cobroId: 'c1',
    workspaceId: EMISOR,
    monto: 150000,
    fecha: '2026-10-20',
    anulado: false,
    modulo: 'valida_consulta',
    origenNegocio: 'valida_autogestion',
    tieneContrato: true,
    yaFacturadoAMano: false,
    ...extra,
  })

  it('Valida autogestionada pagada: sí', () => {
    expect(decidirFacturable(ctx(), EMISOR, null)).toEqual({ facturable: true, concepto: CONCEPTO_VALIDA })
  })

  it.each([
    ['otro cobrador', { workspaceId: 'otro' }],
    ['anulado', { anulado: true }],
    ['sin pagar', { fecha: null }],
    ['sin monto', { monto: 0 }],
    ['sin contrato', { tieneContrato: false }],
    ['módulo sin concepto', { modulo: 'radar_secop' }],
    ['un CDA (misma ficha, otro origen)', { origenNegocio: null }],
    ['ya facturado a mano', { yaFacturadoAMano: true }],
  ])('%s: no', (_n, extra) => {
    expect(decidirFacturable(ctx(extra as Partial<ContextoCobro>), EMISOR, null).facturable).toBe(false)
  })

  it('pagado antes de la fecha de arranque: no (se facturó por fuera)', () => {
    expect(decidirFacturable(ctx({ fecha: '2026-10-19' }), EMISOR, '2026-10-20').facturable).toBe(false)
    expect(decidirFacturable(ctx({ fecha: '2026-10-20' }), EMISOR, '2026-10-20').facturable).toBe(true)
  })
})
