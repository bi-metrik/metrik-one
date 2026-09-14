import { describe, it, expect } from 'vitest'
import {
  MENSAJE_NIT_CON_DV_PEGADO,
  nitConDvPegadoEnFormulario,
  separarSondas,
  sondasDeIdentificacion,
  type CampoFuenteMinimo,
} from './guarda-nit-formulario'

/**
 * Fixtures con la forma exacta de `campos_fuente` en producción (SOENA, 2026-09-14):
 *  - `formulario_dian` (010): la casilla `nit` sale de `rut.nit`.
 *  - `formulario_1668`: la casilla se llama `numero_identificacion`, y TAMBIÉN sale de
 *    `rut.nit`. Por eso la guarda decide por la fuente, no por el nombre de la casilla.
 */
const RUT = { bloque_slug: 'rut', etapa_orden: 6, bloque_orden: 2, tipo: 'ai' }

const F010: CampoFuenteMinimo[] = [
  { slug: 'nit', source: { ...RUT, campo_slug: 'nit' } },
  { slug: 'dv', source: { ...RUT, campo_slug: 'dv' } },
  { slug: 'primer_apellido', source: { ...RUT, campo_slug: 'primer_apellido' } },
]

const F1668: CampoFuenteMinimo[] = [
  { slug: 'numero_identificacion', source: { ...RUT, campo_slug: 'nit' } },
  { slug: 'dv', source: { ...RUT, campo_slug: 'dv' } },
]

describe('sondasDeIdentificacion', () => {
  it('pide la casilla 26 del mismo bloque de cada NIT', () => {
    expect(sondasDeIdentificacion('formulario-010', F010)).toEqual([
      {
        slug: '__identificacion_de__nit',
        optional: true,
        source: { ...RUT, campo_slug: 'numero_identificacion', campos_slug: undefined },
      },
    ])
  })

  it('en el 1668 también, aunque la casilla se llame distinto', () => {
    expect(sondasDeIdentificacion('formulario-1668', F1668).map((s) => s.slug))
      .toEqual(['__identificacion_de__numero_identificacion'])
  })

  it('otros templates no piden nada', () => {
    expect(sondasDeIdentificacion('declaracion-juramentada', F010)).toEqual([])
  })
})

describe('separarSondas', () => {
  it('saca las sondas de los datos que se imprimen', () => {
    const datos: Record<string, string | null> = { nit: '52217225', __identificacion_de__nit: '52217225' }
    expect(separarSondas(datos)).toEqual({ __identificacion_de__nit: '52217225' })
    expect(datos).toEqual({ nit: '52217225' })
  })
})

describe('nitConDvPegadoEnFormulario', () => {
  const sondas010 = { __identificacion_de__nit: '52217225' }

  it('frena el 010 con el DV pegado', () => {
    expect(nitConDvPegadoEnFormulario('formulario-010', F010, { nit: '522172252' }, sondas010))
      .toBe(MENSAJE_NIT_CON_DV_PEGADO)
  })

  it('frena el 1668 con el DV pegado', () => {
    expect(
      nitConDvPegadoEnFormulario(
        'formulario-1668',
        F1668,
        { numero_identificacion: '167270579' },
        { __identificacion_de__numero_identificacion: '16727057' },
      ),
    ).toBe(MENSAJE_NIT_CON_DV_PEGADO)
  })

  it('deja pasar el NIT limpio', () => {
    expect(nitConDvPegadoEnFormulario('formulario-010', F010, { nit: '52217225' }, sondas010)).toBeNull()
  })

  it('mira lo que se va a imprimir: un override que corrige el NIT deja pasar', () => {
    // datosFinal ya trae el override aplicado por quien llama.
    expect(nitConDvPegadoEnFormulario('formulario-010', F010, { nit: '52217225' }, sondas010)).toBeNull()
  })

  it('y un override que PEGA el DV a mano también se frena', () => {
    expect(nitConDvPegadoEnFormulario('formulario-010', F010, { nit: '522172252' }, sondas010))
      .toBe(MENSAJE_NIT_CON_DV_PEGADO)
  })

  it('sin identificación no adivina', () => {
    expect(nitConDvPegadoEnFormulario('formulario-010', F010, { nit: '522172252' }, {})).toBeNull()
  })

  it('un NIT de empresa limpio que cumple la trampa (Bancolombia) no se frena', () => {
    expect(
      nitConDvPegadoEnFormulario('formulario-010', F010, { nit: '890903938' }, { __identificacion_de__nit: null }),
    ).toBeNull()
  })

  it('otros templates no se frenan', () => {
    expect(nitConDvPegadoEnFormulario('relacion-facturas', F010, { nit: '522172252' }, sondas010)).toBeNull()
  })
})
