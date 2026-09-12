import { describe, expect, it } from 'vitest'
import { PLACA, geometriaPlaca, medirImagen } from './medidas-tarjeta'

// --- fixtures armados a mano, para no depender de archivos externos ---

function png(ancho: number, alto: number): Uint8Array {
  const b = new Uint8Array(33)
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0)
  const v = new DataView(b.buffer)
  v.setUint32(8, 13) // largo del IHDR
  b.set([0x49, 0x48, 0x44, 0x52], 12) // "IHDR"
  v.setUint32(16, ancho)
  v.setUint32(20, alto)
  return b
}

/** `sof` = 0xC0 baseline, 0xC2 progresivo. */
function jpeg(ancho: number, alto: number, sof: number): Uint8Array {
  const b = new Uint8Array(40)
  const v = new DataView(b.buffer)
  b.set([0xff, 0xd8], 0)
  // Un segmento APP0 de relleno, para obligar a recorrer antes de llegar al SOF.
  b.set([0xff, 0xe0], 2)
  v.setUint16(4, 8) // largo del APP0 (incluye los dos bytes del largo)
  b.set([0xff, sof], 12)
  v.setUint16(14, 17) // largo del SOF
  b[16] = 8 // precision
  v.setUint16(17, alto)
  v.setUint16(19, ancho)
  return b
}

describe('medirImagen', () => {
  it('lee un PNG', () => {
    expect(medirImagen(png(560, 840))).toEqual({ mime: 'image/png', ancho: 560, alto: 840 })
  })

  it('lee un JPEG baseline', () => {
    expect(medirImagen(jpeg(1227, 373, 0xc0))).toEqual({
      mime: 'image/jpeg',
      ancho: 1227,
      alto: 373,
    })
  })

  // El logo real de soena es progresivo (SOF2). Si `medirImagen` solo aceptara
  // el SOF baseline, el inquilino mas grande se quedaria sin tarjeta.
  it('lee un JPEG PROGRESIVO, no solo el baseline', () => {
    expect(medirImagen(jpeg(200, 200, 0xc2))).toEqual({
      mime: 'image/jpeg',
      ancho: 200,
      alto: 200,
    })
  })

  it('devuelve null ante un formato que no reconoce', () => {
    // Cabecera de WEBP ("RIFF....WEBP"), que el bucket hoy no tiene.
    const webp = new Uint8Array(32)
    webp.set([0x52, 0x49, 0x46, 0x46], 0)
    webp.set([0x57, 0x45, 0x42, 0x50], 8)
    expect(medirImagen(webp)).toBeNull()
  })

  it('devuelve null ante bytes truncados o vacios', () => {
    expect(medirImagen(new Uint8Array(0))).toBeNull()
    expect(medirImagen(png(10, 10).slice(0, 12))).toBeNull()
  })

  it('devuelve null si el PNG declara medidas en cero', () => {
    expect(medirImagen(png(0, 0))).toBeNull()
  })
})

describe('geometriaPlaca', () => {
  // El alto de la placa es FIJO: es lo que impide que la composicion baile
  // entre inquilinos. Se comprueba en los dos extremos reales.
  it('mantiene el alto de la placa en los dos extremos de proporcion', () => {
    expect(PLACA.alto).toBe(196)
  })

  it('un logo cuadrado toca el alto maximo y la placa lo abraza', () => {
    // soena: 200x200
    const g = geometriaPlaca({ ancho: 200, alto: 200 })
    expect(g.logoAlto).toBe(148)
    expect(g.logoAncho).toBe(148)
    expect(g.placaAncho).toBe(192) // 148 + 22*2
  })

  it('un logo muy ancho lo limita el ANCHO maximo (dimpro, 3.29:1)', () => {
    const g = geometriaPlaca({ ancho: 1227, alto: 373 })
    expect(g.logoAncho).toBe(300)
    expect(g.logoAlto).toBeCloseTo(91.2, 1)
    expect(g.placaAncho).toBeCloseTo(344, 1)
  })

  it('un logo muy alto lo limita el ALTO, y la placa cae al minimo (hjbc, 0.67:1)', () => {
    const g = geometriaPlaca({ ancho: 560, alto: 840 })
    expect(g.logoAlto).toBe(148)
    expect(g.logoAncho).toBeCloseTo(98.7, 1)
    // 98.7 + 44 = 142.7, por debajo del minimo: manda el minimo.
    expect(g.placaAncho).toBe(PLACA.anchoMinimo)
  })

  // `object-fit: contain` solo REDUCE. Un logo chico ampliado a 300px se veria
  // pixelado en la tarjeta, que es justo lo que no queremos publicar.
  it('NO agranda un logo mas chico que la caja', () => {
    const g = geometriaPlaca({ ancho: 192, alto: 69 })
    expect(g.logoAncho).toBe(192)
    expect(g.logoAlto).toBe(69)
    expect(g.placaAncho).toBe(236)
  })

  it('nunca se sale de los topes de ancho de la placa', () => {
    for (const [ancho, alto] of [
      [1, 4000],
      [4000, 1],
      [2048, 2048],
      [3, 3],
    ]) {
      const g = geometriaPlaca({ ancho, alto })
      expect(g.placaAncho).toBeGreaterThanOrEqual(PLACA.anchoMinimo)
      expect(g.placaAncho).toBeLessThanOrEqual(PLACA.anchoMaximo)
      expect(g.logoAncho).toBeLessThanOrEqual(PLACA.logoAnchoMaximo)
      expect(g.logoAlto).toBeLessThanOrEqual(PLACA.logoAltoMaximo)
    }
  })
})
