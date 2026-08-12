import { describe, it, expect } from 'vitest'
import { planearRedistribucion, requiereSplitId, type PorcionActual } from './redistribucion'

const MOTIVO = 'El comercial partió la referencia equivocada'

function porcion(over: Partial<PorcionActual> & { negocioId: string; monto: number }): PorcionActual {
  return {
    cobroId: `cobro-${over.negocioId}`,
    negocioCodigo: over.negocioId.toUpperCase(),
    negocioFacturado: false,
    ...over,
  }
}

// Los dos casos que existen hoy en producción (medidos el 2026-08-11).
const REPARTO_V0043_V0064 = [
  porcion({ negocioId: 'v0043', monto: 605_625 }),
  porcion({ negocioId: 'v0064', monto: 605_625 }),
]

describe('planearRedistribucion — las cuatro formas del mismo gesto', () => {
  it('reparte una referencia que estaba entera en un solo negocio', () => {
    const plan = planearRedistribucion({
      pagoOriginal: 1_211_250,
      actuales: [porcion({ negocioId: 'v0043', monto: 1_211_250 })],
      destino: [
        { negocioId: 'v0043', monto: 605_625 },
        { negocioId: 'v0064', monto: 605_625 },
      ],
      motivo: MOTIVO,
    })

    expect(plan.ok).toBe(true)
    expect(plan.cambios.find(c => c.negocioId === 'v0043')?.accion).toBe('ajustar')
    expect(plan.cambios.find(c => c.negocioId === 'v0064')?.accion).toBe('crear')
    expect(plan.porcionesResultantes).toBe(2)
    expect(requiereSplitId(plan.porcionesResultantes)).toBe(true)
  })

  it('deshace el reparto y devuelve todo al negocio original', () => {
    const plan = planearRedistribucion({
      pagoOriginal: 1_211_250,
      actuales: REPARTO_V0043_V0064,
      destino: [{ negocioId: 'v0043', monto: 1_211_250 }],
      motivo: MOTIVO,
    })

    expect(plan.ok).toBe(true)
    expect(plan.cambios.find(c => c.negocioId === 'v0064')?.accion).toBe('anular')
    expect(plan.porcionesResultantes).toBe(1)
    // Con una sola porción el reparto dejó de existir: la marca sobra.
    expect(requiereSplitId(plan.porcionesResultantes)).toBe(false)
  })

  it('mueve la referencia completa a otro negocio', () => {
    const plan = planearRedistribucion({
      pagoOriginal: 1_211_250,
      actuales: [porcion({ negocioId: 'v0043', monto: 1_211_250 })],
      destino: [{ negocioId: 'v0099', monto: 1_211_250 }],
      motivo: MOTIVO,
    })

    expect(plan.ok).toBe(true)
    expect(plan.cambios.find(c => c.negocioId === 'v0043')?.accion).toBe('anular')
    expect(plan.cambios.find(c => c.negocioId === 'v0099')?.accion).toBe('crear')
    expect(plan.negociosAfectados).toEqual(expect.arrayContaining(['v0043', 'v0099']))
  })

  it('cambiar solo los montos no toca al que se queda igual', () => {
    const plan = planearRedistribucion({
      pagoOriginal: 1_211_250,
      actuales: REPARTO_V0043_V0064,
      destino: [
        { negocioId: 'v0043', monto: 605_625 },
        { negocioId: 'v0064', monto: 605_625 },
      ],
      motivo: MOTIVO,
    })

    expect(plan.ok).toBe(true)
    expect(plan.cambios.every(c => c.accion === 'sin_cambio')).toBe(true)
    expect(plan.negociosAfectados).toEqual([])
  })
})

describe('planearRedistribucion — lo que no deja pasar', () => {
  it('rechaza repartir más de lo que llegó', () => {
    const plan = planearRedistribucion({
      pagoOriginal: 1_020_000,
      actuales: [porcion({ negocioId: 'v0256', monto: 1_020_000 })],
      destino: [
        { negocioId: 'v0256', monto: 1_020_000 },
        { negocioId: 'v0258', monto: 1_020_000 },
      ],
      motivo: MOTIVO,
    })

    // Es el caso real de la referencia 378962162, corregido a mano el 2026-08-11.
    expect(plan.ok).toBe(false)
    expect(plan.errores.join(' ')).toMatch(/Sobran/)
    expect(plan.sinAsignar).toBeLessThan(0)
  })

  it('deja repartir de menos y lo reporta, sin bloquear', () => {
    const plan = planearRedistribucion({
      pagoOriginal: 1_211_250,
      actuales: REPARTO_V0043_V0064,
      destino: [{ negocioId: 'v0043', monto: 605_625 }],
      motivo: MOTIVO,
    })

    expect(plan.ok).toBe(true)
    expect(plan.sinAsignar).toBe(605_625)
  })

  it('exige motivo escrito', () => {
    const plan = planearRedistribucion({
      pagoOriginal: 1_211_250,
      actuales: REPARTO_V0043_V0064,
      destino: [{ negocioId: 'v0043', monto: 1_211_250 }],
      motivo: 'ajuste',
    })

    expect(plan.ok).toBe(false)
    expect(plan.errores.join(' ')).toMatch(/por qué/)
  })

  it('no deja el mismo negocio en dos líneas', () => {
    const plan = planearRedistribucion({
      pagoOriginal: 1_211_250,
      actuales: [],
      destino: [
        { negocioId: 'v0043', negocioCodigo: 'V0043', monto: 605_625 },
        { negocioId: 'v0043', negocioCodigo: 'V0043', monto: 605_625 },
      ],
      motivo: MOTIVO,
    })

    expect(plan.ok).toBe(false)
    expect(plan.errores.join(' ')).toMatch(/dos veces/)
  })

  it('no deja la referencia sin ningún negocio', () => {
    const plan = planearRedistribucion({
      pagoOriginal: 1_211_250,
      actuales: REPARTO_V0043_V0064,
      destino: [],
      motivo: MOTIVO,
    })

    expect(plan.ok).toBe(false)
    expect(plan.errores.join(' ')).toMatch(/sin ningún negocio/)
  })

  it('rechaza líneas en cero', () => {
    const plan = planearRedistribucion({
      pagoOriginal: 1_211_250,
      actuales: REPARTO_V0043_V0064,
      destino: [
        { negocioId: 'v0043', monto: 1_211_250 },
        { negocioId: 'v0064', monto: 0 },
      ],
      motivo: MOTIVO,
    })

    expect(plan.ok).toBe(false)
    expect(plan.errores.join(' ')).toMatch(/cero o en negativo/)
  })
})

describe('planearRedistribucion — el gate de factura solo aplica a la baja', () => {
  it('no deja quitarle plata a un negocio facturado', () => {
    const plan = planearRedistribucion({
      pagoOriginal: 1_211_250,
      actuales: [
        porcion({ negocioId: 'v0043', monto: 605_625, negocioFacturado: true }),
        porcion({ negocioId: 'v0064', monto: 605_625 }),
      ],
      destino: [
        { negocioId: 'v0043', monto: 300_000 },
        { negocioId: 'v0064', monto: 911_250 },
      ],
      motivo: MOTIVO,
    })

    expect(plan.ok).toBe(false)
    expect(plan.errores.join(' ')).toMatch(/factura emitida/)
  })

  it('tampoco deja quitarle la línea entera', () => {
    const plan = planearRedistribucion({
      pagoOriginal: 1_211_250,
      actuales: [
        porcion({ negocioId: 'v0043', monto: 605_625, negocioFacturado: true }),
        porcion({ negocioId: 'v0064', monto: 605_625 }),
      ],
      destino: [{ negocioId: 'v0064', monto: 1_211_250 }],
      motivo: MOTIVO,
    })

    // Quitar la línea y bajarle el monto son el mismo daño para el soporte de la factura.
    expect(plan.ok).toBe(false)
    expect(plan.errores.join(' ')).toMatch(/factura emitida/)
  })

  it('SÍ deja asignarle más plata a un negocio facturado', () => {
    const plan = planearRedistribucion({
      pagoOriginal: 1_211_250,
      actuales: [
        porcion({ negocioId: 'v0043', monto: 605_625, negocioFacturado: true }),
        porcion({ negocioId: 'v0064', monto: 605_625 }),
      ],
      destino: [
        { negocioId: 'v0043', monto: 900_000 },
        { negocioId: 'v0064', monto: 311_250 },
      ],
      motivo: MOTIVO,
    })

    expect(plan.ok).toBe(true)
  })

  it('el sobrante de un negocio facturado se puede mandar a devolución', () => {
    const plan = planearRedistribucion({
      pagoOriginal: 1_211_250,
      actuales: [porcion({ negocioId: 'v0043', monto: 1_211_250, negocioFacturado: true })],
      destino: [
        { negocioId: 'v0043', monto: 1_211_250 },
      ],
      motivo: MOTIVO,
    })

    expect(plan.ok).toBe(true)
    expect(plan.totalPorDevolver).toBe(0)
  })
})

describe('planearRedistribucion — devolución al cliente', () => {
  it('la plata marcada por devolver cuenta contra el pago pero no es de ningún negocio', () => {
    const plan = planearRedistribucion({
      pagoOriginal: 1_211_250,
      actuales: [porcion({ negocioId: 'v0043', monto: 1_211_250 })],
      destino: [
        { negocioId: 'v0043', monto: 1_000_000 },
        { negocioId: 'v0043-devolucion', monto: 211_250, porDevolver: true },
      ],
      motivo: MOTIVO,
    })

    expect(plan.ok).toBe(true)
    expect(plan.totalAsignado).toBe(1_000_000)
    expect(plan.totalPorDevolver).toBe(211_250)
    expect(plan.sinAsignar).toBe(0)
  })
})
