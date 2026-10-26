import { describe, expect, it } from 'vitest'

import { esCategoria } from './categoria'

describe('categorías de las fotos de hotel', () => {
  it('solo las cuatro categorías valen', () => {
    expect(esCategoria('habitacion')).toBe(true)
    expect(esCategoria('otra')).toBe(true)
    expect(esCategoria('no_es_hotel')).toBe(false)
    expect(esCategoria(null)).toBe(false)
  })
})
