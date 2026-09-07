import { describe, it, expect } from 'vitest'
import { mimeDeContenido, mimeEfectivo } from './mime'

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])
const pdf = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x36])
const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0])
const webp = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
])

describe('mimeDeContenido', () => {
  it('reconoce los cuatro formatos que la extraccion acepta', () => {
    expect(mimeDeContenido(pdf)).toBe('application/pdf')
    expect(mimeDeContenido(png)).toBe('image/png')
    expect(mimeDeContenido(jpg)).toBe('image/jpeg')
    expect(mimeDeContenido(webp)).toBe('image/webp')
  })

  it('devuelve null cuando la firma no se reconoce, en vez de adivinar', () => {
    expect(mimeDeContenido(new Uint8Array([1, 2, 3, 4]))).toBeNull()
    expect(mimeDeContenido(new Uint8Array([]))).toBeNull()
    expect(mimeDeContenido(null)).toBeNull()
    expect(mimeDeContenido(undefined)).toBeNull()
  })

  it('un RIFF que no es WEBP no se hace pasar por webp', () => {
    const riffWav = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ])
    expect(mimeDeContenido(riffWav)).toBeNull()
  })
})

describe('mimeEfectivo', () => {
  // El caso real de V0181: bytes PNG con nombre «Factura.pdf». Si gana el nombre,
  // Gemini recibe un PNG declarado como PDF y devuelve todos los campos vacíos.
  it('el CONTENIDO manda sobre el nombre', () => {
    expect(mimeEfectivo(png, 'application/pdf')).toBe('image/png')
    expect(mimeEfectivo(pdf, 'image/png')).toBe('application/pdf')
  })

  it('el nombre queda de respaldo cuando la firma no se reconoce', () => {
    expect(mimeEfectivo(new Uint8Array([1, 2, 3, 4]), 'application/pdf')).toBe('application/pdf')
    expect(mimeEfectivo(null, 'image/jpeg')).toBe('image/jpeg')
  })
})
