import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { construirLibroNegocios } from './export-excel-libro'
import { ENCABEZADOS, type FilaExcel } from './export-excel'

/**
 * Contrato: la tabla de negocios se genera en UN solo sitio.
 *
 * Hay dos superficies que entregan el mismo dato — la descarga
 * (`POST /api/negocios/export`) y la subida a Drive (`subirExportNegociosADrive`) — y el
 * requisito del frente es que entreguen el MISMO archivo, no dos que se parecen.
 *
 * El riesgo no es teorico ni raro: es lo que pasa siempre que alguien arregla una
 * columna. Si cada superficie arma su libro por su cuenta, el arreglo entra en una y no
 * en la otra, y el equipo queda mirando dos verdades del mismo dia sin forma de saber
 * cual. Y no falla: las dos abren bien.
 *
 * Por eso estas pruebas miran el CODIGO FUENTE y no el resultado. Una prueba de
 * comportamiento no puede distinguir «las dos llaman a la misma funcion» de «las dos
 * tienen la misma copia»: hoy darian identico en los dos casos, y el segundo se rompe
 * solo con el tiempo. Es el mismo motivo por el que `tipos.test.ts` lee el archivo de
 * migracion en vez de consultar la base.
 */

const leer = (ruta: string) => readFileSync(ruta, 'utf8')

const RUTA_DESCARGA = 'src/app/api/negocios/export/route.ts'
const RUTA_DRIVE = 'src/app/(app)/negocios/exportar-drive-actions.ts'

describe('el Excel de negocios se arma en un solo sitio', () => {
  it('las dos superficies llaman a `construirExportNegocios`', () => {
    for (const ruta of [RUTA_DESCARGA, RUTA_DRIVE]) {
      expect(leer(ruta), ruta).toContain('construirExportNegocios')
    }
  })

  it('ninguna de las dos arma el libro por su cuenta', () => {
    // `construirLibroNegocios` y `armarFilasExcel` son las dos mitades de la
    // generacion. Si una superficie las invoca directo, ya tiene su propia via.
    for (const ruta of [RUTA_DESCARGA, RUTA_DRIVE]) {
      const fuente = leer(ruta)
      expect(fuente, `${ruta} no debe serializar por su cuenta`).not.toContain(
        'construirLibroNegocios',
      )
      expect(fuente, `${ruta} no debe armar filas por su cuenta`).not.toContain(
        'armarFilasExcel',
      )
    }
  })

  it('las dos exigen el MISMO permiso', () => {
    // Ni mas ni menos: es la misma informacion, en el mismo formato, para la misma
    // gente; lo unico que cambia es donde queda. Dos gates distintos sobre el mismo
    // dato se desincronizan y producen un boton que aparece y falla.
    for (const ruta of [RUTA_DESCARGA, RUTA_DRIVE]) {
      expect(leer(ruta), ruta).toContain('puedeDescargarNegocios')
    }
  })

  it('las dos validan los ids con el mismo helper', () => {
    for (const ruta of [RUTA_DESCARGA, RUTA_DRIVE]) {
      expect(leer(ruta), ruta).toContain('leerIdsExport')
    }
  })
})

describe('el reclamo del archivo se clasifica en un solo sitio', () => {
  /**
   * El defecto que esto congela: la accion preguntaba `typeof ganador === 'string' && …`
   * y mandaba todo lo demas —incluido el `null` de un reclamo que no escribio nada— al
   * `else` del camino feliz. No fallaba: entregaba un enlace bueno con el id sin
   * guardar, y el clic siguiente creaba otra hoja.
   *
   * Igual que los contratos de arriba, esto mira el FUENTE: una prueba de comportamiento
   * no distingue «la accion usa el helper» de «la accion tiene su propia copia de la
   * regla», y la segunda se vuelve a romper sola.
   */
  it('la accion clasifica con `interpretarReclamo`', () => {
    // Se busca la LLAMADA, no el nombre: un comentario que mencione el helper satisface
    // un `toContain('interpretarReclamo')` sin que nadie lo invoque (comprobado: con esa
    // forma, la mutacion que reponia la clasificacion a mano dejaba esta prueba verde).
    expect(leer(RUTA_DRIVE)).toContain('interpretarReclamo(ganador')
  })

  it('la accion NO vuelve a mirar el tipo del id a mano', () => {
    expect(leer(RUTA_DRIVE), 'la clasificacion vive en el helper puro').not.toContain(
      'typeof ganador',
    )
  })
})

describe('el libro es reproducible', () => {
  /**
   * Lo que hace que «el mismo archivo» sea una afirmacion literal y no una manera de
   * hablar. Si `XLSX.write` metiera una marca de tiempo (varias librerias de OOXML lo
   * hacen en `docProps/core.xml`), dos llamadas seguidas darian bytes distintos y lo
   * unico que se podria prometer seria «el mismo contenido».
   *
   * Medido el 2026-09-10 con `xlsx@0.18.5`: los dos buffers dan el mismo sha256.
   */
  it('dos llamadas con la misma entrada dan bytes identicos', () => {
    const filas: FilaExcel[] = [
      {
        ...(Object.fromEntries(ENCABEZADOS.map((h) => [h, null])) as FilaExcel),
        Codigo: 'V0001',
        'Creado el': new Date(Date.UTC(2026, 0, 15)),
      } as FilaExcel,
    ]
    const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')
    expect(sha(construirLibroNegocios(filas))).toBe(sha(construirLibroNegocios(filas)))
  })
})
