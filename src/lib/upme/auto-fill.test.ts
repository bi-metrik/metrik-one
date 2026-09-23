import { describe, it, expect } from 'vitest'
import { aplicarComputedAutoFill } from './auto-fill'
import { calcularTarifaUpmePorAnio } from './tarifa'

// El pre-llenado de la tarifa UPME lee el valor sin IVA de la Factura. Su parser propio
// quitaba el punto de miles solo si lo seguían tres dígitos y un no-dígito, así que con
// coma decimal se equivocaba por mil. Ahora pasa por `parseMontoCop`.
describe('aplicarComputedAutoFill — tarifa_upme', () => {
  const tarifa = (raw: unknown) => aplicarComputedAutoFill('tarifa_upme', raw, { anio: 2026 })

  it('miles con punto y decimales con coma', () => {
    // Antes: 98.500 pesos (el segundo punto quedaba como decimal).
    expect(tarifa('$ 98.500.000,00')).toBe(calcularTarifaUpmePorAnio(98500000, 2026))
  })

  // CONTROL: los formatos que ya leía bien siguen dando lo mismo.
  it('los formatos que ya se leían bien no cambian', () => {
    const esperada = calcularTarifaUpmePorAnio(98500000, 2026)
    expect(tarifa('$ 98.500.000')).toBe(esperada)
    expect(tarifa('98500000')).toBe(esperada)
    expect(tarifa(98500000)).toBe(esperada)
    expect(tarifa('98,500,000')).toBe(esperada)
  })

  it('sin valor positivo no pre-llena', () => {
    expect(tarifa('')).toBeUndefined()
    expect(tarifa(null)).toBeUndefined()
    expect(tarifa('pendiente')).toBeUndefined()
    expect(tarifa('0')).toBeUndefined()
    expect(tarifa('-98.500.000')).toBeUndefined()
  })
})
