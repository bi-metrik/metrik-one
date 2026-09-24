import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import * as XLSX from 'xlsx'
import { describe, expect, it } from 'vitest'
import { leerCamposExtra } from './card-extras'
import { construirLibroNegocios, NOMBRE_HOJA } from './export-excel-libro'
import {
  ENCABEZADOS,
  armarFilasExcel,
  encabezadosExcel,
  type EntradaExcel,
  type NegocioExportable,
} from './export-excel'

/**
 * Las columnas extra del Excel de negocios (`negocio_card.campos_extra`).
 *
 * Dos promesas: (1) un workspace SIN la configuración recibe el mismo libro de siempre,
 * con los mismos encabezados en el mismo orden; (2) uno CON ella recibe una columna por
 * campo y otra por su detalle, DESPUÉS de las fijas.
 */

const negocio = (p: Partial<NegocioExportable> & Pick<NegocioExportable, 'id'>): NegocioExportable => ({
  codigo: 'V0001', nombre: 'Negocio', empresa_nombre: null, contacto_nombre: 'Ana',
  contacto_telefono: null, cedula: null, stage_actual: 'venta', etapa_stage: 'venta',
  etapa_nombre: 'Propuesta', estado: 'abierto', razon_cierre: null, created_at: null,
  closed_at: null, origen: null, aliado_nombre: null, es_meta_lead: false, servicio_label: null,
  seccional_label: null, ciudad_label: null, vehiculo_label: null, radicado: null,
  numero_factura: null, fecha_cita: null, precio_aprobado: null, precio_estimado: null,
  horas_habiles_en_etapa: null, etapa_sla_horas: null, sla_exceso_horas: null, reproceso: null,
  marcas: [], pausado: false, pausado_hasta: null, motivo_pausa: null,
  ...p,
})

const entrada = (negocios: NegocioExportable[], extra: Partial<EntradaExcel> = {}): EntradaExcel => ({
  negocios, valores: [], ventas: [], bonificables: [], comerciales: [], tramos: [],
  cobros: [], operaciones: [], staff: [], baseUrl: 'https://soena.metrikone.co', ...extra,
})

const MIGRACION = 'supabase/migrations/20260925150000_soena_titularidad_tarjeta_y_excel.sql'
const camposSoena = () =>
  leerCamposExtra({ campos_extra: JSON.parse(readFileSync(MIGRACION, 'utf8').split('$campos_extra$')[1]) })

const encabezadosDelLibro = (buffer: Buffer): string[] => {
  const hoja = XLSX.read(buffer, { type: 'buffer' }).Sheets[NOMBRE_HOJA]
  return (XLSX.utils.sheet_to_json(hoja, { header: 1 })[0] as string[]) ?? []
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex')

describe('sin campos extra el Excel es el de siempre', () => {
  it('los encabezados son exactamente los fijos', () => {
    expect(encabezadosExcel([])).toEqual([...ENCABEZADOS])
    expect(encabezadosExcel()).toEqual([...ENCABEZADOS])
  })

  it('las filas no ganan columnas y el libro sale byte a byte igual', () => {
    // `extras` presente en el negocio pero SIN configuración: no debe filtrarse al libro.
    const n = negocio({
      id: 'n1',
      extras: [{ indice: 0, label: 'Titularidad', valor: 'Único', detalle: ['ANA'] }],
    })
    const [sinConfig] = armarFilasExcel(entrada([n]))
    const [configVacia] = armarFilasExcel(entrada([n], { camposExtra: [] }))
    expect(Object.keys(sinConfig)).toEqual([...ENCABEZADOS])
    expect(configVacia).toEqual(sinConfig)
    const libroDeSiempre = construirLibroNegocios([sinConfig])
    expect(encabezadosDelLibro(libroDeSiempre)).toEqual([...ENCABEZADOS])
    expect(sha(construirLibroNegocios([configVacia], encabezadosExcel([])))).toBe(sha(libroDeSiempre))
  })
})

describe('con la titularidad de SOENA', () => {
  const camposExtra = camposSoena()

  it('agrega «Titularidad» y «Titulares» después de las columnas fijas', () => {
    const cols = encabezadosExcel(camposExtra)
    expect(cols.slice(0, ENCABEZADOS.length)).toEqual([...ENCABEZADOS])
    expect(cols.slice(ENCABEZADOS.length)).toEqual(['Titularidad', 'Titulares'])
  })

  it('llena las celdas desde los extras del negocio y deja vacío al que no tiene dato', () => {
    const filas = armarFilasExcel(
      entrada(
        [
          negocio({
            id: 'n1',
            extras: [{ indice: 0, label: 'Titularidad', valor: 'Copropiedad', detalle: ['ANA', 'LUIS'] }],
          }),
          negocio({ id: 'n2', extras: [] }),
        ],
        { camposExtra },
      ),
    )
    expect(filas[0]['Titularidad']).toBe('Copropiedad')
    expect(filas[0]['Titulares']).toBe('ANA, LUIS')
    expect(filas[1]['Titularidad']).toBeNull()
    expect(filas[1]['Titulares']).toBeNull()

    const libro = construirLibroNegocios(filas, encabezadosExcel(camposExtra))
    const hoja = XLSX.read(libro, { type: 'buffer' }).Sheets[NOMBRE_HOJA]
    const datos = XLSX.utils.sheet_to_json<Record<string, unknown>>(hoja)
    expect(datos[0]['Titulares']).toBe('ANA, LUIS')
    expect(encabezadosDelLibro(libro).slice(-2)).toEqual(['Titularidad', 'Titulares'])
  })
})

describe('el cableado (contratos sobre el fuente)', () => {
  const leer = (ruta: string) => readFileSync(ruta, 'utf8')

  it('el export pasa los campos extra a las filas Y los encabezados al libro', () => {
    const fuente = leer('src/lib/negocios/construir-export-negocios.ts')
    expect(fuente).toContain('leerCamposExtra(')
    expect(fuente).toMatch(/armarFilasExcel\(\{[\s\S]*camposExtra,[\s\S]*\}\)/)
    expect(fuente).toContain('construirLibroNegocios(filas, encabezadosExcel(camposExtra))')
  })

  it('la lista pide los pares extra en la MISMA llamada a la RPC y expone `extras`', () => {
    const fuente = leer('src/app/(app)/negocios/negocio-v2-actions.ts')
    const cardPares = fuente.slice(fuente.indexOf('const cardPares = paresDeCampos(['))
    expect(cardPares.slice(0, cardPares.indexOf('if (cardPares.length > 0'))).toContain('paresDeCamposExtra(camposExtra, nombresPorSlug)')
    expect(fuente).toContain('extrasPorNeg[negId] = resolverExtras(camposExtra')
    expect(fuente).toContain('extras: extrasPorNeg[id] ?? []')
    // Una sola RPC de campos para toda la lista: nada de consultas por negocio.
    expect(fuente.match(/rpc\('negocio_bloques_campos_json'/g)?.length).toBe(1)
  })
})
