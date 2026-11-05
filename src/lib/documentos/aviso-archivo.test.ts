import { describe, expect, it } from 'vitest'

import {
  MENSAJES_ARCHIVO,
  MENSAJE_FALLA_NUESTRA,
  esAvisoDeArchivo,
  mensajeDeLectura,
  motivoDesdeRespuestaModelo,
} from './aviso-archivo'

// Cuerpos reales o con la forma real de cada proveedor.
const GEMINI_SIN_PAGINAS = JSON.stringify({ error: { code: 400, message: 'The document has no pages.', status: 'INVALID_ARGUMENT' } })

describe('motivoDesdeRespuestaModelo', () => {
  it('V0634: el 400 «The document has no pages.» de Gemini es un PDF sin páginas', () => {
    expect(motivoDesdeRespuestaModelo(400, GEMINI_SIN_PAGINAS)).toBe('sin_paginas')
  })

  it.each([
    [400, 'anthropic 400: The PDF specified was not valid.', 'danado'],
    [400, 'anthropic 400: Could not process image', 'ilegible'],
    [400, 'Unable to process input image. Please retry or report in https://...', 'ilegible'],
    [400, 'The PDF is password protected', 'protegido'],
    [400, 'Request payload size exceeds the limit: 20971520 bytes.', 'muy_grande'],
    [413, 'Request Entity Too Large', 'muy_grande'],
    [400, 'Unsupported MIME type: image/heic', 'formato'],
  ] as const)('%i «%s» → %s', (estado, cuerpo, motivo) => {
    expect(motivoDesdeRespuestaModelo(estado, cuerpo)).toBe(motivo)
  })

  it.each([402, 403, 429, 500, 503, 504])('un %i nunca es del archivo, diga lo que diga el cuerpo', (estado) => {
    expect(motivoDesdeRespuestaModelo(estado, GEMINI_SIN_PAGINAS)).toBeNull()
  })

  it('un 400 de otra cosa (el esquema, la llave) es del sistema', () => {
    expect(motivoDesdeRespuestaModelo(400, 'API key not valid. Please pass a valid API key.')).toBeNull()
    expect(motivoDesdeRespuestaModelo(400, 'Invalid JSON payload received. Unknown name "foo"')).toBeNull()
  })
})

describe('los textos que ve el cliente', () => {
  it('ninguno nombra al proveedor ni un código HTTP', () => {
    for (const m of [...Object.values(MENSAJES_ARCHIVO), MENSAJE_FALLA_NUESTRA]) {
      expect(m).not.toMatch(/gemini|anthropic|claude|google|\b\d{3}\b|error/i)
    }
  })

  it('los de archivo dicen qué hacer: reemplazar', () => {
    for (const m of Object.values(MENSAJES_ARCHIVO)) expect(m).toMatch(/«Reemplazar»/)
  })

  it('esAvisoDeArchivo separa los dos', () => {
    expect(esAvisoDeArchivo(MENSAJES_ARCHIVO.sin_paginas)).toBe(true)
    expect(esAvisoDeArchivo(MENSAJE_FALLA_NUESTRA)).toBe(false)
    expect(esAvisoDeArchivo('Error de Gemini (400)')).toBe(false)
    expect(esAvisoDeArchivo(null)).toBe(false)
  })

  it('mensajeDeLectura: el del archivo si hay motivo; si no, la falla nuestra', () => {
    expect(mensajeDeLectura('vacio')).toBe(MENSAJES_ARCHIVO.vacio)
    expect(mensajeDeLectura(undefined)).toBe(MENSAJE_FALLA_NUESTRA)
  })
})
