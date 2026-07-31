import { describe, it, expect } from 'vitest'
import { aplicaSaltoPorSaldo, debeSaltarPorSaldo } from './salto-etapa'

describe('qué etapas participan del salto', () => {
  it('sin flag, se comporta como hasta ahora: solo las de cobro', () => {
    expect(aplicaSaltoPorSaldo({ stage: 'cobro', config_extra: {} })).toBe(true)
    expect(aplicaSaltoPorSaldo({ stage: 'venta', config_extra: {} })).toBe(false)
    expect(aplicaSaltoPorSaldo({ stage: 'ejecucion', config_extra: null })).toBe(false)
    expect(aplicaSaltoPorSaldo(null)).toBe(false)
  })

  // Pago UPME: la financiera PAGA a la UPME. Su stage es 'cobro' porque describe quién
  // ejecuta, no porque ahí se le cobre al cliente.
  it('el flag en falso protege una etapa de cobro (Pago UPME)', () => {
    expect(
      aplicaSaltoPorSaldo({ stage: 'cobro', config_extra: { saltar_si_saldo_cero: false } }),
    ).toBe(false)
  })

  // Precobro: gestión comercial. Si ya pagó, no hay nada que precobrar.
  it('el flag en verdadero habilita una etapa que no es de cobro (Precobro)', () => {
    expect(
      aplicaSaltoPorSaldo({ stage: 'venta', config_extra: { saltar_si_saldo_cero: true } }),
    ).toBe(true)
  })

  // Una config a medio escribir no debe cambiar el comportamiento en silencio.
  it('un flag que no es booleano se ignora', () => {
    expect(
      aplicaSaltoPorSaldo({ stage: 'venta', config_extra: { saltar_si_saldo_cero: 'true' } }),
    ).toBe(false)
    expect(
      aplicaSaltoPorSaldo({ stage: 'cobro', config_extra: { saltar_si_saldo_cero: 0 } }),
    ).toBe(true)
  })
})

describe('cuándo el saldo justifica el salto', () => {
  it('sin precio no salta nunca', () => {
    expect(debeSaltarPorSaldo(0, 0, false)).toBe(false)
    expect(debeSaltarPorSaldo(0, -500, false)).toBe(false)
  })

  it('con saldo pendiente no salta', () => {
    expect(debeSaltarPorSaldo(637500, 300000, false)).toBe(false)
    expect(debeSaltarPorSaldo(637500, 300000, true)).toBe(false)
  })

  it('sin conciliación, cualquier saldo cubierto salta', () => {
    expect(debeSaltarPorSaldo(637500, 0, false)).toBe(true)
    expect(debeSaltarPorSaldo(637500, -701812, false)).toBe(true)
  })

  // Caso V0121: el cobro de la tarifa UPME ($701.812) dejó el saldo en negativo y eso
  // hacía que el motor se saltara justamente la etapa de Pago UPME.
  it('con conciliación, el sobrepago entra en vez de pasar de largo', () => {
    expect(debeSaltarPorSaldo(637500, -701812, true)).toBe(false)
  })

  it('con conciliación, solo el pago exacto salta', () => {
    expect(debeSaltarPorSaldo(637500, 0, true)).toBe(true)
  })
})
