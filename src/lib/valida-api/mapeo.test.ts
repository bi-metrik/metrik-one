import { describe, expect, it } from 'vitest'
import { esFuncionAusente, mapearCobros, mapearDocumentos, mapearLlaveEmitida, serviciosQuePaga } from './mapeo'

describe('mapearLlaveEmitida', () => {
  it('una respuesta sin la llave en claro NO es una emisión', () => {
    // «Llave creada» sin la llave dejaría al cliente con una credencial que nunca podrá ver.
    expect(mapearLlaveEmitida({ ok: true, key_id: 'k', key_prefix: 'vld_ab' })).toBeNull()
    expect(mapearLlaveEmitida({ ok: true, key_id: 'k', key_prefix: 'vld_ab', llave: '' })).toBeNull()
  })

  it('traduce la respuesta 201 de Valida', () => {
    expect(
      mapearLlaveEmitida({
        ok: true,
        key_id: 'k1',
        key_prefix: 'vld_ab',
        nombre: 'ERP',
        regenerada: true,
        llave: 'vld_ab_secreto',
        anterior_deja_de_autenticar_en: '2026-09-17T10:00:00Z',
      }),
    ).toEqual({
      keyId: 'k1',
      keyPrefix: 'vld_ab',
      nombre: 'ERP',
      llave: 'vld_ab_secreto',
      regenerada: true,
      anteriorDejaDeAutenticarEn: '2026-09-17T10:00:00Z',
    })
  })
})

describe('esFuncionAusente', () => {
  it('reconoce la RPC que todavía no existe (migración sin aplicar)', () => {
    expect(esFuncionAusente({ code: 'PGRST202', message: 'Could not find the function public.mis_servicios' })).toBe(true)
    expect(esFuncionAusente({ message: 'Could not find the function public.mis_servicios without parameters' })).toBe(true)
  })

  it('un error cualquiera no se confunde con la ausencia', () => {
    expect(esFuncionAusente({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(esFuncionAusente(null)).toBe(false)
  })
})

describe('serviciosQuePaga', () => {
  it('descarta los contratos de los que el workspace es solo beneficiario, incluido es_pagador null', () => {
    const base = { servicio_nombre: 'x', estado: 'activo', vigente_desde: '2026-09-01', vigente_hasta: null }
    const filas = [
      { ...base, servicio_contratado_id: 'paga', es_pagador: true },
      { ...base, servicio_contratado_id: 'benef', es_pagador: false },
      { ...base, servicio_contratado_id: 'nulo', es_pagador: null },
    ]
    expect(serviciosQuePaga(filas).map((f) => f.servicio_contratado_id)).toEqual(['paga'])
  })
})

describe('mapearCobros', () => {
  const fila = {
    cobro_id: 'c1',
    fecha: '2026-09-14',
    concepto: 'X1 26 1',
    monto: '1400000.00',
    fuente: 'bold',
    estado: 'pagado',
    recibo_numero: 'RC-2026-09-001',
    recibo_origen: 'manual',
    recibo_path: 'ws/recibos/abc.pdf',
  }

  it('un recibo con PDF propio es descargable', () => {
    expect(mapearCobros([fila])[0]).toMatchObject({ monto: 1400000, reciboDescargable: true })
  })

  it('un recibo sin PDF propio (archivado en Drive) NO se ofrece para descargar', () => {
    expect(mapearCobros([{ ...fila, recibo_path: null }])[0].reciboDescargable).toBe(false)
  })

  it('sin factura cargada (o con la RPC de antes de 20260924090000) no inventa una', () => {
    expect(mapearCobros([fila])[0].factura).toBeNull()
    expect(mapearCobros([{ ...fila, factura_numero: 'FE-1', factura_pdf_path: null, factura_xml_path: null }])[0].factura).toBeNull()
  })

  it('la factura con PDF y XML se ofrece sin exponer sus rutas', () => {
    const c = mapearCobros([
      {
        ...fila,
        factura_numero: 'FE-1',
        factura_cufe: 'f'.repeat(96),
        factura_fecha: '2026-09-23',
        factura_pdf_path: 'ws/facturas/abc.pdf',
        factura_xml_path: 'ws/facturas/abc.xml',
      },
    ])[0]
    expect(c.factura).toEqual({
      numero: 'FE-1',
      cufe: 'f'.repeat(96),
      fecha: '2026-09-23',
      pdfDescargable: true,
      xmlDescargable: true,
    })
    expect(JSON.stringify(c)).not.toContain('facturas/')
  })
})

describe('mapearDocumentos', () => {
  it('sin aceptación no afirma un canal', () => {
    const d = mapearDocumentos([
      {
        documento_id: 'd',
        slug: 's',
        titulo: 't',
        version: 'v1.0',
        texto_md: '#',
        pdf_sha256: 'a'.repeat(64),
        vigente_desde: '2026-09-15',
        vigente_hasta: null,
        aceptado_at: null,
        aceptado_por: null,
        aceptado_calidad: null,
        aceptado_canal: 'modulo',
      },
    ])
    expect(d[0].aceptadoCanal).toBeNull()
  })
})
