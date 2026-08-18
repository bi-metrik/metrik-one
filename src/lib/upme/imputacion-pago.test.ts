import { describe, it, expect } from 'vitest'
import { escalonesDelNegocio, imputarPago } from './imputacion-pago'

// V0109 real: honorario $510.000, tarifa confirmada $870.094.
const V0109 = escalonesDelNegocio(510_000, 870_094, 2)
// Plan 1 (50/50) tipico: honorario $637.500, tarifa $701.812.
const PLAN1 = escalonesDelNegocio(637_500, 701_812, 1)

describe('escalonesDelNegocio', () => {
  it('plan 2 (pago unico) exige el honorario completo por adelantado', () => {
    expect(V0109).toEqual({ techoTramo1: 510_000, techoTarifa: 870_094, techoTramo2: 0 })
  })

  it('plan 1 parte el honorario por la mitad, con la tarifa en medio', () => {
    expect(PLAN1).toEqual({ techoTramo1: 318_750, techoTarifa: 701_812, techoTramo2: 318_750 })
  })
})

describe('imputarPago', () => {
  it('LA REGLA: el honorario va primero, no la tarifa', () => {
    // El caso que motivo el cambio. Con la regla vieja (tarifa primero) estos
    // $510.000 eran tarifa completa y el honorario quedaba en cero.
    const r = imputarPago({ pago: 510_000, escalones: V0109 })
    expect(r.a_tramo1).toBe(510_000)
    expect(r.a_tarifa).toBe(0)
    expect(r.honorario).toBe(510_000)
  })

  it('cubierto el honorario del plan, lo que sigue es tarifa', () => {
    const r = imputarPago({ pago: 1_380_094, escalones: V0109 })
    expect(r.a_tramo1).toBe(510_000)
    expect(r.a_tarifa).toBe(870_094)
    expect(r.excedente).toBe(0)
  })

  it('el segundo pago no vuelve a llenar el tramo que ya estaba cubierto', () => {
    // Sin `consumidoAntes` este pago se imputaria otra vez al honorario.
    const r = imputarPago({ pago: 870_094, escalones: V0109, consumidoAntes: 510_000 })
    expect(r.a_tramo1).toBe(0)
    expect(r.a_tarifa).toBe(870_094)
  })

  it('plan 50/50: anticipo, despues tarifa, despues el resto del honorario', () => {
    const primero = imputarPago({ pago: 1_020_562, escalones: PLAN1 })
    expect(primero.a_tramo1).toBe(318_750)
    expect(primero.a_tarifa).toBe(701_812)
    expect(primero.a_tramo2).toBe(0)

    const segundo = imputarPago({ pago: 318_750, escalones: PLAN1, consumidoAntes: 1_020_562 })
    expect(segundo.a_tramo2).toBe(318_750)
    expect(segundo.honorario).toBe(318_750)
  })

  it('un pago parcial que no alcanza el anticipo es todo honorario', () => {
    const r = imputarPago({ pago: 100_000, escalones: PLAN1 })
    expect(r.a_tramo1).toBe(100_000)
    expect(r.a_tarifa).toBe(0)
  })

  it('lo que pasa de los tres escalones es excedente, no honorario del servicio', () => {
    const r = imputarPago({ pago: 2_000_000, escalones: V0109 })
    expect(r.a_tramo1).toBe(510_000)
    expect(r.a_tarifa).toBe(870_094)
    expect(r.excedente).toBe(619_906)
    // El atajo `honorario` incluye el excedente: es plata del cliente, no de la UPME.
    expect(r.honorario).toBe(510_000 + 619_906)
  })

  it('un negocio sin tarifa confirmada imputa todo a honorario', () => {
    const sinTarifa = escalonesDelNegocio(500_000, 0, 2)
    const r = imputarPago({ pago: 500_000, escalones: sinTarifa })
    expect(r.a_tarifa).toBe(0)
    expect(r.honorario).toBe(500_000)
  })

  it('no lanza con basura: pago negativo, techos nulos', () => {
    const r = imputarPago({ pago: -5, escalones: escalonesDelNegocio(0, 0, null) })
    expect(r).toMatchObject({ a_tramo1: 0, a_tarifa: 0, a_tramo2: 0, excedente: 0 })
  })

  it('la suma de las cuatro porciones es siempre el pago', () => {
    for (const pago of [1, 318_750, 500_000, 1_020_562, 1_380_094, 3_000_000]) {
      const r = imputarPago({ pago, escalones: PLAN1 })
      expect(r.a_tramo1 + r.a_tarifa + r.a_tramo2 + r.excedente).toBeCloseTo(pago, 2)
    }
  })
})
