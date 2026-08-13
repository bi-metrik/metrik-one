import { describe, it, expect } from 'vitest'
import { digitosFecha } from './formulario-1668'

describe('digitosFecha (casilla 24 del 1668)', () => {
  it('convierte ISO a los digitos corridos que se reparten por casilla', () => {
    expect(digitosFecha('2026-08-12')).toBe('20260812')
  })

  it('acepta lo que quedo escrito como DD/MM/AAAA y lo REORDENA', () => {
    // Es el formato con el que se estampaba antes del 2026-08-12: si se pasara tal
    // cual a las casillas, el ano caeria en el grupo del dia.
    expect(digitosFecha('12/08/2026')).toBe('20260812')
    expect(digitosFecha('12-08-2026')).toBe('20260812')
  })

  it('ignora la hora que traiga un ISO completo', () => {
    expect(digitosFecha('2026-08-12T10:30:00Z')).toBe('20260812')
  })

  it('sin fecha, no dibuja nada', () => {
    expect(digitosFecha(null)).toBeNull()
    expect(digitosFecha('')).toBeNull()
  })

  it('un formato que no se reconoce NO se adivina', () => {
    // En un documento que va a la DIAN, una casilla vacia es mejor que una fecha
    // inventada a partir de un texto que nadie sabe leer.
    expect(digitosFecha('12 de agosto de 2026')).toBeNull()
    expect(digitosFecha('2026/08/12')).toBeNull()
  })

  it('el resultado son 8 digitos exactos, listos para 4+2+2 casillas', () => {
    const d = digitosFecha('2026-01-05')
    expect(d).toBe('20260105')
    expect(d).toHaveLength(8)
  })
})
