/**
 * Serializacion del Excel de revision: filas -> libro .xlsx (buffer).
 *
 * Vive aparte de la ruta (`api/revision/export`) por la misma razon que su hermano de
 * negocios (`lib/negocios/export-excel-libro.ts`): el defecto que trajo este modulo aqui
 * NO se ve en las filas —siempre fueron las mismas— sino en el XML que sale del `write`.
 * Una prueba que reconstruyera el libro por su cuenta no tumbaria una regresion de la
 * ruta; probando ESTA funcion, si.
 *
 * La ruta sigue leyendo de Supabase y armando las filas; aqui solo se serializan.
 *
 * ⚠️ Las filas entran con las fechas como TEXTO (`fecha` en `YYYY-MM-DD`, `revisado_at`
 * en ISO con zona) y es a proposito: el camino CSV de la misma ruta las emite tal cual, y
 * cambiarles el tipo en origen lo romperia. La conversion a `Date` ocurre aqui, en la
 * capa que serializa, que es la unica que la necesita.
 */
import * as XLSX from 'xlsx'
import { fechaExcel } from '@/lib/negocios/export-excel'

export const NOMBRE_HOJA_RESUMEN = 'Resumen'
export const NOMBRE_HOJA_COBROS = 'Cobros'
export const NOMBRE_HOJA_GASTOS = 'Gastos'

/** Formato de la columna de dia (`gastos.fecha`, `cobros.fecha`: columnas `date`). */
export const FORMATO_FECHA = 'yyyy-mm-dd'
/** Formato de la columna de instante (`revisado_at`: `timestamptz`). */
export const FORMATO_FECHA_HORA = 'yyyy-mm-dd hh:mm'

export interface FilaGasto {
  fecha: string
  codigo_negocio: string | null
  empresa: string | null
  categoria: string | null
  clasificacion: string | null
  descripcion: string | null
  monto: number
  retencion: number
  deducible: string
  tercero_nit: string | null
  estado_pago: string | null
  revisado: string
  revisado_at: string | null
  soporte_url: string | null
}

export interface FilaCobro {
  fecha: string
  codigo_negocio: string | null
  empresa: string | null
  descripcion: string | null
  monto: number
  retencion: number
  tercero_nit: string | null
  revisado: string
  revisado_at: string | null
}

/** Hoja de etiquetas: una columna `valor` de tipos mezclados (mes, cifras, disclaimer). */
export interface FilaResumen {
  metrica: string
  valor: string | number
}

/**
 * Orden de las columnas de cada hoja.
 *
 * Se declaran explicitamente (y no se dejan al recorrido que hace `json_to_sheet`) por
 * dos razones: fijan el orden que ya tenia el archivo, y dan el indice con el que se
 * localiza cada columna de fecha para ponerle su formato. `satisfies` hace que un nombre
 * mal escrito no compile.
 */
export const ENCABEZADOS_COBROS = [
  'fecha',
  'codigo_negocio',
  'empresa',
  'descripcion',
  'monto',
  'retencion',
  'tercero_nit',
  'revisado',
  'revisado_at',
] as const satisfies readonly (keyof FilaCobro)[]

export const ENCABEZADOS_GASTOS = [
  'fecha',
  'codigo_negocio',
  'empresa',
  'categoria',
  'clasificacion',
  'descripcion',
  'monto',
  'retencion',
  'deducible',
  'tercero_nit',
  'estado_pago',
  'revisado',
  'revisado_at',
  'soporte_url',
] as const satisfies readonly (keyof FilaGasto)[]

/** Columna de dia y columna de instante, comunes a las dos hojas de movimientos. */
const COLUMNA_FECHA = 'fecha'
const COLUMNA_FECHA_HORA = 'revisado_at'

type ConFechas<T> = Omit<T, 'fecha' | 'revisado_at'> & {
  fecha: Date | null
  revisado_at: Date | null
}

/**
 * Arma la hoja de una lista de movimientos con sus dos fechas como fecha de verdad.
 *
 * ⚠️⚠️ `cellDates: true` va SOLO en `json_to_sheet`, NUNCA en `XLSX.write`.
 *
 * Aqui hace falta para que un `Date` quede como celda de fecha y no como texto. En el
 * `write` hace otra cosa: escribe la celda con el tipo ISO-8601 del OOXML
 * (`<c t="d"><v>2026-09-01T00:00:00.000Z</v></c>`), que Excel soporta y que el importador
 * de Google Sheets DESCARTA en silencio — el archivo abre bien y las columnas de fecha
 * salen VACIAS. Es exactamente el defecto que corrigio el PR #623 en el Excel de negocios.
 * Sin el, la celda sale como serial numerico (`<v>46266</v>`) mas el formato `z` que se
 * asigna abajo, y eso lo leen Excel, Google Sheets y LibreOffice por igual.
 *
 * ⚠️ Y `cellDates` por si solo no arregla nada: medido el 2026-09-10 con `xlsx@0.18.5`,
 * ponerlo en `json_to_sheet` dejando las filas como texto produce un XML **identico** al
 * de no ponerlo. Lo que convierte la celda es el `Date`; la opcion solo decide como se
 * guarda ese `Date`. Por eso las fechas se parsean ANTES, con `fechaExcel`.
 */
function hojaDeMovimientos<T extends { fecha: string; revisado_at: string | null }>(
  filas: readonly T[],
  encabezados: readonly (keyof T & string)[],
): XLSX.WorkSheet {
  const conFechas: ConFechas<T>[] = filas.map((fila) => ({
    ...fila,
    fecha: fechaExcel(fila.fecha),
    revisado_at: fechaExcel(fila.revisado_at),
  }))

  const ws = XLSX.utils.json_to_sheet(conFechas, {
    header: [...encabezados],
    cellDates: true,
  })

  const formatoPorColumna = new Map<number, string>([
    [encabezados.indexOf(COLUMNA_FECHA as keyof T & string), FORMATO_FECHA],
    [encabezados.indexOf(COLUMNA_FECHA_HORA as keyof T & string), FORMATO_FECHA_HORA],
  ])

  for (let r = 1; r <= filas.length; r++) {
    for (const [c, formato] of formatoPorColumna) {
      if (c < 0) continue
      const celda = ws[XLSX.utils.encode_cell({ c, r })]
      // Una fecha ausente (`fechaExcel` devuelve `null`) tiene que quedar como celda
      // VACIA, nunca como el epoch de 1970. Sale gratis y esta medido: `json_to_sheet`
      // le deja un hueco (`t: 'z'`, `v: null`) y el `write` NO lo emite al XML, tenga o
      // no formato. Por eso no hace falta saltarsela aqui — se probo quitando esta linea
      // y ninguna prueba cambio. Lo que fija esa garantia es la prueba, no esta guarda.
      if (celda) celda.z = formato
    }
  }

  return ws
}

/**
 * Arma el libro de tres hojas y devuelve el buffer .xlsx.
 *
 * La hoja `Resumen` se serializa tal cual: es una lista de etiquetas con una columna
 * `valor` de tipos mezclados (`'2026-09'`, cifras, un disclaimer), asi que convertir su
 * fila `Generado` a fecha no aportaria nada y ensuciaria una columna que no es de fechas.
 *
 * El tipo de retorno lo AFIRMA esta funcion: `XLSX.write` esta declarado `any`, y con
 * `type: 'buffer'` devuelve un Buffer de node. Es el generico que `BodyInit` acepta.
 */
export function construirLibroRevision(datos: {
  resumen: readonly FilaResumen[]
  cobros: readonly FilaCobro[]
  gastos: readonly FilaGasto[]
}): Buffer<ArrayBuffer> {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet([...datos.resumen]), NOMBRE_HOJA_RESUMEN)
  XLSX.utils.book_append_sheet(
    wb,
    hojaDeMovimientos(datos.cobros, ENCABEZADOS_COBROS),
    NOMBRE_HOJA_COBROS,
  )
  XLSX.utils.book_append_sheet(
    wb,
    hojaDeMovimientos(datos.gastos, ENCABEZADOS_GASTOS),
    NOMBRE_HOJA_GASTOS,
  )
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' })
}
