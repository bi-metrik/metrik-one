import { describe, it, expect } from 'vitest'
import { bloqueCobrosCompleto, cobradoConfirmado, resumenDeCobro } from './saldo-negocio'

describe('cobradoConfirmado', () => {
  it('una cuota programada sin fecha NO es plata recibida', () => {
    const total = cobradoConfirmado([
      { monto: 500_000, fecha: '2026-08-01' },
      { monto: 300_000, fecha: null },
    ])
    expect(total).toBe(500_000)
  })

  it('un cobro anulado suma 0 y no resucita su valor', () => {
    // En una fila anulada `monto` vale 0 y el original vive en `monto_anulado`.
    // Aqui se usa `monto` a proposito.
    expect(cobradoConfirmado([{ monto: 0, fecha: '2026-08-01' }])).toBe(0)
  })

  it('un monto no numerico no envenena el total', () => {
    expect(cobradoConfirmado([{ monto: null, fecha: '2026-08-01' }, { monto: 100, fecha: '2026-08-02' }])).toBe(100)
  })
})

describe('bloqueCobrosCompleto', () => {
  it('el caso real: pago el honorario pero NO la tarifa UPME, el bloque NO esta completo', () => {
    // V0109: honorario $510.000 pagado, tarifa confirmada $870.094 sin pagar.
    // El motor viejo comparaba contra el honorario pelado y lo daba por completo.
    expect(bloqueCobrosCompleto({ valorARecaudar: 510_000 + 870_094, cobrado: 510_000 })).toBe(false)
  })

  it('pagado todo lo que debe: completo', () => {
    expect(bloqueCobrosCompleto({ valorARecaudar: 1_380_094, cobrado: 1_380_094 })).toBe(true)
  })

  it('un sobrepago tambien deja el bloque completo', () => {
    expect(bloqueCobrosCompleto({ valorARecaudar: 1_000_000, cobrado: 1_200_000 })).toBe(true)
  })

  it('un residuo dentro del piso de materialidad no retiene el bloque', () => {
    // Misma vara que los gates y el motor de avance: $1.000 (decision de Carmen).
    expect(bloqueCobrosCompleto({ valorARecaudar: 1_000_000, cobrado: 999_100 })).toBe(true)
    expect(bloqueCobrosCompleto({ valorARecaudar: 1_000_000, cobrado: 998_900 })).toBe(false)
  })

  it('sin precio no hay nada que dar por completo', () => {
    expect(bloqueCobrosCompleto({ valorARecaudar: 0, cobrado: 0 })).toBe(false)
    expect(bloqueCobrosCompleto({ valorARecaudar: -5, cobrado: 0 })).toBe(false)
  })
})

describe('resumenDeCobro («Total cobrado» del resumen y del cierre)', () => {
  // Caso sintético: viaje de $4.052.000 con anticipo pagado, dos cuotas programadas sin
  // pagar y un pago anulado que traía retención de IVA.
  const cobros = [
    { monto: 1_216_000, fecha: '2026-10-14', retencion_iva: 0 },
    { monto: 2_026_000, fecha: null, retencion_iva: 0 }, // cuota programada
    { monto: 810_000, fecha: null, retencion_iva: 0 }, // cuota programada
    { monto: 0, fecha: '2026-10-15', retencion_iva: 50_000, anulado_at: '2026-10-16T10:00:00Z' }, // anulado
  ]

  it('solo cuenta lo que entró: ni cuotas programadas ni pagos anulados', () => {
    expect(resumenDeCobro(cobros, 4_052_000)).toEqual({ totalCobrado: 1_216_000, porCobrar: 2_836_000 })
  })

  it('la retención de IVA de un pago vivo sí cuenta como cobrada', () => {
    expect(resumenDeCobro([{ monto: 950_000, fecha: '2026-10-14', retencion_iva: 50_000 }], 1_000_000))
      .toEqual({ totalCobrado: 1_000_000, porCobrar: 0 })
  })

  it('sin ningún pago, todo está por cobrar aunque haya plan', () => {
    expect(resumenDeCobro(cobros.slice(1, 3), 4_052_000)).toEqual({ totalCobrado: 0, porCobrar: 4_052_000 })
  })

  it('un sobrepago no deja «Por cobrar» negativo', () => {
    expect(resumenDeCobro([{ monto: 1_200_000, fecha: '2026-10-14' }], 1_000_000))
      .toEqual({ totalCobrado: 1_200_000, porCobrar: 0 })
  })

  it('sin precio, «Por cobrar» es 0', () => {
    expect(resumenDeCobro([], null)).toEqual({ totalCobrado: 0, porCobrar: 0 })
  })
})
