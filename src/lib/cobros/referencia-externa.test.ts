import { describe, it, expect } from 'vitest'
import {
  construirRefExterna,
  esRefExterna,
  normalizarRefExterna,
  referenciaVisible,
} from './referencia-externa'

describe('normalizarRefExterna', () => {
  it('recorta, colapsa espacios y pasa a mayusculas', () => {
    expect(normalizarRefExterna('  cons  99a 12 ')).toBe('CONS 99A 12')
  })

  it('devuelve null cuando viene vacia o solo espacios', () => {
    expect(normalizarRefExterna('')).toBeNull()
    expect(normalizarRefExterna('   ')).toBeNull()
    expect(normalizarRefExterna(null)).toBeNull()
    expect(normalizarRefExterna(undefined)).toBeNull()
  })

  it('quita el prefijo EXT- si la persona lo teclea a mano', () => {
    expect(normalizarRefExterna('EXT-9912345')).toBe('9912345')
    expect(normalizarRefExterna('ext-9912345')).toBe('9912345')
  })
})

describe('construirRefExterna', () => {
  it('prefija la referencia escrita a mano', () => {
    expect(construirRefExterna('9912345')).toBe('EXT-9912345')
  })

  it('no duplica el prefijo', () => {
    expect(construirRefExterna('EXT-9912345')).toBe('EXT-9912345')
  })

  it('devuelve null sin referencia (el caller cae a la autogenerada)', () => {
    expect(construirRefExterna('  ')).toBeNull()
  })

  it('nunca produce una referencia que pueda pasar por una de ePayco (numerica pura)', () => {
    const ref = construirRefExterna('9912345')!
    expect(/^\d+$/.test(ref)).toBe(false)
  })
})

describe('esRefExterna / referenciaVisible', () => {
  it('reconoce la referencia escrita a mano y la muestra sin el prefijo interno', () => {
    expect(esRefExterna('EXT-9912345')).toBe(true)
    expect(referenciaVisible('EXT-9912345')).toBe('9912345')
  })

  it('deja intacta una referencia de ePayco o la autogenerada', () => {
    expect(esRefExterna('9912345')).toBe(false)
    expect(referenciaVisible('9912345')).toBe('9912345')
    expect(referenciaVisible('FUERA-EPAYCO-20260727-A1B2C3')).toBe('FUERA-EPAYCO-20260727-A1B2C3')
  })

  it('tolera null/undefined', () => {
    expect(esRefExterna(null)).toBe(false)
    expect(referenciaVisible(undefined)).toBe('')
  })
})
