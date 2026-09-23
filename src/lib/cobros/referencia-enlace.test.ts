import { describe, it, expect } from 'vitest'
import { cobroDeReferencia, referenciaEnlaceCobro } from './referencia-enlace'

describe('referencia del enlace de pago', () => {
  const cobro = '0f8e2f4a-1c2b-4d5e-9f00-112233445566'

  it('lleva el cobro, cabe en 60, solo usa [A-Za-z0-9-] y vuelve al mismo cobro', () => {
    const ref = referenciaEnlaceCobro(cobro, 1761063334000)
    expect(ref).toBe('ONE-0f8e2f4a1c2b4d5e9f00112233445566-1761063334000')
    expect(ref.length).toBeLessThanOrEqual(60)
    expect(ref).toMatch(/^[A-Za-z0-9-]+$/)
    expect(cobroDeReferencia(ref)).toBe(cobro)
  })

  it('dos enlaces del mismo cobro: referencias distintas, mismo cobro', () => {
    const a = referenciaEnlaceCobro(cobro, 1761063334000)
    const b = referenciaEnlaceCobro(cobro, 1761063334001)
    expect(a).not.toBe(b)
    expect(cobroDeReferencia(a)).toBe(cobroDeReferencia(b))
  })

  it('una referencia ajena no es de ONE', () => {
    expect(cobroDeReferencia('WEB-ORD-009876')).toBeNull()
    expect(cobroDeReferencia('LNK_H7S4XXXX')).toBeNull()
    expect(cobroDeReferencia(null)).toBeNull()
  })
})
