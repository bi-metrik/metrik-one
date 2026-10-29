/**
 * Confirmación ante un pago a proveedor fuera de lo pactado (decisión de Mauricio 2026-10-29,
 * QA Trappvel H1-2 y H9-2). Datos ficticios.
 */
import { describe, expect, it } from 'vitest'
import { confirmacionFueraDeLoPactado } from './pago-fuera-de-lo-pactado'

const base = { monto: 1_000_000, pagadoAntesServicio: 0, costoCotizado: 1_000_000, pagadoProveedores: 0, cobradoCliente: 5_000_000 }

describe('confirmacionFueraDeLoPactado', () => {
  it('dentro de lo pactado no pregunta nada', () => {
    expect(confirmacionFueraDeLoPactado(base)).toBeNull()
    // Exactamente lo cotizado y exactamente lo cobrado: dentro.
    expect(confirmacionFueraDeLoPactado({ ...base, cobradoCliente: 1_000_000 })).toBeNull()
    expect(confirmacionFueraDeLoPactado({ ...base, monto: 0 })).toBeNull()
  })

  it('(a) supera lo cotizado del servicio, aunque sea por poco (la aprobación de Edgar tiene su umbral aparte)', () => {
    const t = confirmacionFueraDeLoPactado({ ...base, monto: 600_000, pagadoAntesServicio: 500_000 })
    expect(t).toBe('¿Estás seguro? Esto está por fuera de lo pactado: con este pago el servicio queda en $1.100.000 y se cotizó en $1.000.000 ($100.000 más).')
  })

  it('(a) un servicio sin costo cotizado', () => {
    expect(confirmacionFueraDeLoPactado({ ...base, costoCotizado: 0 })).toBe(
      '¿Estás seguro? Esto está por fuera de lo pactado: este servicio no tiene valor cotizado y le vas a pagar $1.000.000.',
    )
  })

  it('(b) lo pagado a proveedores supera lo cobrado al cliente (H1-2: 100 % al operador con el cliente al 29 %)', () => {
    const t = confirmacionFueraDeLoPactado({ monto: 4_590_000, pagadoAntesServicio: 0, costoCotizado: 4_590_000, pagadoProveedores: 0, cobradoCliente: 1_620_000 })
    expect(t).toBe('¿Estás seguro? Esto está por fuera de lo pactado: a proveedores se les habrá pagado $4.590.000 y el cliente ha pagado $1.620.000 ($2.970.000 más).')
  })

  it('las dos a la vez van en un solo mensaje', () => {
    const t = confirmacionFueraDeLoPactado({ monto: 1_200_000, pagadoAntesServicio: 0, costoCotizado: 1_000_000, pagadoProveedores: 3_000_000, cobradoCliente: 2_000_000 })!
    expect(t.startsWith('¿Estás seguro? Esto está por fuera de lo pactado: ')).toBe(true)
    expect(t).toContain('se cotizó en $1.000.000 ($200.000 más)')
    expect(t).toContain('a proveedores se les habrá pagado $4.200.000 y el cliente ha pagado $2.000.000 ($2.200.000 más)')
  })
})
