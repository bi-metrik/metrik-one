import { describe, expect, it } from 'vitest'

import { cabeOtraMarca, categoriaAlMarcar, cuadrosDelHotel, cuadrosDeLaPestana, portadaDeLaPestana } from './galeria'
import type { FotoVista, OpcionFoto } from './vista'

const opcion = (id: string, categoria: OpcionFoto['categoria'], fuente: OpcionFoto['fuente'] = 'wikimedia'): OpcionFoto => ({
  id,
  fuente,
  miniatura: `https://mini/${id}.jpg`,
  ancho: 400,
  alto: 300,
  titulo: id,
  credito: fuente === 'wikimedia' ? 'Autora · CC BY-SA 4.0' : 'hotel.example',
  pagina: `https://commons.wikimedia.org/wiki/${id}`,
  categoria,
})

const foto = (id: string, over: Partial<FotoVista> = {}): FotoVista => ({
  id,
  url: `https://firmada/${id}.jpg`,
  principal: false,
  posicion: 1,
  origen: 'wikimedia',
  fuente: 'Autora · CC BY-SA 4.0',
  fuenteUrl: null,
  revisada: true,
  seImprime: true,
  categoria: null,
  fuenteId: null,
  ...over,
})

const OPCIONES = [opcion('F1', 'fachada'), opcion('H1', 'habitacion'), opcion('H2', 'habitacion'), opcion('Z1', 'zonas_comunes'), opcion('S1', null)]

describe('la galería del hotel: hasta 3 marcadas, de cualquier categoría', () => {
  it('dos habitaciones y una fachada: el número es el orden de la biblioteca (la principal primero)', () => {
    const fotos = [
      foto('a', { principal: true, fuenteId: 'H2', categoria: 'habitacion' }),
      foto('b', { posicion: 2, fuenteId: 'F1', categoria: 'fachada' }),
      foto('c', { posicion: 3, fuenteId: 'H1', categoria: 'habitacion' }),
    ]
    const cuadros = cuadrosDelHotel(OPCIONES, fotos)
    // Marcar no mueve la cuadrícula: siguen en el orden de las opciones.
    expect(cuadros.map((c) => [c.clave, c.marca])).toEqual([
      ['opcion:F1', 2],
      ['opcion:H1', 3],
      ['opcion:H2', 1],
      ['opcion:Z1', null],
      ['opcion:S1', null],
    ])
    expect(cuadros.find((c) => c.marca === 1)).toMatchObject({ principal: true, fotoId: 'a', imagen: 'https://firmada/a.jpg' })
    expect(cuadrosDeLaPestana(cuadros, 'habitacion').propios.map((c) => c.marca)).toEqual([3, 1])
    expect(cabeOtraMarca(fotos)).toBe(false)
    expect(cabeOtraMarca(fotos.slice(0, 2))).toBe(true)
  })

  it('una subida (o de antes) que no está entre las opciones sale primero, marcada, con su crédito vacío', () => {
    const cuadros = cuadrosDelHotel(OPCIONES, [foto('p', { principal: true, origen: 'asesora', fuente: null, categoria: 'zonas_comunes' })])
    expect(cuadros[0]).toMatchObject({ clave: 'foto:p', marca: 1, principal: true, origen: 'asesora', credito: null, opcion: null })
    expect(cuadrosDeLaPestana(cuadros, 'zonas_comunes').propios.map((c) => c.clave)).toEqual(['foto:p', 'opcion:Z1'])
  })

  it('cada pestaña: lo suyo y, aparte, lo sin clasificar; «Todas» junta todo', () => {
    const cuadros = cuadrosDelHotel(OPCIONES, [foto('v', { principal: true, origen: 'asesora', categoria: null })])
    const fachada = cuadrosDeLaPestana(cuadros, 'fachada')
    expect(fachada.propios.map((c) => c.clave)).toEqual(['opcion:F1'])
    expect(fachada.sinClasificar.map((c) => c.clave)).toEqual(['foto:v', 'opcion:S1'])
    const todas = cuadrosDeLaPestana(cuadros, 'todas')
    expect(todas.propios).toHaveLength(6)
    expect(todas.sinClasificar).toEqual([])
  })

  it('la portada de la pestaña es lo marcado de esa categoría; si no hay, la primera', () => {
    const cuadros = cuadrosDelHotel(OPCIONES, [foto('a', { principal: true, fuenteId: 'H2', categoria: 'habitacion' })])
    expect(portadaDeLaPestana(cuadros, 'habitacion')).toBe('https://firmada/a.jpg')
    expect(portadaDeLaPestana(cuadros, 'todas')).toBe('https://firmada/a.jpg')
    expect(portadaDeLaPestana(cuadros, 'zonas_comunes')).toBe('https://mini/Z1.jpg')
    expect(portadaDeLaPestana(cuadrosDelHotel([], []), 'fachada')).toBeNull()
  })

  it('la categoría al marcar: la del modelo; si no la hay, la de la pestaña; en «Todas», ninguna', () => {
    expect(categoriaAlMarcar({ categoria: 'habitacion' }, 'fachada')).toBe('habitacion')
    expect(categoriaAlMarcar({ categoria: null }, 'zonas_comunes')).toBe('zonas_comunes')
    expect(categoriaAlMarcar({ categoria: null }, 'todas')).toBeNull()
    expect(categoriaAlMarcar(null, 'habitacion')).toBe('habitacion')
  })

  it('el crédito de Commons viaja a cada cuadro (autor y licencia)', () => {
    const cuadros = cuadrosDelHotel(OPCIONES, [])
    expect(cuadros.every((c) => c.credito === 'Autora · CC BY-SA 4.0')).toBe(true)
  })
})
