import { describe, it, expect } from 'vitest'
import {
  cargaManualPermitida,
  emisorImpideFactura,
  mismoNumero,
  numeroNoCoincideConMarca,
  resolverFacturaDelNegocio,
  verificarEmisorFactura,
} from './factura-del-negocio'

/** Formas reales de SOENA, medidas en producción el 2026-09-14. */
const NIT_SOENA = '901874885'

const CARGUE_HISTORICO = {
  campos: { numero_factura: { value: 'FV-2-248', manual: true } },
  origen: 'emitido_en_siigo',
  drive_url: 'https://drive.google.com/file/d/1XrMeN5uCm0KnETJ3_GlrznswQr04nIlc/view?usp=drivesdk',
  file_name: 'FV-2-248.pdf',
}
/** V0153: cargada en la ficha, extraída por IA, sin origen declarado. */
const CARGADA_EN_FICHA = {
  campos: {
    emisor_nit: { value: '901874885', manual: false, confidence: 1 },
    numero_factura: { value: 'SOE 153', manual: false, confidence: 1 },
  },
  drive_url: 'https://drive.google.com/file/d/15h5NGRfxhDVuk9pGIQh8jz4lkmGnCoif/view?usp=drivesdk',
  file_name: 'SOE - 153.pdf',
}
/** V0089: la factura del VEHÍCULO cargada en «Factura emitida». */
const FACTURA_DEL_VEHICULO = {
  campos: {
    emisor_nit: { value: '800041629', manual: true },
    numero_factura: { value: 'VNYC 638', manual: false, confidence: 1 },
  },
  drive_url: 'https://drive.google.com/file/d/18g8x9sITS6F9AeJHyVIVHo1omKKYYw0C/view?usp=drivesdk',
  file_name: '005_FACTURA.jpeg',
}
const MARCA_V0076 = { numero: 'FV-2-459', archivo_url: null, emitida: true }

describe('resolverFacturaDelNegocio', () => {
  it('cargue histórico: número y PDF del bloque original', () => {
    const r = resolverFacturaDelNegocio({ original: CARGUE_HISTORICO, marca: null, emisorNitEsperado: NIT_SOENA })
    expect(r.factura).toEqual({
      numero: 'FV-2-248', pdfUrl: CARGUE_HISTORICO.drive_url, origen: 'emitido_en_siigo', fuentePdf: 'bloque',
    })
    expect(r.documentoAjeno).toBeNull()
  })

  it('un bloque sin emisor extraído no se juzga ajeno', () => {
    // Ni el cargue histórico ni la emisión desde ONE escriben `emisor_nit`.
    expect(resolverFacturaDelNegocio({ original: CARGUE_HISTORICO, marca: null, emisorNitEsperado: NIT_SOENA }).factura)
      .not.toBeNull()
  })

  it('la factura del vehículo NO es la factura del negocio, aunque traiga número', () => {
    const r = resolverFacturaDelNegocio({ original: FACTURA_DEL_VEHICULO, marca: null, emisorNitEsperado: NIT_SOENA })
    expect(r.factura).toBeNull()
    expect(r.documentoAjeno).toEqual({ emisor: '800041629', numero: 'VNYC 638' })
  })

  it('sin NIT esperado configurado no hay contra qué juzgar el emisor', () => {
    const r = resolverFacturaDelNegocio({ original: FACTURA_DEL_VEHICULO, marca: null })
    expect(r.factura?.numero).toBe('VNYC 638')
  })

  it('cargada en la ficha con el emisor correcto: factura con origen null', () => {
    const r = resolverFacturaDelNegocio({ original: CARGADA_EN_FICHA, marca: null, emisorNitEsperado: NIT_SOENA })
    expect(r.factura).toMatchObject({ numero: 'SOE 153', origen: null, fuentePdf: 'bloque' })
  })

  it('V0076: marca sin archivo y sin fila original = facturada, sin soporte', () => {
    const r = resolverFacturaDelNegocio({ original: null, marca: MARCA_V0076, emisorNitEsperado: NIT_SOENA })
    expect(r.factura).toEqual({ numero: 'FV-2-459', pdfUrl: null, origen: 'emitido_en_siigo', fuentePdf: null })
  })

  it('la marca con archivo cubre un bloque original vacío', () => {
    const r = resolverFacturaDelNegocio({
      original: {}, marca: { numero: 'FV-2-373', archivo_url: 'https://drive/x', origen: 'adoptada_de_siigo' },
    })
    expect(r.factura).toEqual({ numero: 'FV-2-373', pdfUrl: 'https://drive/x', origen: 'adoptada_de_siigo', fuentePdf: 'marca' })
  })

  it('con marca, un bloque con OTRO documento no presta su PDF', () => {
    const r = resolverFacturaDelNegocio({
      original: FACTURA_DEL_VEHICULO, marca: { numero: 'FV-2-500', archivo_url: 'https://drive/marca' }, emisorNitEsperado: NIT_SOENA,
    })
    expect(r.factura?.pdfUrl).toBe('https://drive/marca')
    expect(r.documentoAjeno).not.toBeNull()
  })

  it('con marca, un bloque con otro NÚMERO no presta su PDF', () => {
    const r = resolverFacturaDelNegocio({
      original: CARGUE_HISTORICO, marca: { numero: 'FV-2-999', archivo_url: null },
    })
    expect(r.factura).toMatchObject({ numero: 'FV-2-999', pdfUrl: null })
  })

  it('un bloque con archivo pero sin número extraído no cuenta como factura', () => {
    const r = resolverFacturaDelNegocio({
      original: { drive_url: 'https://drive/y', campos: {} }, marca: null, emisorNitEsperado: NIT_SOENA,
    })
    expect(r.factura).toBeNull()
    expect(r.documentoAjeno).toBeNull()
  })

  it('sin bloque ni marca: no facturado', () => {
    expect(resolverFacturaDelNegocio({ original: null, marca: null })).toEqual({ factura: null, documentoAjeno: null })
  })
})

describe('verificarEmisorFactura — la misma regla que el gate factura:emitida', () => {
  it('compara sin dígito de verificación', () => {
    expect(verificarEmisorFactura('9018748851', NIT_SOENA)).toBe('coincide')
    expect(verificarEmisorFactura('901874885', '901874885-1')).toBe('coincide')
  })

  it('un emisor vacío impide la factura cuando hay esperado', () => {
    expect(verificarEmisorFactura('', NIT_SOENA)).toBe('sin_emisor')
    expect(emisorImpideFactura('sin_emisor')).toBe(true)
  })

  it('otro NIT impide; sin esperado, nada impide', () => {
    expect(verificarEmisorFactura('800041629', NIT_SOENA)).toBe('no_coincide')
    expect(emisorImpideFactura('no_coincide')).toBe(true)
    expect(verificarEmisorFactura('800041629', null)).toBe('sin_esperado')
    expect(emisorImpideFactura('sin_esperado')).toBe(false)
  })
})

describe('cargaManualPermitida', () => {
  const resolver = (original: unknown, marca: Parameters<typeof resolverFacturaDelNegocio>[0]['marca'] = null) =>
    resolverFacturaDelNegocio({ original, marca, emisorNitEsperado: NIT_SOENA })

  it('sin nada cargado: se carga, no es reemplazo', () => {
    expect(cargaManualPermitida(null, resolver(null))).toEqual({ permitido: true, reemplaza: false })
  })

  it('facturada por ONE sin PDF (V0076): se carga el soporte, no es reemplazo', () => {
    expect(cargaManualPermitida(null, resolver(null, MARCA_V0076))).toEqual({ permitido: true, reemplaza: false })
  })

  it('sobre un PDF que trajo Siigo, NO', () => {
    const r = cargaManualPermitida(CARGUE_HISTORICO, resolver(CARGUE_HISTORICO))
    expect(r.permitido).toBe(false)
  })

  it('sobre el PDF de la marca, NO', () => {
    const marca = { numero: 'FV-2-373', archivo_url: 'https://drive/x' }
    expect(cargaManualPermitida({}, resolver({}, marca)).permitido).toBe(false)
  })

  it('sobre una carga manual previa, SÍ, como reemplazo', () => {
    const manual = { ...CARGADA_EN_FICHA, origen: 'cargada_manual' }
    expect(cargaManualPermitida(manual, resolver(manual))).toEqual({ permitido: true, reemplaza: true })
    expect(cargaManualPermitida(CARGADA_EN_FICHA, resolver(CARGADA_EN_FICHA))).toEqual({ permitido: true, reemplaza: true })
  })

  it('sobre un documento ajeno: se carga, y es reemplazo (pide motivo)', () => {
    expect(cargaManualPermitida(FACTURA_DEL_VEHICULO, resolver(FACTURA_DEL_VEHICULO)))
      .toEqual({ permitido: true, reemplaza: true })
  })
})

describe('número de la carga contra la marca', () => {
  it('sin marca, cualquier número sirve', () => {
    expect(numeroNoCoincideConMarca('FV-2-700', null)).toBeNull()
  })

  it('con marca, tiene que ser la misma factura (sin importar formato)', () => {
    expect(numeroNoCoincideConMarca('fv 2 459', MARCA_V0076)).toBeNull()
    expect(numeroNoCoincideConMarca('FV-2-460', MARCA_V0076)).toMatch(/no coincide/)
  })

  it('mismoNumero no da por iguales dos vacíos', () => {
    expect(mismoNumero('', '')).toBe(false)
    expect(mismoNumero('FV-2-1', 'FV21')).toBe(true)
  })
})
