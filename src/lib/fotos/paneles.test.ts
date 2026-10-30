/**
 * ¿Díptico, tríptico o foto sola? Imágenes sintéticas: paneles con textura separados por una franja
 * blanca (como los del sitio oficial), paneles pegados, una panorámica sin cortes y un collage de
 * paneles desiguales.
 */
import sharp from 'sharp'
import { describe, expect, it } from 'vitest'

import { panelesDeFoto } from './paneles'

/** Un panel con rayas diagonales (textura de foto, no un color plano). */
async function panel(ancho: number, alto: number, tono: number): Promise<Buffer> {
  const datos = Buffer.alloc(ancho * alto * 3)
  for (let y = 0; y < alto; y++) {
    for (let x = 0; x < ancho; x++) {
      const v = (tono + ((x + y) % 40) * 3) % 200
      datos.set([v, (v + 60) % 200, (v + 120) % 200], (y * ancho + x) * 3)
    }
  }
  return sharp(datos, { raw: { width: ancho, height: alto, channels: 3 } }).png().toBuffer()
}

/** Paneles lado a lado con una franja blanca de `separacion` px entre ellos. */
async function lado(anchos: number[], alto: number, separacion: number): Promise<{ datos: Buffer; proporcion: number }> {
  const total = anchos.reduce((s, a) => s + a, 0) + separacion * (anchos.length - 1)
  let x = 0
  const piezas = []
  for (const [i, a] of anchos.entries()) {
    piezas.push({ input: await panel(a, alto, i * 70), left: x, top: 0 })
    x += a + separacion
  }
  const datos = await sharp({ create: { width: total, height: alto, channels: 3, background: { r: 255, g: 255, b: 255 } } }).composite(piezas).jpeg().toBuffer()
  return { datos, proporcion: total / alto }
}

describe('paneles iguales', () => {
  it('díptico con franja blanca (como el del Kunuku): 2', async () => {
    const d = await lado([360, 360], 262, 10)
    expect(await panelesDeFoto(d.datos, d.proporcion)).toBe(2)
  })

  it('tríptico de paneles 4:3: 3', async () => {
    const t = await lado([400, 400, 400], 300, 8)
    expect(await panelesDeFoto(t.datos, t.proporcion)).toBe(3)
  })

  it('una panorámica sin cortes no es de paneles: 1', async () => {
    const p = await panel(1460, 524, 10)
    expect(await panelesDeFoto(await sharp(p).jpeg().toBuffer(), 1460 / 524)).toBe(1)
  })

  it('un collage de paneles desiguales (cortes fuera de los tercios y de la mitad): 1', async () => {
    const c = await lado([250, 700, 450], 500, 8)
    expect(await panelesDeFoto(c.datos, c.proporcion)).toBe(1)
  })

  it('una foto de forma buena no se mira (1, sin leer los píxeles)', async () => {
    expect(await panelesDeFoto(Buffer.from('no soy foto'), 1.5)).toBe(1)
  })
})
