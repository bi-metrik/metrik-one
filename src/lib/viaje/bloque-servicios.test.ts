import { describe, expect, it } from 'vitest'
import { fechaLimiteEnPalabras, filasVista, resumenDelTablero, totalesDelTablero } from './bloque-servicios'
import type { ServicioDelNegocio } from './servicios-viaje-datos'

/** Lo que pinta el tablero (Noor §3.1-§3.2). Fecha del día fija: 2026-10-20 (martes). */
const HOY = '2026-10-20'

function servicio(id: string, extra: Partial<ServicioDelNegocio> = {}): ServicioDelNegocio {
  return {
    id, tipo: 'hotel', nombre: id, proveedor_nombre: null, localizador: null, estado: 'por_reservar',
    fecha_servicio: null, fecha_limite_pago: null, costo_cotizado: 1_000_000, valor_por_pagar: null,
    voucher_ref: null, confirmacion_ref: null, orden: 0, origen: 'cotizacion', gastos: [], aprobaciones: [],
    ...extra,
  }
}

describe('fechaLimiteEnPalabras', () => {
  it('verde a más de 3 días, ámbar a 3 o menos, rojo vencida', () => {
    expect(fechaLimiteEnPalabras('2026-10-30', 'reservado', HOY)?.color).toBe('verde')
    expect(fechaLimiteEnPalabras('2026-10-23', 'reservado', HOY)).toEqual({ texto: expect.stringContaining('(en 3 días)'), color: 'ambar' })
    expect(fechaLimiteEnPalabras('2026-10-20', 'reservado', HOY)).toEqual({ texto: 'Vence hoy', color: 'ambar' })
    expect(fechaLimiteEnPalabras('2026-10-19', 'reservado', HOY)).toEqual({ texto: 'Venció ayer sin pagar', color: 'rojo' })
    expect(fechaLimiteEnPalabras('2026-10-15', 'por_reservar', HOY)?.texto).toBe('Venció hace 5 días sin pagar')
  })

  it('una fila pagada, confirmada o que no va no muestra fecha límite', () => {
    for (const e of ['pagado', 'confirmado', 'cancelado'] as const) {
      expect(fechaLimiteEnPalabras('2026-10-19', e, HOY)).toBeNull()
    }
    expect(fechaLimiteEnPalabras(null, 'reservado', HOY)).toBeNull()
  })
})

describe('resumen y totales del tablero', () => {
  const pagoCompleto = { monto: 1_000_000, soporte_url: 'one://x', medio_pago: 'm', titular_medio: 'empresa' }
  const vista = filasVista([
    servicio('vencido', { estado: 'reservado', fecha_limite_pago: '2026-10-18' }),
    servicio('confirmado', { confirmacion_ref: 'one://c', gastos: [pagoCompleto] }),
    servicio('esperando', { aprobaciones: [{ estado: 'solicitada' }] }),
    servicio('no-va', { estado: 'cancelado', fecha_limite_pago: '2026-10-01', gastos: [{ ...pagoCompleto, monto: 200_000 }] }),
  ])

  it('cuenta lo que va; la fila que no va no entra en el conteo ni en lo cotizado', () => {
    expect(resumenDelTablero(vista, HOY)).toBe('3 servicios · 1 confirmado · 1 esperando a Edgar · 1 pago vencido')
    expect(totalesDelTablero(vista)).toEqual({ cotizado: 3_000_000, pagado: 1_200_000 })
  })

  it('el sobrecosto solo cuenta hacia arriba (C5)', () => {
    const [caro, barato] = filasVista([
      servicio('caro', { gastos: [{ ...pagoCompleto, monto: 1_070_000 }] }),
      servicio('barato', { gastos: [{ ...pagoCompleto, monto: 950_000 }] }),
    ])
    expect(caro.sobrecosto).toBe(70_000)
    expect(barato.sobrecosto).toBe(0)
  })
})
