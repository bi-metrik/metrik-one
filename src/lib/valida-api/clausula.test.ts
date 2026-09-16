import { describe, expect, it } from 'vitest'
import { extraerClausula } from './clausula'

// Misma forma de encabezados que los términos de 4D SOFT v1.0 (`## 8. Confidencialidad`), con un
// cuerpo sintético.
const TERMINOS = [
  '# Términos de Uso',
  '',
  '## 7. Disponibilidad y soporte',
  '',
  '7.1. Texto de disponibilidad.',
  '',
  '## 8. Confidencialidad',
  '',
  '8.1. Es Información Confidencial toda información no pública.',
  '',
  '8.2. La Parte receptora la usará solo para ejecutar estos Términos.',
  '',
  '## 9. Propiedad intelectual',
  '',
  '9.1. Texto de propiedad intelectual.',
].join('\n')

describe('extraerClausula', () => {
  it('saca la cláusula 8 completa, sin la 9', () => {
    const c = extraerClausula(TERMINOS, 8)
    expect(c).toContain('## 8. Confidencialidad')
    expect(c).toContain('8.2. La Parte receptora')
    expect(c).not.toContain('Propiedad intelectual')
    expect(c).not.toContain('Disponibilidad')
  })

  it('no confunde la 1 con la 10: el número se compara entero', () => {
    const texto = '## 1. Objeto\n\ntexto uno\n\n## 10. Encargo\n\ntexto diez'
    expect(extraerClausula(texto, 1)).toBe('## 1. Objeto\n\ntexto uno')
    expect(extraerClausula(texto, 10)).toBe('## 10. Encargo\n\ntexto diez')
  })

  it('si la cláusula no existe devuelve null, no una tarjeta vacía', () => {
    expect(extraerClausula(TERMINOS, 12)).toBeNull()
    expect(extraerClausula('', 8)).toBeNull()
  })

  it('la última cláusula llega hasta el final del texto', () => {
    expect(extraerClausula(TERMINOS, 9)).toBe('## 9. Propiedad intelectual\n\n9.1. Texto de propiedad intelectual.')
  })
})
