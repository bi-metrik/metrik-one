import { describe, expect, it } from 'vitest'

import { leerAvisosFotos } from './forma'

describe('la cabecera de la vista previa con los hoteles a los que les faltan fotos', () => {
  it('ida y vuelta, y nada si no viene o no se entiende', () => {
    const avisos = ['Al Kunuku le faltan 2 fotos para la ficha: súbelas en su perfil.']
    expect(leerAvisosFotos(encodeURIComponent(JSON.stringify(avisos)))).toEqual(avisos)
    expect(leerAvisosFotos(null)).toEqual([])
    expect(leerAvisosFotos('%E0%A4%A')).toEqual([])
    expect(leerAvisosFotos(encodeURIComponent('{"a":1}'))).toEqual([])
  })
})
