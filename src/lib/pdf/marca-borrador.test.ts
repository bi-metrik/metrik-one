import { describe, it, expect } from 'vitest'
import { inflateSync } from 'node:zlib'
import { PDFDocument } from 'pdf-lib'

import { ponerMarcaDeBorrador } from './marca-borrador'

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
    const conMarca = await ponerMarcaDeBorrador(Buffer.from(await doc.save()))

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
    const conMarca = await ponerMarcaDeBorrador(Buffer.from(await doc.save()))
    // El estado gráfico con la opacidad puede ir dentro de un flujo de objetos: se busca
    // en el archivo y en los flujos inflados.
    const todo = [conMarca.toString('latin1'), ...flujos(conMarca)].join('\n')
    const opacidades = [...todo.matchAll(/\/ca\s+([\d.]+)/g)].map(m => Number(m[1]))
    expect(opacidades.length).toBeGreaterThan(0)
    for (const o of opacidades) expect(o).toBeLessThan(0.5)
  })
})
