import PizZip from 'pizzip'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { NOMBRE_HOJA, construirLibroNegocios } from './export-excel-libro'
import {
  COLUMNAS_FECHA,
  COLUMNAS_FECHA_HORA,
  COLUMNA_LINK,
  ENCABEZADOS,
  type Encabezado,
  type FilaExcel,
} from './export-excel'

/**
 * El Excel de negocios abria bien en Excel y salia con las columnas de fecha VACIAS al
 * subirlo a Google Sheets. Causa: `cellDates: true` iba tambien en `XLSX.write`, y con eso
 * SheetJS escribe la celda con el tipo ISO-8601 del OOXML (`t="d"`), que Excel soporta y
 * que el importador de Sheets descarta en silencio.
 *
 * Estas pruebas miran el XML que sale del `write`, no las filas: el defecto NO se ve en
 * `armarFilasExcel` (las filas siempre trajeron `Date`), solo en como se serializan.
 *
 * ⚠️ Vistas FALLAR el 2026-09-10, por mutacion: se devolvio `cellDates: true` al `write`
 * de `construirLibroNegocios`, se corrio solo este archivo, se restauro. Cayeron 2 de 5,
 * las dos que guardan el arreglo («sin t="d"» y «serial numerico»).
 *
 * Las otras 3 pasan en AMBOS sentidos, y es a proposito: dos cubren lo que el arreglo no
 * podia romper (formato `z` e hipervinculo), y la de relectura no puede distinguir porque
 * SheetJS lee bien las dos formas — el que descarta `t="d"` es el importador de Sheets, y
 * ese no se puede correr desde aqui. Por eso la garantia real esta en el XML, no en el
 * round-trip: una prueba que solo releyera el buffer habria pasado con el defecto puesto.
 */

/** Fila con las 50 columnas del spec vacias; encima se ponen solo las que la prueba mira. */
const filaVacia = (): FilaExcel =>
  Object.fromEntries(ENCABEZADOS.map((h) => [h, null])) as FilaExcel

const ref = (columna: Encabezado, fila = 1) =>
  XLSX.utils.encode_cell({ c: ENCABEZADOS.indexOf(columna), r: fila })

const sheetXml = (buffer: Buffer): string =>
  new PizZip(buffer).file('xl/worksheets/sheet1.xml')!.asText()

/** El `<c …>…</c>` completo de una celda, tal cual quedo escrito en el archivo. */
const celdaXml = (xml: string, columna: Encabezado): string => {
  const r = ref(columna)
  const m = xml.match(new RegExp(`<c r="${r}"[^>]*>[\\s\\S]*?</c>`))
  if (!m) throw new Error(`no se escribio la celda ${r} (${columna})`)
  return m[0]
}

/** Una fila con TODAS las columnas de fecha llenas: son las que el defecto vaciaba. */
const libroDeUnaFila = (): Buffer => {
  const fila = filaVacia()
  for (const columna of COLUMNAS_FECHA) fila[columna] = new Date(2026, 0, 15)
  for (const columna of COLUMNAS_FECHA_HORA) fila[columna] = new Date(2026, 0, 15, 21, 30)
  fila[COLUMNA_LINK] = 'https://soena.metrikone.co/negocios/n1'
  return construirLibroNegocios([fila])
}

describe('construirLibroNegocios — tipo de celda de las fechas', () => {
  it('ninguna celda sale con el tipo ISO-8601 `t="d"` que Google Sheets descarta', () => {
    const xml = sheetXml(libroDeUnaFila())
    expect(xml).not.toContain('t="d"')
  })

  it('las columnas de fecha llevan un serial NUMERICO, no una marca de tiempo', () => {
    const xml = sheetXml(libroDeUnaFila())
    for (const columna of [...COLUMNAS_FECHA, ...COLUMNAS_FECHA_HORA]) {
      const valor = celdaXml(xml, columna).match(/<v>([^<]*)<\/v>/)?.[1]
      expect(valor, `columna «${columna}»`).toMatch(/^\d+(\.\d+)?$/)
    }
    // Y el dia sigue siendo el mismo: 2026-01-15 es el serial 46037 de Excel.
    expect(celdaXml(xml, 'Fecha venta')).toContain('<v>46037</v>')
  })

  it('la fecha se relee como el mismo dia y la misma hora de pared', () => {
    const libro = XLSX.read(libroDeUnaFila(), { type: 'buffer', cellDates: true })
    const hoja = libro.Sheets[NOMBRE_HOJA]
    const dia = hoja[ref('Fecha venta')].v as Date
    const instante = hoja[ref('Fecha creacion')].v as Date
    // Componentes LOCALES, que es lo que SheetJS escribe (ver `fechaExcel`).
    expect([dia.getFullYear(), dia.getMonth(), dia.getDate()]).toEqual([2026, 0, 15])
    expect([instante.getHours(), instante.getMinutes()]).toEqual([21, 30])
  })
})

describe('construirLibroNegocios — lo que el arreglo no podia romper', () => {
  it('cada columna de fecha conserva su formato, que es lo que la vuelve legible', () => {
    const libro = XLSX.read(libroDeUnaFila(), { type: 'buffer', cellStyles: true })
    const hoja = libro.Sheets[NOMBRE_HOJA]
    expect(hoja[ref('Fecha venta')].z).toBe('yyyy-mm-dd')
    expect(hoja[ref('Fecha creacion')].z).toBe('yyyy-mm-dd hh:mm')
  })

  it('la columna de link sigue siendo un hipervinculo', () => {
    const xml = sheetXml(libroDeUnaFila())
    expect(xml).toContain('<hyperlinks>')
    const libro = XLSX.read(libroDeUnaFila(), { type: 'buffer' })
    expect(libro.Sheets[NOMBRE_HOJA][ref(COLUMNA_LINK)].l?.Target).toBe(
      'https://soena.metrikone.co/negocios/n1',
    )
  })
})
