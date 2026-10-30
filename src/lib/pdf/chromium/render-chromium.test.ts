/**
 * QA del #1359 · la versión compacta de la propuesta sale SOLO si ahorra una hoja. Sin Chromium: el
 * navegador es un doble que imprime un PDF con tantas hojas como diga el HTML (`hojas=N`).
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'

const impresiones: string[] = []

async function pdfDe(hojas: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < hojas; i++) doc.addPage()
  return doc.save()
}

vi.mock('puppeteer-core', () => ({
  default: {
    defaultArgs: async () => [],
    launch: async () => {
      let contenido = ''
      return {
        process: () => null,
        version: async () => 'Doble/1',
        close: async () => undefined,
        newPage: async () => ({
          setRequestInterception: async () => undefined,
          on: () => undefined,
          setContent: async (html: string) => { contenido = html },
          evaluate: async () => true,
          pdf: async () => {
            impresiones.push(contenido)
            return pdfDe(Number(/hojas=(\d+)/.exec(contenido)?.[1] ?? 1))
          },
        }),
      }
    },
  },
}))

import { hojasDelPdf, imprimirHtmlAPdf } from './render-chromium'

const ejecutable = process.env.CHROMIUM_EJECUTABLE
beforeEach(() => {
  impresiones.length = 0
  process.env.CHROMIUM_EJECUTABLE = '/doble/chrome'
})
afterAll(() => {
  if (ejecutable === undefined) delete process.env.CHROMIUM_EJECUTABLE
  else process.env.CHROMIUM_EJECUTABLE = ejecutable
})

describe('imprimirHtmlAPdf · la alternativa compacta', () => {
  it('si ahorra una hoja, sale la compacta y lo dice', async () => {
    const r = await imprimirHtmlAPdf('hojas=3', { alternativa: 'hojas=2 compacta' })
    expect(await hojasDelPdf(r.pdf)).toBe(2)
    expect(r.html).toBe('hojas=2 compacta')
    expect(r.medidas.hojas).toEqual({ primera: 3, alternativa: 2, gano: 'alternativa' })
  })

  it('si no ahorra ninguna, sale la de siempre', async () => {
    const r = await imprimirHtmlAPdf('hojas=3', { alternativa: 'hojas=3 compacta' })
    expect(await hojasDelPdf(r.pdf)).toBe(3)
    expect(r.html).toBeUndefined()
    expect(r.medidas.hojas).toEqual({ primera: 3, alternativa: 3, gano: 'primera' })
  })

  it('en una sola hoja, o sin alternativa, no se imprime dos veces', async () => {
    await imprimirHtmlAPdf('hojas=1', { alternativa: 'hojas=1 compacta' })
    expect(impresiones).toEqual(['hojas=1'])
    impresiones.length = 0
    const r = await imprimirHtmlAPdf('hojas=3')
    expect(impresiones).toEqual(['hojas=3'])
    expect(r.medidas.hojas).toBeUndefined()
  })
})
