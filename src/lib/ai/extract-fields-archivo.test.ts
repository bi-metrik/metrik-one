import { afterEach, describe, expect, it, vi } from 'vitest'

import { extractFieldsFromDocument, type CampoExtraccion } from './extract-fields'
import { reconocerDocumento } from './reconocer-documento'
import { PDF_UNA_PAGINA } from '@/lib/documentos/__fixtures__/pdf'

// V0634 (2026-11-04): el modelo respondió 400 «The document has no pages.» y la pantalla dijo «Error de
// Gemini (400)». El resultado ahora trae `archivo`, para pedir reemplazarlo en vez de reintentar.
const campos = [{ slug: 'nit', label: 'NIT', tipo: 'texto', required: true, descripcion_ai: 'NIT' }] as CampoExtraccion[]
const respuesta = (estado: number, cuerpo: unknown) => vi.fn(async () => new Response(JSON.stringify(cuerpo), { status: estado }))

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

describe('extract-fields y reconocer-documento: el 400 del archivo', () => {
  it('«The document has no pages.» vuelve con archivo sin_paginas', async () => {
    vi.stubEnv('LLM_PROVEEDOR', 'gemini')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', respuesta(400, { error: { code: 400, message: 'The document has no pages.', status: 'INVALID_ARGUMENT' } }))

    expect(await extractFieldsFromDocument(PDF_UNA_PAGINA, 'application/pdf', campos, 'g'))
      .toMatchObject({ data: null, archivo: 'sin_paginas' })
    expect(await reconocerDocumento(PDF_UNA_PAGINA, 'application/pdf', 'g'))
      .toMatchObject({ data: null, archivo: 'sin_paginas' })
  })

  it('un 402 (saldo agotado) es del sistema: sin archivo', async () => {
    vi.stubEnv('LLM_PROVEEDOR', 'gemini')
    vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.stubGlobal('fetch', respuesta(402, { error: { code: 402, message: 'Prepay credits depleted' } }))
    const r = await extractFieldsFromDocument(PDF_UNA_PAGINA, 'application/pdf', campos, 'g')
    expect(r.data).toBeNull()
    expect(r).not.toHaveProperty('archivo')
  })

  it('un tipo que la lectura no acepta es del archivo', async () => {
    expect(await extractFieldsFromDocument(Buffer.from('x'), 'image/heic', campos, 'g')).toMatchObject({ archivo: 'formato' })
  })
})
