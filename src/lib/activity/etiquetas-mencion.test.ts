import { describe, expect, it } from 'vitest'
import { etiquetasDeMencion } from './etiquetas-mencion'

describe('etiquetasDeMencion', () => {
  it('la lista de activity_menciones manda, sin repetir', () => {
    expect(etiquetasDeMencion({ mencion: { full_name: 'Beto' }, menciones: ['Beto', 'Carla', '@operaciones', 'Beto'] }))
      .toEqual(['Beto', 'Carla', '@operaciones'])
  })
  it('un comentario nuevo (mencion_id null) muestra sus menciones', () => {
    expect(etiquetasDeMencion({ mencion: null, menciones: ['Carla'] })).toEqual(['Carla'])
  })
  it('un comentario viejo sin filas nuevas muestra su mencion_id', () => {
    expect(etiquetasDeMencion({ mencion: { full_name: 'Beto' }, menciones: [] })).toEqual(['Beto'])
    expect(etiquetasDeMencion({ mencion: { full_name: 'Beto' } })).toEqual(['Beto'])
  })
  it('sin menciones, nada', () => {
    expect(etiquetasDeMencion({ mencion: null, menciones: [] })).toEqual([])
  })
})
