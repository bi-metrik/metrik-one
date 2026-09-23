import { describe, it, expect } from 'vitest'
import { inflateSync } from 'node:zlib'
import { PDFDocument } from 'pdf-lib'

import { TEXTO_MARCA_BORRADOR, TEXTO_MARCA_PANTALLAZOS, ponerMarcaDeBorrador } from './marca-borrador'

/** El texto de cada flujo, inflado. pdf-lib escribe el texto de la marca en hexadecimal. */
function flujos(pdf: Buffer): string[] {
  const salida: string[] = []
  let desde = 0
  for (;;) {
    const ini = pdf.indexOf('stream', desde)
    if (ini === -1) break
    let inicio = ini + 'stream'.length
    if (pdf[inicio] === 0x0d) inicio++
    if (pdf[inicio] === 0x0a) inicio++
    const fin = pdf.indexOf('endstream', inicio)
    if (fin === -1) break
    try { salida.push(inflateSync(pdf.subarray(inicio, fin)).toString('latin1')) } catch { /* no es texto */ }
    desde = fin + 'endstream'.length
  }
  return salida
}

const hex = (s: string) => Buffer.from(s, 'latin1').toString('hex').toUpperCase()

describe('la marca de agua de borrador', () => {
  it('va en TODAS las páginas y no cambia cuántas hay', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([595, 842])
    doc.addPage([842, 595])
    doc.addPage([595, 842])
    const conMarca = await ponerMarcaDeBorrador(Buffer.from(await doc.save()), ['margen'])

    const leido = await PDFDocument.load(conMarca)
    expect(leido.getPageCount()).toBe(3)

    const conBorrador = flujos(conMarca).filter(f => f.includes(`<${hex('BORRADOR')}>`))
    expect(conBorrador).toHaveLength(3)
    const conFrase = flujos(conMarca).filter(f => f.includes(`<${hex('margen bajo el mínimo · no enviar')}>`))
    expect(conFrase).toHaveLength(3)
  })

  it('es semitransparente: deja leer el documento', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([595, 842])
    const conMarca = await ponerMarcaDeBorrador(Buffer.from(await doc.save()), ['margen'])
    // El estado gráfico con la opacidad puede ir dentro de un flujo de objetos: se busca
    // en el archivo y en los flujos inflados.
    const todo = [conMarca.toString('latin1'), ...flujos(conMarca)].join('\n')
    const opacidades = [...todo.matchAll(/\/ca\s+([\d.]+)/g)].map(m => Number(m[1]))
    expect(opacidades.length).toBeGreaterThan(0)
    for (const o of opacidades) expect(o).toBeLessThan(0.5)
  })
})

describe('la marca por pantallazos de otros pasajeros (decisión del 2026-09-22)', () => {
  it('dice el motivo en TODAS las páginas, y no el del margen', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([595, 842])
    doc.addPage([595, 842])
    const conMarca = await ponerMarcaDeBorrador(Buffer.from(await doc.save()), ['pantallazos'])
    const conFrase = flujos(conMarca).filter(f => f.includes(`<${hex('pantallazos por actualizar · no enviar')}>`))
    expect(conFrase).toHaveLength(2)
    expect(flujos(conMarca).filter(f => f.includes(`<${hex('BORRADOR')}>`))).toHaveLength(2)
    expect(flujos(conMarca).some(f => f.includes(`<${hex('margen bajo el mínimo · no enviar')}>`))).toBe(false)
    expect((await PDFDocument.load(conMarca)).getTitle()).toBe(TEXTO_MARCA_PANTALLAZOS)
  })

  it('solo el margen: la marca de siempre, letra por letra (el piso de #824 no cambia)', async () => {
    const doc = await PDFDocument.create()
    doc.addPage([595, 842])
    const conMarca = await ponerMarcaDeBorrador(Buffer.from(await doc.save()), ['margen'])
    expect((await PDFDocument.load(conMarca)).getTitle()).toBe(TEXTO_MARCA_BORRADOR)
    expect(TEXTO_MARCA_BORRADOR).toBe('BORRADOR · margen bajo el mínimo · no enviar')
    expect(TEXTO_MARCA_PANTALLAZOS).toBe('BORRADOR · pantallazos por actualizar · no enviar')
  })
})

describe('la marca dice el motivo REAL (decisión del 2026-09-23)', () => {
  const paginas = async (n: number, tamano: [number, number] = [595, 842]) => {
    const doc = await PDFDocument.create()
    for (let i = 0; i < n; i++) doc.addPage(tamano)
    return Buffer.from(await doc.save())
  }

  it.each([
    [['iva_sin_calcular'], 'IVA sin calcular · no enviar'],
    [['iva_incluido_sin_plantilla'], 'IVA incluido sin plantilla · no enviar'],
  ] as const)('%j: en todas las páginas, y nada del margen', async (motivos, linea) => {
    const conMarca = await ponerMarcaDeBorrador(await paginas(2), motivos)
    expect(flujos(conMarca).filter(f => f.includes(`<${hex(linea)}>`))).toHaveLength(2)
    expect(flujos(conMarca).some(f => f.includes(hex('margen bajo el mínimo')))).toBe(false)
    expect((await PDFDocument.load(conMarca)).getTitle()).toBe(`BORRADOR · ${linea}`)
  })

  it('dos motivos: se leen los dos, también en una página apaisada', async () => {
    const linea = 'pantallazos por actualizar · IVA incluido sin plantilla · no enviar'
    for (const tamano of [[595, 842], [842, 595]] as Array<[number, number]>) {
      const conMarca = await ponerMarcaDeBorrador(await paginas(1, tamano), ['pantallazos', 'iva_incluido_sin_plantilla'])
      expect(flujos(conMarca).filter(f => f.includes(`<${hex(linea)}>`))).toHaveLength(1)
    }
  })

  it('sin motivos no hay marca que poner', async () => {
    await expect(ponerMarcaDeBorrador(await paginas(1), [])).rejects.toThrow('al menos un motivo')
  })
})
