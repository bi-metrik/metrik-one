import { describe, expect, it } from 'vitest'
import { claveValida, jsonEstable, nuevaClave, resultadoEsFalla } from './clave'

describe('clave de intención', () => {
  it('una clave nueva es válida y no se repite', () => {
    const a = nuevaClave()
    const b = nuevaClave()
    expect(claveValida(a)).toBe(true)
    expect(a).not.toBe(b)
  })

  it('rechaza lo que no tiene la forma (la acción corre sin protección)', () => {
    for (const x of [undefined, null, 3, '', 'corta', 'con espacios aqui!!', 'x'.repeat(65)]) {
      expect(claveValida(x)).toBe(false)
    }
  })

  it('JSON estable: el orden de las llaves no cambia la huella; undefined se ignora', () => {
    expect(jsonEstable({ b: 1, a: [1, { d: 2, c: 3 }] })).toBe(jsonEstable({ a: [1, { c: 3, d: 2 }], b: 1 }))
    expect(jsonEstable({ a: 1, b: undefined })).toBe(jsonEstable({ a: 1 }))
    expect(jsonEstable({ a: 1 })).not.toBe(jsonEstable({ a: 2 }))
  })

  it('reconoce las tres formas de falla del producto', () => {
    expect(resultadoEsFalla({ error: 'x' })).toBe(true)
    expect(resultadoEsFalla({ ok: false })).toBe(true)
    expect(resultadoEsFalla({ success: false, error: 'y' })).toBe(true)
    expect(resultadoEsFalla({ error: null })).toBe(false)
    expect(resultadoEsFalla({ success: true })).toBe(false)
    expect(resultadoEsFalla({ ok: true, error: '' })).toBe(false)
    expect(resultadoEsFalla(undefined)).toBe(false)
  })
})
