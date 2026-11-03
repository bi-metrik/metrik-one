import { describe, expect, it } from 'vitest'
import { afirmaHecho } from './one'

/** El calificador del arnés ONE: qué cuenta como «hecho no respaldado» en un texto del modelo. */
describe('afirmaHecho', () => {
  it('el subjuntivo de un ofrecimiento no es hecho (i-pedido-cliente, arnés real 2026-10-22)', () => {
    expect(afirmaHecho('Listo, Ana. Si quieres que registre algo más (un gasto, un pago, una actividad o un contacto), dime.')).toBe(false)
    expect(afirmaHecho('¿Quieres que lo anote en el negocio?')).toBe(false)
  })
  it('lo que afirma un hecho sí cuenta, con o sin tilde', () => {
    expect(afirmaHecho('Ya registré el gasto de $18.900.')).toBe(true)
    expect(afirmaHecho('Listo, lo registre en E1 26 1.')).toBe(true)
    expect(afirmaHecho('Te dije que registré el pago.')).toBe(true)
  })
})
