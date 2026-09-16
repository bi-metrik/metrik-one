import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { POLITICA_DATOS_VALIDA, requiereAceptacion, textoAvisoPolitica } from './politica'
import { huellaAvisoPolitica } from './politica-huella'

describe('versión de la Política', () => {
  it('es la publicada hoy en Valida (1.4), no la 1.5 que todavía no existe', () => {
    // Si alguien sube esto a 1.5 antes de que Valida la publique, esta línea lo obliga a
    // decidirlo a propósito: la constancia quedaría sobre un texto que nadie puede leer.
    expect(POLITICA_DATOS_VALIDA.version).toBe('1.4')
    expect(POLITICA_DATOS_VALIDA.url).toBe('https://valida.metrik.com.co/recursos/privacidad')
  })
})

describe('aviso y su huella', () => {
  it('el aviso nombra la versión que se registra', () => {
    expect(textoAvisoPolitica()).toContain(`v${POLITICA_DATOS_VALIDA.version}`)
  })

  it('la huella es el sha256 del texto exacto del aviso', () => {
    const esperada = createHash('sha256').update(textoAvisoPolitica(), 'utf8').digest('hex')
    expect(huellaAvisoPolitica()).toBe(esperada)
    expect(huellaAvisoPolitica()).toMatch(/^[0-9a-f]{64}$/)
  })
})

describe('requiereAceptacion', () => {
  it('sin ninguna aceptación, se pide', () => {
    expect(requiereAceptacion([])).toBe(true)
  })

  it('con la versión vigente aceptada, no se vuelve a pedir', () => {
    expect(requiereAceptacion([{ documento_version: '1.4', aceptada_at: '2026-09-16T10:00:00Z' }])).toBe(false)
  })

  it('una versión anterior no autoriza la vigente: se vuelve a pedir', () => {
    expect(requiereAceptacion([{ documento_version: '1.3', aceptada_at: '2026-01-01T00:00:00Z' }])).toBe(true)
  })
})
