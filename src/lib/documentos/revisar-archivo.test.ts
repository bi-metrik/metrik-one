import { describe, expect, it, vi } from 'vitest'
import { PDFDocument } from 'pdf-lib'

import { revisarArchivo } from './revisar-archivo'
import { PDF_SIN_PAGINAS, PDF_UNA_PAGINA } from './__fixtures__/pdf'

vi.spyOn(console, 'warn').mockImplementation(() => {})

describe('revisarArchivo', () => {
  it('V0634: un PDF bien formado pero sin páginas', async () => {
    expect(await revisarArchivo(PDF_SIN_PAGINAS, 'application/pdf')).toMatchObject({ ok: false, motivo: 'sin_paginas' })
  })

  it('un PDF sin páginas hecho con pdf-lib (pdf.js solo diría que tiene UNA)', async () => {
    const b = Buffer.from(await (await PDFDocument.create()).save({ addDefaultPage: false }))
    expect(await revisarArchivo(b, 'application/pdf')).toMatchObject({ ok: false, motivo: 'sin_paginas' })
  })

  it('un PDF de una página pasa', async () => {
    expect(await revisarArchivo(PDF_UNA_PAGINA, 'application/pdf')).toEqual({ ok: true })
    const d = await PDFDocument.create()
    d.addPage()
    expect(await revisarArchivo(Buffer.from(await d.save()), 'application/pdf')).toEqual({ ok: true })
  })

  it('0 bytes es un archivo vacío (hay uno así en producción)', async () => {
    expect(await revisarArchivo(Buffer.alloc(0), 'application/pdf')).toMatchObject({ ok: false, motivo: 'vacio' })
  })

  it('basura con cabecera %PDF, o un PDF cortado a la mitad, está dañado', async () => {
    expect(await revisarArchivo(Buffer.from('%PDF-1.4\n' + 'x'.repeat(300)), 'application/pdf'))
      .toMatchObject({ ok: false, motivo: 'danado' })
    const d = await PDFDocument.create()
    d.addPage()
    const bueno = Buffer.from(await d.save())
    expect(await revisarArchivo(bueno.subarray(0, Math.floor(bueno.length / 2)), 'application/pdf'))
      .toMatchObject({ ok: false, motivo: 'danado' })
  })

  it('un formato que la lectura no acepta (HEIC)', async () => {
    expect(await revisarArchivo(Buffer.from('\0\0\0\x18ftypheic'), 'image/heic')).toMatchObject({ ok: false, motivo: 'formato' })
  })

  it('manda el contenido: un PNG llamado «.pdf» pasa como imagen', async () => {
    expect(await revisarArchivo(Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]), 'application/pdf')).toEqual({ ok: true })
  })
})
