/**
 * Gate `servicios_listos` (Vera F3-7, C6, C5) y lo que pinta el tablero de F3 (Noor §5).
 */
import { describe, expect, it } from 'vitest'
import { faltaDeLaFila, lineasDelGate, serviciosQueFaltan, encabezadoGate } from './gate-servicios'
import { colorDeLaEtapa, filasVista, filtrarTablero, porcentajePersonal, sigueDelTablero } from './bloque-servicios'
import type { ServicioDelNegocio } from './servicios-viaje-datos'

const HOY = '2026-10-20'

function fila(id: string, extra: Partial<ServicioDelNegocio> = {}): ServicioDelNegocio {
  return {
    id, tipo: 'hotel', nombre: id, proveedor_nombre: null, localizador: null, estado: 'reservado',
    fecha_servicio: null, fecha_limite_pago: null, costo_cotizado: 1_000_000, valor_por_pagar: null,
    voucher_ref: null, confirmacion_ref: null, orden: 0, origen: 'cotizacion', gastos: [], aprobaciones: [],
    ...extra,
  }
}
const pago = (monto: number, extra: Partial<ServicioDelNegocio['gastos'][number]> = {}) => ({
  monto, soporte_url: 'one://ve-documentos/ws/s.jpg', medio_pago: 'tc', titular_medio: 'empresa', ...extra,
})

describe('faltaDeLaFila', () => {
  it('confirmada cuenta; «No va» no frena', () => {
    expect(faltaDeLaFila(fila('a', { gastos: [pago(1_000_000)], confirmacion_ref: 'one://x' }), true)).toBeNull()
    expect(faltaDeLaFila(fila('a', { estado: 'cancelado' }), true)).toBeNull()
  })

  it('pagada sin confirmación frena si la línea la exige, y no si no', () => {
    const f = fila('a', { gastos: [pago(1_000_000)] })
    expect(faltaDeLaFila(f, true)).toBe('falta la confirmación del proveedor final')
    expect(faltaDeLaFila(f, false)).toBeNull()
  })

  it('esperando a Edgar no cuenta aunque esté pagada y confirmada', () => {
    const f = fila('a', { gastos: [pago(1_000_000)], confirmacion_ref: 'one://x', aprobaciones: [{ estado: 'solicitada' }] })
    expect(faltaDeLaFila(f, true)).toBe('esperando a Edgar')
  })

  it('no aprobada por Edgar con el pago hecho: sigue frenando (C5 b)', () => {
    const f = fila('a', { gastos: [pago(1_000_000)], confirmacion_ref: 'one://x', aprobaciones: [{ estado: 'rechazada' }] })
    expect(faltaDeLaFila(f, true)).toBe('Edgar no aprobó el pago')
  })

  it('dice exactamente qué falta del pago', () => {
    expect(faltaDeLaFila(fila('a'), true)).toBe('falta registrar el pago')
    expect(faltaDeLaFila(fila('a', { gastos: [pago(1_000_000, { soporte_url: null })] }), true)).toBe('falta el soporte de pago')
    expect(faltaDeLaFila(fila('a', { gastos: [pago(1_000_000, { medio_pago: null })] }), true)).toBe('falta el medio de pago')
    expect(faltaDeLaFila(fila('a', { gastos: [pago(400_000)] }), true)).toBe('falta pagar $600.000')
  })

  it('una fila sin nada que pagarle a un proveedor (recargo fijo de F0) no frena', () => {
    expect(faltaDeLaFila(fila('recargo', { tipo: 'otro', costo_cotizado: 0 }), true)).toBeNull()
  })
})

describe('líneas del gate (máximo 3 y «y N más»)', () => {
  it('cuatro pendientes = tres líneas y «y 1 más»', () => {
    const faltan = serviciosQueFaltan([fila('Traslado'), fila('Vuelo'), fila('Hotel'), fila('Kayak'), fila('Listo', { gastos: [pago(1_000_000)], confirmacion_ref: 'x' })], true)
    expect(faltan).toHaveLength(4)
    expect(lineasDelGate(faltan)).toEqual([
      'Traslado: falta registrar el pago',
      'Vuelo: falta registrar el pago',
      'Hotel: falta registrar el pago',
      'y 1 más',
    ])
  })
  it('sin pendientes no hay líneas', () => {
    expect(lineasDelGate([])).toEqual([])
  })
  it('encabezado literal de Noor', () => {
    expect(encabezadoGate(3, 'Documentos y entrega')).toBe('Faltan 3 servicios para pasar a Documentos y entrega:')
    expect(encabezadoGate(1, null)).toBe('Falta 1 servicio:')
  })
})

describe('tablero F3', () => {
  it('% pagado con tarjetas personales sobre lo pagado', () => {
    const v = filasVista([
      fila('a', { gastos: [pago(750_000)] }),
      fila('b', { gastos: [pago(250_000, { titular_medio: 'personal' })] }),
    ])
    expect(porcentajePersonal(v)).toBe(25)
    expect(porcentajePersonal(filasVista([fila('a')]))).toBe(0)
  })

  it('filtros: por pagar, esperando a Edgar, falta confirmar', () => {
    const v = filasVista([
      fila('porPagar'),
      fila('esperando', { aprobaciones: [{ estado: 'solicitada' }] }),
      fila('pagada', { gastos: [pago(1_000_000)] }),
      fila('lista', { gastos: [pago(1_000_000)], confirmacion_ref: 'x' }),
    ])
    expect(filtrarTablero(v, 'por_pagar').map(x => x.servicio.id)).toEqual(['porPagar'])
    expect(filtrarTablero(v, 'esperando').map(x => x.servicio.id)).toEqual(['esperando'])
    expect(filtrarTablero(v, 'falta_confirmar').map(x => x.servicio.id)).toEqual(['pagada'])
    expect(filtrarTablero(v, 'todos')).toHaveLength(4)
  })

  it('color de la etapa y «Sigue:» con el pago más urgente', () => {
    const v = filasVista([
      fila('Hotel', { fecha_limite_pago: '2026-10-22' }),
      fila('Traslado en San Andrés', { fecha_limite_pago: '2026-10-19' }),
    ])
    expect(colorDeLaEtapa(v, HOY)).toBe('rojo')
    expect(sigueDelTablero(v, HOY)).toEqual({ servicioId: 'Traslado en San Andrés', texto: 'Traslado en San Andrés: venció ayer sin pagar.' })
    const sinUrgencia = filasVista([fila('Kayak a Cayo Cangrejo', { estado: 'por_reservar' })])
    expect(colorDeLaEtapa(sinUrgencia, HOY)).toBe('verde')
    expect(sigueDelTablero(sinUrgencia, HOY)?.texto).toBe('Reserva Kayak a Cayo Cangrejo.')
    expect(sigueDelTablero(filasVista([fila('x', { gastos: [pago(1_000_000)], confirmacion_ref: 'y' })]), HOY)).toBeNull()
  })
})
