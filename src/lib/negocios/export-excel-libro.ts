/**
 * Serializacion del Excel de negocios: filas -> libro .xlsx (buffer).
 *
 * Vive aparte de `export-excel.ts` a proposito: aquel es puro y NO conoce XLSX (lo dice
 * su encabezado), y este es justo la capa que si lo conoce. La ruta (`api/negocios/export`)
 * lee de Supabase, arma las filas con el modulo puro y serializa con este.
 *
 * Esta capa es igual de probable sin red, y lo es por una razon concreta: el defecto que
 * la trajo aqui no se ve en las filas, solo en el XML que sale del `write`.
 */
import * as XLSX from 'xlsx'
import {
  COLUMNAS_FECHA,
  COLUMNAS_FECHA_HORA,
  COLUMNA_LINK,
  ENCABEZADOS,
  type Encabezado,
  type FilaExcel,
} from './export-excel'

export const NOMBRE_HOJA = 'Negocios'

/**
 * Arma el libro con la hoja unica de negocios y devuelve el buffer .xlsx.
 *
 * ⚠️ `cellDates: true` va SOLO en `json_to_sheet`, nunca en `write`.
 *
 * En `json_to_sheet` hace falta para que un `Date` quede como celda de fecha (`t:'d'`) y
 * no como texto. En `write` hace otra cosa: escribe la celda con el tipo ISO-8601 del
 * OOXML (`t="d"`, `<v>2026-01-15T00:00:00.000Z</v>`), que Excel entiende pero que el
 * importador de Google Sheets DESCARTA en silencio — el archivo abre bien y las columnas
 * de fecha salen vacias. Sin el, la celda se escribe como serial numerico
 * (`<v>46037</v>`) mas el formato `z` que se asigna abajo, y eso lo leen Excel, Sheets y
 * LibreOffice por igual.
 *
 * El unico costo es el redondeo del serial. Medido con `xlsx@0.18.5` barriendo los 1000
 * milisegundos de un minuto: la peor desviacion es de **1 ms**, contra los 60.000 ms de
 * resolucion que muestra el formato `yyyy-mm-dd hh:mm`. O sea, invisible.
 *
 * El tipo de retorno lo AFIRMA esta funcion: `XLSX.write` esta declarado `any`, y con
 * `type: 'buffer'` devuelve un Buffer de node. Sin declararlo, `NextResponse` lo recibia
 * como `any` y nadie comprobaba nada.
 */
export function construirLibroNegocios(filas: FilaExcel[]): Buffer<ArrayBuffer> {
  const ws = XLSX.utils.json_to_sheet(filas, { header: [...ENCABEZADOS], cellDates: true })
  const colDe = (h: Encabezado) => ENCABEZADOS.indexOf(h)
  const colLink = colDe(COLUMNA_LINK)
  const colsFecha = COLUMNAS_FECHA.map(colDe)
  const colsFechaHora = COLUMNAS_FECHA_HORA.map(colDe)
  for (let r = 1; r <= filas.length; r++) {
    for (const c of colsFecha) {
      const celda = ws[XLSX.utils.encode_cell({ c, r })]
      if (celda) celda.z = 'yyyy-mm-dd'
    }
    for (const c of colsFechaHora) {
      const celda = ws[XLSX.utils.encode_cell({ c, r })]
      if (celda) celda.z = 'yyyy-mm-dd hh:mm'
    }
    const link = ws[XLSX.utils.encode_cell({ c: colLink, r })]
    if (link && typeof link.v === 'string') link.l = { Target: link.v, Tooltip: 'Abrir en ONE' }
  }

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, NOMBRE_HOJA)
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
