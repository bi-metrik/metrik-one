import { describe, it, expect } from 'vitest'
import { cuentasReparto } from './reparto-en-pantalla'

const MOTIVO = 'el comercial partió la referencia equivocada'

describe('cuentasReparto', () => {
  it('una línea con plata y sin negocio NO cuenta como asignada y bloquea guardar', () => {
    const c = cuentasReparto({
      pagoOriginal: 1_000_000,
      lineas: [
        { negocioId: 'n-1', monto: 600_000, porDevolver: false },
        { negocioId: '', monto: 400_000, porDevolver: false },
      ],
      motivo: MOTIVO,
    })
    expect(c.totalAsignado).toBe(600_000)
    expect(c.sinAsignar).toBe(400_000)
    expect(c.lineasSinNegocio).toBe(1)
    expect(c.puedeGuardar).toBe(false)
  })

  it('una línea vacía (sin negocio y sin plata) no bloquea', () => {
    const c = cuentasReparto({
      pagoOriginal: 1_000_000,
      lineas: [
        { negocioId: 'n-1', monto: 1_000_000, porDevolver: false },
        { negocioId: '', monto: 0, porDevolver: false },
      ],
      motivo: MOTIVO,
    })
    expect(c.lineasSinNegocio).toBe(0)
    expect(c.puedeGuardar).toBe(true)
  })

  it('pasarse del pago y el motivo corto siguen bloqueando', () => {
    expect(cuentasReparto({
      pagoOriginal: 1_000_000,
      lineas: [{ negocioId: 'n-1', monto: 1_000_010, porDevolver: false }],
      motivo: MOTIVO,
    }).puedeGuardar).toBe(false)
    expect(cuentasReparto({
      pagoOriginal: 1_000_000,
      lineas: [{ negocioId: 'n-1', monto: 1_000_000, porDevolver: false }],
      motivo: 'corto',
    }).puedeGuardar).toBe(false)
  })
})
