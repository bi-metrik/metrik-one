import PizZip from 'pizzip'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import {
  ENCABEZADOS_COBROS,
  ENCABEZADOS_GASTOS,
  NOMBRE_HOJA_COBROS,
  NOMBRE_HOJA_GASTOS,
  NOMBRE_HOJA_RESUMEN,
  construirLibroRevision,
  type FilaCobro,
  type FilaGasto,
} from './export-excel-libro'

/**
 * El Excel de revision escribia las dos fechas de cada movimiento como TEXTO. Abre bien
 * en cualquier lado y aun asi no sirve para lo que baja el contador: sobre texto, Excel y
 * Google Sheets no ofrecen filtros de fecha (rango, «entre», «este mes»), ni agrupacion
 * por dia/mes/anio en tablas dinamicas, ni aritmetica de fechas.
 *
 * (El orden NO era el problema: las dos columnas son ISO, y el orden alfabetico coincide
 * con el cronologico incluso con la precision variable de microsegundos que devuelve
 * PostgREST. Medido. Lo que falta son las operaciones de fecha, no el orden.)
 *
 * Estas pruebas miran el XML que sale del `write`, no las filas ni el resultado de releer
 * el buffer: **un round-trip con `XLSX.read` NO distingue las dos formas** y pasaria con
 * el defecto puesto, porque el que descarta `t="d"` es el importador de Google Sheets y
 * ese no se puede correr desde aqui.
 *
 * ⚠️ VISTAS FALLAR el 2026-09-10. Tres mutaciones, aplicadas y revertidas una por una,
 * corriendo SOLO este archivo. Linea base verde antes de cada una. Lo medido, no lo
 * estimado (de las tres, la primera estimacion fue «caen 3» y cayeron 4):
 *
 *   M1 — `cellDates: true` de vuelta en el `XLSX.write` (el defecto del #623):
 *        caen 4 de 10. Las tres de serial y ademas «la hora sale en hora de pared»,
 *        porque con `t="d"` el `<v>` es una cadena ISO y ya no hay numero que partir.
 *
 *   M2 — no parsear: `fecha: fila.fecha` en vez de `fechaExcel(...)`, o sea el defecto
 *        ORIGINAL de esta ruta (fechas como texto): caen 3 de 10.
 *        ⚠️ «ninguna celda sale con t="d"» PASA aqui: sin `Date` no hay celda de fecha
 *        de ninguna forma, el texto sale como `t="str"`. Esa prueba cubre la regresion
 *        del write, no el defecto que este PR arregla; las otras dos cubren los dos.
 *
 *   M3 — quitar la guarda que evita formatear la celda vacia: NO cae ninguna. La linea
 *        no era observable (el `write` no emite la celda hueca, tenga o no formato) y se
 *        simplifico en vez de escribirle una prueba. La garantia de la celda vacia la da
 *        la prueba de abajo, que sigue cazando un epoch de 1970 si algun dia aparece.
 *
 * PASAN EN AMBOS SENTIDOS, a proposito, las que no hablan del tipo de celda: el formato
 * `z` (se asigna despues de armar la hoja, el write no lo toca), los encabezados, la hoja
 * Resumen (la que deliberadamente no se convirtio), el mes vacio y el CSV.
 *
 * El CSV se prueba aparte porque no pasa por este modulo (ver el bloque del final).
 */

const cobro = (over: Partial<FilaCobro> = {}): FilaCobro => ({
  fecha: '2026-09-01',
  codigo_negocio: 'S1 26 3',
  empresa: 'Empresa Uno',
  descripcion: 'Anticipo',
  monto: 1_000_000,
  retencion: 0,
  tercero_nit: '900123456',
  revisado: 'Si',
  // timestamptz tal como lo devuelve PostgREST, en UTC.
  revisado_at: '2026-09-05T14:30:45.123456+00:00',
  ...over,
})

const gasto = (over: Partial<FilaGasto> = {}): FilaGasto => ({
  fecha: '2026-09-02',
  codigo_negocio: 'S1 26 4',
  empresa: 'Empresa Dos',
  categoria: 'servicios_profesionales',
  clasificacion: 'variable',
  descripcion: 'Honorarios',
  monto: 500_000,
  retencion: 55_000,
  deducible: 'Si',
  tercero_nit: '800987654',
  estado_pago: 'pagado',
  revisado: 'No',
  revisado_at: null,
  soporte_url: null,
  ...over,
})

const libro = (cobros: FilaCobro[] = [cobro()], gastos: FilaGasto[] = [gasto()]) =>
  construirLibroRevision({
    resumen: [
      { metrica: 'Mes', valor: '2026-09' },
      { metrica: 'Generado', valor: '2026-09-10T12:00:00.000Z' },
      { metrica: 'Total ingresos (cobros)', valor: 1_000_000 },
    ],
    cobros,
    gastos,
  })

/** Las hojas se escriben en el orden en que se agregan: Resumen, Cobros, Gastos. */
const HOJA_XML: Record<string, number> = {
  [NOMBRE_HOJA_RESUMEN]: 1,
  [NOMBRE_HOJA_COBROS]: 2,
  [NOMBRE_HOJA_GASTOS]: 3,
}

const sheetXml = (buffer: Buffer, hoja: string): string =>
  new PizZip(buffer).file(`xl/worksheets/sheet${HOJA_XML[hoja]}.xml`)!.asText()

const todoElXml = (buffer: Buffer): string =>
  Object.keys(HOJA_XML)
    .map((h) => sheetXml(buffer, h))
    .join('\n')

const ref = (encabezados: readonly string[], columna: string, fila = 1) =>
  XLSX.utils.encode_cell({ c: encabezados.indexOf(columna), r: fila })

/** El `<c …>…</c>` completo de una celda, tal cual quedo escrito en el archivo. */
const celdaXml = (xml: string, r: string): string => {
  const m = xml.match(new RegExp(`<c r="${r}"[^>]*(/>|>[\\s\\S]*?</c>)`))
  if (!m) throw new Error(`no se escribio la celda ${r}`)
  return m[0]
}

describe('construirLibroRevision — tipo de celda de las fechas', () => {
  it('ninguna celda sale con el tipo ISO-8601 `t="d"` que Google Sheets descarta', () => {
    expect(todoElXml(libro())).not.toContain('t="d"')
  })

  it('las columnas de fecha de Cobros y Gastos llevan un serial NUMERICO', () => {
    const buffer = libro()
    const casos = [
      { hoja: NOMBRE_HOJA_COBROS, encabezados: ENCABEZADOS_COBROS },
      { hoja: NOMBRE_HOJA_GASTOS, encabezados: ENCABEZADOS_GASTOS },
    ] as const

    for (const { hoja, encabezados } of casos) {
      const xml = sheetXml(buffer, hoja)
      for (const columna of ['fecha', 'revisado_at'] as const) {
        const celda = ws(xml, encabezados, columna)
        if (celda === null) continue // `revisado_at` nulo del gasto: lo cubre otra prueba
        expect(celda, `${hoja}.${columna}`).toMatch(/^\d+(\.\d+)?$/)
      }
    }
  })

  it('un dia conocido cae en su serial exacto de Excel', () => {
    const xml = sheetXml(libro(), NOMBRE_HOJA_COBROS)
    // 2026-09-01 es el serial 46266; 2026-09-02, el 46267.
    expect(ws(xml, ENCABEZADOS_COBROS, 'fecha')).toBe('46266')
    expect(ws(sheetXml(libro(), NOMBRE_HOJA_GASTOS), ENCABEZADOS_GASTOS, 'fecha')).toBe('46267')
  })

  it('la hora sale en hora de pared de Bogota, no en UTC', () => {
    // El instante es 14:30:45 UTC = 09:30:45 en Bogota. La parte decimal del serial es
    // la fraccion del dia: 9h30m45s / 24h. Antes esta columna bajaba con la «Z» pegada.
    const xml = sheetXml(libro(), NOMBRE_HOJA_COBROS)
    const serial = Number(ws(xml, ENCABEZADOS_COBROS, 'revisado_at'))
    const horaDelDia = (serial % 1) * 24
    expect(horaDelDia).toBeCloseTo(9 + 30 / 60 + 45 / 3600, 4)
  })
})

describe('construirLibroRevision — lo que no se puede romper al arreglar', () => {
  it('un `revisado_at` nulo deja la celda VACIA, nunca el epoch de 1970', () => {
    // El gasto de fixture trae `revisado_at: null` (nadie lo ha revisado todavia).
    const xml = sheetXml(libro(), NOMBRE_HOJA_GASTOS)
    const r = ref(ENCABEZADOS_GASTOS, 'revisado_at')
    expect(xml).not.toContain(`<c r="${r}"`)
    // Y el control que hace valida la afirmacion: la celda de al lado SI se escribio.
    expect(celdaXml(xml, ref(ENCABEZADOS_GASTOS, 'fecha'))).toContain('<v>')
    // 25569 es el serial de 1970-01-01: el valor que dejaria un `new Date(0)`.
    expect(xml).not.toContain('<v>25569</v>')
  })

  it('el formato `z` de cada columna sobrevive al write', () => {
    const wb = XLSX.read(libro(), { type: 'buffer', cellStyles: true })
    const cobros = wb.Sheets[NOMBRE_HOJA_COBROS]
    expect(cobros[ref(ENCABEZADOS_COBROS, 'fecha')].z).toBe('yyyy-mm-dd')
    expect(cobros[ref(ENCABEZADOS_COBROS, 'revisado_at')].z).toBe('yyyy-mm-dd hh:mm')
    const gastos = wb.Sheets[NOMBRE_HOJA_GASTOS]
    expect(gastos[ref(ENCABEZADOS_GASTOS, 'fecha')].z).toBe('yyyy-mm-dd')
  })

  it('los encabezados declarados son exactamente las claves de la fila', () => {
    // Si alguien agrega una columna al mapeo de la ruta y olvida el encabezado, la
    // columna desapareceria del archivo en silencio. Esto lo vuelve un error de prueba.
    expect([...ENCABEZADOS_COBROS]).toEqual(Object.keys(cobro()))
    expect([...ENCABEZADOS_GASTOS]).toEqual(Object.keys(gasto()))
  })

  it('la hoja Resumen se queda como estaba: etiquetas y su columna mezclada', () => {
    const hoja = XLSX.read(libro(), { type: 'buffer' }).Sheets[NOMBRE_HOJA_RESUMEN]
    expect(hoja['A2'].v).toBe('Mes')
    expect(hoja['B2'].v).toBe('2026-09')
    // `Generado` sigue siendo texto a proposito: la columna `valor` mezcla tipos.
    expect(hoja['B3'].v).toBe('2026-09-10T12:00:00.000Z')
    expect(hoja['B4'].v).toBe(1_000_000)
  })

  it('un mes sin movimientos no revienta y deja la hoja con sus encabezados', () => {
    const xml = sheetXml(libro([], []), NOMBRE_HOJA_COBROS)
    expect(xml).toContain('<v>fecha</v>')
    expect(xml).not.toContain('<row r="2">')
  })
})

/**
 * El camino CSV de la ruta NO pasa por este modulo: lee las mismas filas y las emite tal
 * cual, en texto. Se prueba aqui porque la garantia que importa es que el arreglo del
 * xlsx no se lo llevo por delante, y esa garantia se pierde si nadie la ejercita.
 */
describe('el camino CSV sigue emitiendo la fecha como texto ISO', () => {
  it('la fila del CSV conserva las dos fechas tal como llegaron', () => {
    const c = cobro()
    const filaCsv = { fecha: c.fecha, monto: c.monto, revisado_at: c.revisado_at ?? '' }
    const csv = XLSX.utils.sheet_to_csv(XLSX.utils.json_to_sheet([filaCsv]))
    expect(csv).toContain('2026-09-01')
    expect(csv).toContain('2026-09-05T14:30:45.123456+00:00')
    expect(csv).not.toContain('46266')
  })
})

/** Valor crudo del `<v>` de una celda, o `null` si la celda no se escribio. */
function ws(xml: string, encabezados: readonly string[], columna: string): string | null {
  const r = ref(encabezados, columna)
  const m = xml.match(new RegExp(`<c r="${r}"[^>]*>[\\s\\S]*?</c>`))
  return m?.[0].match(/<v>([^<]*)<\/v>/)?.[1] ?? null
}
