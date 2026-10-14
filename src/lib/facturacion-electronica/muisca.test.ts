/**
 * El adaptador de Muisca contra las respuestas DE LA DOCUMENTACIÓN (copiadas tal cual de los
 * ejemplos de https://doc.muisca.io el 2026-10-14). Ninguna sale de una cuenta real: no hay token.
 */
import { describe, expect, it } from 'vitest'
import { clienteMuisca, estadoDian, leerDocumento } from './muisca'

/** Ejemplo 200 de POST /v2/documents/invoices (crear-factura-electr%C3%B3nica-42587102e0.md). */
const CREADA = {
  Id: '21158a97-2b72-4db6-8b75-4aeeefa016c6',
  Cufe: '19dc6fbda4723595d089dcad098bfc3e25b9096c03ffe816d035ad8aa7b442f1db024a6702c4122f80b3db49c668ef88',
  Sequence: 'SETP994121930',
  Qr: 'NumFac:SETP994121930;FecFac:2026-07-01;HorFac:00:00:00-05:00;NitFac:830099008;DocAdq:1234567890;ValFac:150000.00;ValIva:28500.00;ValOtroIm:0.00;ValTolFac:178500.00;CUFE:19dc6fbda4723595d089dcad098bfc3e25b9096c03ffe816d035ad8aa7b442f1db024a6702c4122f80b3db49c668ef88;https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=19dc6fbda4723595d089dcad098bfc3e25b9096c03ffe816d035ad8aa7b442f1db024a6702c4122f80b3db49c668ef88',
  Status: 'Aprobada',
  StatusReasons: ['Procesado Correctamente.'],
}

/** Ejemplo 200 de GET /v2/documents/invoices/{id} (consultar-por-id-42587100e0.md). */
const CONSULTADA = {
  Id: 'e04c17db-0949-4c5e-ae62-bc931d37cccf',
  Kind: 'Invoice',
  CompanyKey: 1394,
  BatchFileId: null,
  Code: '04',
  TypeOperation: '10',
  Mode: 'Test',
  Format: 'Estandar',
  TestSetId: '988e04d4-d9e8-482a-98d5-339f94c3fab9',
  Prefix: 'SETP',
  Consecutive: 994110395,
  Sequence: 'SETP994110395',
  IssuedAt: '2026-02-05T00:00:00',
  DueAt: '2026-02-05T00:00:00',
  PeriodStartDate: null,
  PeriodEndDate: null,
  Cuv: 'ca2f628cac4a2f71a510cf28eaba9ad9703686681cb11e5ecea9a1d26f375e1cdc9899dea2e81a9eb1758382c3582b0f',
  Qr: 'NumFac:SETP994110395;FecFac:2026-02-05;HorFac:00:00:00-05:00;NitFac:830099008;DocAdq:100737552;ValFac:20000.00;ValIva:0.00;ValOtroIm:0.00;ValTolFac:20000.00;CUFE:ca2f628cac4a2f71a510cf28eaba9ad9703686681cb11e5ecea9a1d26f375e1cdc9899dea2e81a9eb1758382c3582b0f;https://catalogo-vpfe-hab.dian.gov.co/document/searchqr?documentkey=ca2f628cac4a2f71a510cf28eaba9ad9703686681cb11e5ecea9a1d26f375e1cdc9899dea2e81a9eb1758382c3582b0f',
  DianDeliveryStatus: 'valid',
  Status: 'Aprobada',
  Priority: 'Low',
  ExpirationDays: 90,
  StatusReasons: ['Procesado Correctamente.'],
  StatusDate: '2026-02-05T08:57:21',
  StatusAttempt: 7,
  SentEmail: false,
  RejectReason: null,
  SupplierName: 'Drew Miller DDS',
  SupplierIdentification: '7816057793924189',
  CustomerName: 'David Ochoa',
  CustomerIdentification: '100737552',
  UrlPdf: '1394/transactions/2026/2/invoices/fv0830099008045263B40EBBB.pdf',
  UrlXmlDocument: null,
  UrlXmlApplicationResponse: null,
  UrlXmlAttachedDocument: null,
  UrlZip: '1394/transactions/2026/2/invoices/fv0830099008045263B40EBBB.zip',
  UrlPdfEncoded: null,
  UrlXmlEncoded: null,
  PaymentMeanCode: '10',
  Amount: 20000,
}

/** Ejemplo 200 de GET /v2/resolutions/resolutions-dian (resoluciones-42587097e0.md). */
const RESOLUCION = {
  Key: 'd14d0fba97f78723b16bec318fae0cdxxxx',
  Prefix: 'SETT',
  Number: 1234567890,
  RangeInitial: 1,
  RangeFinal: 1000,
  ValidFrom: '2026-05-05T00:00:00',
  ValidUntil: '2028-05-05T00:00:00',
}

type Llamada = { url: string; init: RequestInit }

function fetchFalso(respuestas: Array<{ status: number; cuerpo: unknown } | Error>) {
  const llamadas: Llamada[] = []
  const f = (async (url: string, init: RequestInit) => {
    llamadas.push({ url, init })
    const r = respuestas.shift()
    if (!r) throw new Error('sin respuesta preparada')
    if (r instanceof Error) throw r
    const texto = typeof r.cuerpo === 'string' ? r.cuerpo : JSON.stringify(r.cuerpo)
    return new Response(texto, { status: r.status })
  }) as unknown as typeof fetch
  return { f, llamadas }
}

const OPS = { token: 'tok-123', apiUrl: 'https://api.muisca.io/' }

describe('leerDocumento', () => {
  it('la respuesta de creación: id, CUFE, número y aprobada', () => {
    const d = leerDocumento(CREADA)!
    expect(d.id).toBe(CREADA.Id)
    expect(d.cufe).toBe(CREADA.Cufe)
    expect(d.numero).toBe('SETP994121930')
    expect(d.estado).toBe('aprobada')
  })

  it('la consulta: el CUFE viene como `Cuv`, el PDF como ruta relativa', () => {
    const d = leerDocumento(CONSULTADA)!
    expect(d.cufe).toBe(CONSULTADA.Cuv)
    expect(d.prefijo).toBe('SETP')
    expect(d.consecutivo).toBe(994110395)
    expect(d.fechaEmision).toBe('2026-02-05')
    expect(d.urlPdf).toBe(CONSULTADA.UrlPdf)
    expect(d.urlXml).toBeNull()
    expect(d.identificacionCliente).toBe('100737552')
    expect(d.monto).toBe(20000)
  })

  it('sin Cufe ni Cuv, saca el CUFE del QR', () => {
    const { Cufe: _c, ...sinCufe } = CREADA
    expect(leerDocumento(sinCufe)!.cufe).toBe(CREADA.Cufe)
  })

  it('un CUFE que no es SHA-384 no se toma', () => {
    expect(leerDocumento({ Id: 'x', Cufe: 'abc', Status: 'Aprobada' })!.cufe).toBeNull()
  })

  it('sin Id no es un documento', () => {
    expect(leerDocumento({ Status: 'Aprobada' })).toBeNull()
  })
})

describe('estadoDian', () => {
  it('Aprobada / valid → aprobada; Rechazada → rechazada; DianNoDisponible → en proceso', () => {
    expect(estadoDian('Aprobada', null)).toBe('aprobada')
    expect(estadoDian(null, 'valid')).toBe('aprobada')
    expect(estadoDian('Rechazada', null)).toBe('rechazada')
    expect(estadoDian('DianNoDisponible', null)).toBe('en_proceso')
    expect(estadoDian(null, null)).toBe('en_proceso')
  })
})

describe('clienteMuisca', () => {
  it('crea con POST /v2/documents/invoices, Bearer y JSON', async () => {
    const { f, llamadas } = fetchFalso([{ status: 200, cuerpo: CREADA }])
    const r = await clienteMuisca({ ...OPS, fetch: f }).crear('factura', { code: '01' })
    expect(r.tipo).toBe('documento')
    expect(llamadas[0].url).toBe('https://api.muisca.io/v2/documents/invoices')
    expect(llamadas[0].init.method).toBe('POST')
    const h = llamadas[0].init.headers as Record<string, string>
    expect(h.Authorization).toBe('Bearer tok-123')
    expect(h['Content-Type']).toBe('application/json')
    expect(JSON.parse(String(llamadas[0].init.body))).toEqual({ code: '01' })
  })

  it('la nota crédito va a /v2/documents/invoices/credit-notes', async () => {
    const { f, llamadas } = fetchFalso([{ status: 200, cuerpo: CREADA }])
    await clienteMuisca({ ...OPS, fetch: f }).crear('nota_credito', {})
    expect(llamadas[0].url).toBe('https://api.muisca.io/v2/documents/invoices/credit-notes')
  })

  it('busca por prefijo y consecutivo con los parámetros de la doc', async () => {
    const { f, llamadas } = fetchFalso([{ status: 200, cuerpo: CONSULTADA }])
    const r = await clienteMuisca({ ...OPS, fetch: f }).buscarPorNumero('factura', 'SETP', 994110395)
    expect(llamadas[0].url).toBe('https://api.muisca.io/v2/documents/invoices/find-by-prefix-and-consecutive?prefix=SETP&consecutive=994110395')
    expect(r.tipo).toBe('documento')
  })

  it('consulta por id', async () => {
    const { f, llamadas } = fetchFalso([{ status: 200, cuerpo: CONSULTADA }])
    await clienteMuisca({ ...OPS, fetch: f }).consultarPorId('nota_credito', 'abc')
    expect(llamadas[0].url).toBe('https://api.muisca.io/v2/documents/invoices/credit-notes/abc')
  })

  it.each([
    [400, 'invalido'],
    [413, 'invalido'],
    [422, 'invalido'],
    [401, 'no_autorizado'],
    [403, 'no_autorizado'],
    [404, 'no_encontrado'],
    [429, 'transitorio'],
    [500, 'transitorio'],
    [520, 'transitorio'],
  ])('HTTP %i → %s', async (status, tipo) => {
    const { f } = fetchFalso([{ status, cuerpo: { message: 'x' } }])
    const r = await clienteMuisca({ ...OPS, fetch: f }).crear('factura', {})
    expect(r.tipo).toBe(tipo)
  })

  it('un error de red o de tiempo es transitorio', async () => {
    const { f } = fetchFalso([new Error('ECONNRESET')])
    const r = await clienteMuisca({ ...OPS, fetch: f }).crear('factura', {})
    expect(r).toMatchObject({ tipo: 'transitorio', http: null })
  })

  it('un 200 que no es JSON al crear es transitorio (no se da por emitida)', async () => {
    const { f } = fetchFalso([{ status: 200, cuerpo: '<html>' }])
    expect((await clienteMuisca({ ...OPS, fetch: f }).crear('factura', {})).tipo).toBe('transitorio')
  })

  it('una búsqueda que vuelve vacía es «no existe»', async () => {
    const { f } = fetchFalso([{ status: 200, cuerpo: {} }])
    expect((await clienteMuisca({ ...OPS, fetch: f }).buscarPorNumero('factura', 'FE', 7)).tipo).toBe('no_encontrado')
  })

  it('lee la resolución del ejemplo (objeto suelto) y de una lista', async () => {
    const { f } = fetchFalso([
      { status: 200, cuerpo: RESOLUCION },
      { status: 200, cuerpo: [RESOLUCION] },
    ])
    const c = clienteMuisca({ ...OPS, fetch: f })
    const esperado = {
      key: RESOLUCION.Key,
      prefix: 'SETT',
      number: 1234567890,
      rangeInitial: 1,
      rangeFinal: 1000,
      validFrom: '2026-05-05',
      validUntil: '2028-05-05',
    }
    expect(await c.resoluciones()).toEqual({ ok: true, resoluciones: [esperado] })
    expect(await c.resoluciones()).toEqual({ ok: true, resoluciones: [esperado] })
  })

  it('descarga: una ruta relativa sin base no se intenta', async () => {
    const { f, llamadas } = fetchFalso([])
    const r = await clienteMuisca({ ...OPS, fetch: f }).descargar(CONSULTADA.UrlPdf)
    expect(r.ok).toBe(false)
    expect(llamadas).toHaveLength(0)
  })

  it('descarga: el token NO viaja a un host distinto del de la API', async () => {
    const { f, llamadas } = fetchFalso([{ status: 200, cuerpo: '%PDF' }])
    const r = await clienteMuisca({ ...OPS, archivosUrl: 'https://archivos.ejemplo.com/', fetch: f }).descargar(CONSULTADA.UrlPdf)
    expect(r.ok).toBe(true)
    expect(llamadas[0].url).toBe(`https://archivos.ejemplo.com/${CONSULTADA.UrlPdf}`)
    expect((llamadas[0].init.headers as Record<string, string>).Authorization).toBeUndefined()
  })
})
