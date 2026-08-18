import { describe, it, expect } from 'vitest'
import { bloqueCobrosCompleto, cobradoConfirmado } from './saldo-negocio'

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
