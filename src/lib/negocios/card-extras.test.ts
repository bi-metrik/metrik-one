import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  columnasExtra,
  leerCamposExtra,
  paresDeCamposExtra,
  resolverExtras,
  slugsDeCamposExtra,
  textoExtra,
  type LectorPorSlug,
} from './card-extras'

/**
 * Campos extra de la tarjeta y del Excel (`negocio_card.campos_extra`).
 *
 * La configuración de las pruebas de resolución se LEE de la migración de SOENA, no se
 * reescribe aquí: si alguien quita el `solo_si` del segundo titular en la migración, la
 * prueba del «único con RUT 2 que sobró» cae. Mismo criterio que `tipos.test.ts`.
 */

const MIGRACION = 'supabase/migrations/20260925150000_soena_titularidad_tarjeta_y_excel.sql'
const configSoena = (): unknown => JSON.parse(readFileSync(MIGRACION, 'utf8').split('$campos_extra$')[1])

/** Un negocio de mentira: slug → campo → valor, como lo entrega la RPC ya traducida. */
const lector =
  (datos: Record<string, Record<string, string>>): LectorPorSlug =>
  (slug, field) =>
    datos[slug]?.[field] ?? null

describe('leerCamposExtra', () => {
  it('sin `campos_extra` no hay campos (el caso de todo workspace que no lo configura)', () => {
    expect(leerCamposExtra(undefined)).toEqual([])
    expect(leerCamposExtra({ cedula_bloque: 'RUT' })).toEqual([])
    expect(leerCamposExtra({ campos_extra: 'no es lista' })).toEqual([])
  })

  it('descarta entradas sin label, slug o campo', () => {
    const campos = leerCamposExtra({
      campos_extra: [
        { label: '', source_bloque_slug: 'a', field: 'b' },
        { label: 'X', field: 'b' },
        { label: 'Bueno', source_bloque_slug: 'a', field: 'b' },
      ],
    })
    expect(campos.map((c) => c.label)).toEqual(['Bueno'])
  })

  it('una línea de detalle con `solo_si` mal escrito se descarta, no se muestra sin condición', () => {
    const [campo] = leerCamposExtra({
      campos_extra: [
        {
          label: 'T',
          source_bloque_slug: 'a',
          field: 'b',
          detalle: [
            { source_bloque_slug: 'r', field: 'n' },
            { source_bloque_slug: 'r2', field: 'n', solo_si: { source_bloque_slug: 'a' } },
          ],
        },
      ],
    })
    expect(campo.detalle).toEqual([{ source_bloque_slug: 'r', field: 'n' }])
  })
})

describe('la titularidad de SOENA (configuración de la migración)', () => {
  const campos = leerCamposExtra({ campos_extra: configSoena() })

  it('copropiedad (V0286): la modalidad y los dos titulares', () => {
    const extras = resolverExtras(
      campos,
      lector({
        titularidad: { modalidad_solicitante: 'copropiedad' },
        rut: { razon_social: 'CASTRILLON CASTAÑO ARLEY GIOVANNI' },
        rut_solicitante_2: { razon_social: 'SALAZAR HERRERA ISABEL CRISTINA' },
      }),
    )
    expect(extras.map(textoExtra)).toEqual([
      'Copropiedad · CASTRILLON CASTAÑO ARLEY GIOVANNI, SALAZAR HERRERA ISABEL CRISTINA',
    ])
  })

  it('único: un solo titular', () => {
    const extras = resolverExtras(
      campos,
      lector({ titularidad: { modalidad_solicitante: 'unico' }, rut: { razon_social: 'ANA PÉREZ' } }),
    )
    expect(extras.map(textoExtra)).toEqual(['Único · ANA PÉREZ'])
  })

  it('único con un RUT 2 que sobró de cuando era copropiedad: NO muestra el segundo', () => {
    const extras = resolverExtras(
      campos,
      lector({
        titularidad: { modalidad_solicitante: 'unico' },
        rut: { razon_social: 'ANA PÉREZ' },
        rut_solicitante_2: { razon_social: 'LUIS GÓMEZ' },
      }),
    )
    expect(extras.map(textoExtra)).toEqual(['Único · ANA PÉREZ'])
  })

  it('leasing con RUT 2 cargado tampoco lo muestra', () => {
    const extras = resolverExtras(
      campos,
      lector({
        titularidad: { modalidad_solicitante: 'leasing' },
        rut: { razon_social: 'ANA PÉREZ' },
        rut_solicitante_2: { razon_social: 'LUIS GÓMEZ' },
      }),
    )
    expect(extras.map(textoExtra)).toEqual(['Leasing · ANA PÉREZ'])
  })

  it('sin modalidad respondida no hay etiqueta (la lista no pinta «Sin definir»)', () => {
    expect(resolverExtras(campos, lector({ rut: { razon_social: 'ANA PÉREZ' } }))).toEqual([])
  })

  it('la condición no distingue mayúsculas ni tildes', () => {
    const extras = resolverExtras(
      campos,
      lector({
        titularidad: { modalidad_solicitante: 'Copropiedad' },
        rut: { razon_social: 'A' },
        rut_solicitante_2: { razon_social: 'B' },
      }),
    )
    expect(extras[0].detalle).toEqual(['A', 'B'])
  })

  it('pide a la RPC también el campo de la condición', () => {
    const pares = paresDeCamposExtra(
      campos,
      new Map([
        ['titularidad', ['Titularidad']],
        ['rut', ['RUT']],
        ['rut_solicitante_2', ['RUT solicitante 2']],
      ]),
    )
    expect(pares).toEqual(
      expect.arrayContaining([
        { bloque: 'Titularidad', campo: 'modalidad_solicitante' },
        { bloque: 'RUT', campo: 'razon_social' },
        { bloque: 'RUT solicitante 2', campo: 'razon_social' },
      ]),
    )
    expect(slugsDeCamposExtra(campos).sort()).toEqual(['rut', 'rut_solicitante_2', 'titularidad'])
  })

  it('un slug que no existe en el workspace no aporta pares', () => {
    expect(paresDeCamposExtra(campos, new Map())).toEqual([])
  })

  it('en el Excel: «Titularidad» y «Titulares»', () => {
    expect(columnasExtra(campos, []).map((c) => c.encabezado)).toEqual(['Titularidad', 'Titulares'])
  })
})

describe('columnasExtra', () => {
  it('un encabezado que choca con uno fijo se numera', () => {
    const campos = leerCamposExtra({
      campos_extra: [{ label: 'Servicio', source_bloque_slug: 'a', field: 'b', detalle: [{ source_bloque_slug: 'c', field: 'd' }] }],
    })
    expect(columnasExtra(campos, ['Servicio']).map((c) => c.encabezado)).toEqual([
      'Servicio (2)',
      'Servicio (detalle)',
    ])
  })

  it('sin detalle declarado no hay columna de detalle', () => {
    const campos = leerCamposExtra({ campos_extra: [{ label: 'X', source_bloque_slug: 'a', field: 'b' }] })
    expect(columnasExtra(campos, []).map((c) => c.encabezado)).toEqual(['X'])
  })
})
