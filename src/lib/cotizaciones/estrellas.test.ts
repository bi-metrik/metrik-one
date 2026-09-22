import { describe, expect, it } from 'vitest'

import { busquedaDeCategoria, estrellasDesdeTexto } from './estrellas'

describe('qué cuenta como categoría', () => {
  it('las formas en que se escribe una categoría entera', () => {
    expect(estrellasDesdeTexto('3')).toBe(3)
    expect(estrellasDesdeTexto('5*')).toBe(5)
    expect(estrellasDesdeTexto('Hotel 4 estrellas')).toBe(4)
    expect(estrellasDesdeTexto('Categoría 3')).toBe(3)
    expect(estrellasDesdeTexto('3 stars')).toBe(3)
    expect(estrellasDesdeTexto('★★★★☆')).toBe(4)
  })

  it('media estrella o una nota de reseña NO se redondea: no es categoría', () => {
    expect(estrellasDesdeTexto('4,5')).toBeNull()
    expect(estrellasDesdeTexto('4.5/5')).toBeNull()
    expect(estrellasDesdeTexto('8,6 Excelente')).toBeNull()
  })

  it('fuera de 1 a 5, dos números distintos o nada: vacío', () => {
    expect(estrellasDesdeTexto('0')).toBeNull()
    expect(estrellasDesdeTexto('6')).toBeNull()
    expect(estrellasDesdeTexto('3 o 4 estrellas')).toBeNull()
    expect(estrellasDesdeTexto('')).toBeNull()
    expect(estrellasDesdeTexto(null)).toBeNull()
  })
})

describe('el enlace para buscar la categoría', () => {
  it('arma una búsqueda normal con el hotel y la ciudad', () => {
    expect(busquedaDeCategoria('DECAMERON PANACA', 'Quimbaya')).toBe(
      'https://www.google.com/search?q=DECAMERON%20PANACA%20Quimbaya%20categor%C3%ADa%20estrellas',
    )
  })
  it('sin nombre de hotel no hay nada que buscar', () => {
    expect(busquedaDeCategoria(null, 'Quimbaya')).toBeNull()
    expect(busquedaDeCategoria('  ', null)).toBeNull()
  })
})
