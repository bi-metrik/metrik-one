import { describe, it, expect } from 'vitest'
import { whatsappDesdeTelefono, telDesdeTelefono } from './telefono'

/**
 * Las tres formas sucias que NO se resuelven quitando lo que no sea dígito
 * están medidas sobre los negocios abiertos de SOENA (2026-08-14): decimal de
 * Excel, indicativo duplicado y handles de Instagram en el campo de teléfono.
 */

describe('whatsappDesdeTelefono', () => {
  it('acepta el móvil con indicativo y espacios', () => {
    expect(whatsappDesdeTelefono('+57 314 775 3962')).toBe('573147753962')
  })

  it('acepta el móvil sin indicativo y lo completa', () => {
    expect(whatsappDesdeTelefono('3147753962')).toBe('573147753962')
  })

  it('corta el decimal que dejó Excel ANTES de limpiar', () => {
    // Limpiar primero daría `30012345670`: once dígitos, un número que no existe.
    expect(whatsappDesdeTelefono('3001234567.0')).toBe('573001234567')
  })

  it('colapsa el indicativo duplicado', () => {
    expect(whatsappDesdeTelefono('+57 +57 3001234567')).toBe('573001234567')
  })

  it('descarta un handle de Instagram guardado como teléfono', () => {
    expect(whatsappDesdeTelefono('@juanperez')).toBeNull()
  })

  it('descarta un fijo: no abre WhatsApp', () => {
    expect(whatsappDesdeTelefono('6017430000')).toBeNull()
  })

  it('descarta vacío y basura', () => {
    expect(whatsappDesdeTelefono(null)).toBeNull()
    expect(whatsappDesdeTelefono('')).toBeNull()
    expect(whatsappDesdeTelefono('   ')).toBeNull()
    expect(whatsappDesdeTelefono('no tiene')).toBeNull()
  })
})

describe('telDesdeTelefono', () => {
  it('el móvil sale en E.164 con +', () => {
    expect(telDesdeTelefono('314 775 3962')).toBe('+573147753962')
  })

  it('un fijo se ofrece para llamar aunque no sirva para WhatsApp', () => {
    expect(telDesdeTelefono('601 743 0000')).toBe('6017430000')
  })

  it('un texto sin dígitos suficientes no es un enlace', () => {
    expect(telDesdeTelefono('@juanperez')).toBeNull()
    expect(telDesdeTelefono('123')).toBeNull()
  })
})
