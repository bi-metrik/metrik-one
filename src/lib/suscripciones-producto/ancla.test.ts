import { describe, expect, it } from 'vitest'
import { anclaDeFila, anclaDeLlave, columnasDeAncla, filtrarPorAncla, idsPorTipo, llaveDeAncla, llaveDeFila } from './ancla'

describe('el ancla del contrato', () => {
  it('sale de la fila: negocio O suscripción, nunca las dos ni ninguna', () => {
    expect(anclaDeFila({ negocio_id: 'n1', suscripcion_id: null })).toEqual({ tipo: 'negocio', id: 'n1' })
    expect(anclaDeFila({ negocio_id: null, suscripcion_id: 's1' })).toEqual({ tipo: 'suscripcion', id: 's1' })
    expect(anclaDeFila({ negocio_id: 'n1' })).toEqual({ tipo: 'negocio', id: 'n1' })
    expect(anclaDeFila({ negocio_id: 'n1', suscripcion_id: 's1' })).toBeNull()
    expect(anclaDeFila({ negocio_id: null, suscripcion_id: null })).toBeNull()
    expect(anclaDeFila(null)).toBeNull()
  })

  it('va y vuelve como llave de texto', () => {
    const a = { tipo: 'suscripcion', id: 'abc' } as const
    expect(llaveDeAncla(a)).toBe('suscripcion:abc')
    expect(anclaDeLlave('suscripcion:abc')).toEqual(a)
    expect(anclaDeLlave('negocio:n')).toEqual({ tipo: 'negocio', id: 'n' })
    expect(anclaDeLlave('otra:n')).toBeNull()
    expect(llaveDeFila({ negocio_id: 'n' })).toBe('negocio:n')
    expect(llaveDeFila({})).toBeNull()
  })

  it('da las columnas del INSERT y el filtro de la consulta', () => {
    expect(columnasDeAncla({ tipo: 'negocio', id: 'n' })).toEqual({ negocio_id: 'n', suscripcion_id: null })
    expect(columnasDeAncla({ tipo: 'suscripcion', id: 's' })).toEqual({ negocio_id: null, suscripcion_id: 's' })
    const llamadas: [string, unknown][] = []
    const q = { eq: (c: string, v: unknown) => (llamadas.push([c, v]), q) }
    filtrarPorAncla(q, { tipo: 'suscripcion', id: 's' })
    expect(llamadas).toEqual([['suscripcion_id', 's']])
  })

  it('separa los ids por tipo, sin repetir', () => {
    expect(
      idsPorTipo([
        { tipo: 'negocio', id: 'a' },
        { tipo: 'suscripcion', id: 'b' },
        { tipo: 'negocio', id: 'a' },
      ]),
    ).toEqual({ negocios: ['a'], suscripciones: ['b'] })
  })
})
