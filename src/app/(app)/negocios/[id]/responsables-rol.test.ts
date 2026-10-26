import { describe, expect, it } from 'vitest'
import { etiquetaRol, ordenarResponsables, textoResponsable } from './responsables-rol'

describe('etiquetaRol', () => {
  it('nombra las dos áreas', () => {
    expect(etiquetaRol('comercial')).toBe('Comercial')
    expect(etiquetaRol('operaciones')).toBe('Operaciones')
  })
  it('sin rol o rol desconocido no inventa etiqueta', () => {
    expect(etiquetaRol(null)).toBeNull()
    expect(etiquetaRol(undefined)).toBeNull()
    expect(etiquetaRol('financiero')).toBeNull()
  })
})

describe('textoResponsable', () => {
  it('antepone el área al nombre completo, sin truncar', () => {
    expect(textoResponsable({ id: 'a', full_name: 'Tatiana Cortés Ramírez', rol: 'comercial' }))
      .toBe('Comercial · Tatiana Cortés Ramírez')
  })
  it('sin rol queda solo el nombre', () => {
    expect(textoResponsable({ id: 'a', full_name: 'Ana Pérez', rol: null })).toBe('Ana Pérez')
  })
})

describe('ordenarResponsables', () => {
  it('comercial, operaciones, sin rol; estable dentro del grupo', () => {
    const lista = [
      { id: 'n1', full_name: 'N1', rol: null },
      { id: 'o1', full_name: 'O1', rol: 'operaciones' },
      { id: 'n2', full_name: 'N2' },
      { id: 'c1', full_name: 'C1', rol: 'comercial' },
    ]
    expect(ordenarResponsables(lista).map((r) => r.id)).toEqual(['c1', 'o1', 'n1', 'n2'])
    expect(lista[0].id).toBe('n1')
  })
})
