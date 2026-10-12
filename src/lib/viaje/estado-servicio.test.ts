/**
 * Estado derivado de la fila (Vera C6, C5) y quién la toca (§7.4).
 *
 * VISTO FALLAR (2026-10-12): cada guarda de `estadoDelServicio` y de los permisos se quitó una
 * a la vez y cayó al menos una prueba (anotado en cada `describe`).
 */
import { describe, expect, it } from 'vitest'
import {
  aprobadoresDeLinea,
  estadoDelServicio,
  puedeAdjuntarVoucher,
  puedeEditarServicios,
  serviciosViajeActivo,
  valorAPagar,
  type GastoDelServicio,
} from './estado-servicio'

const hotel = { estado: 'reservado' as const, costo_cotizado: 1_100_000, valor_por_pagar: null, confirmacion_ref: null }
const pago = (monto: number, extra: Partial<GastoDelServicio> = {}): GastoDelServicio => ({
  monto, soporte_url: 'one://gastos-soportes/ws/x.jpg', medio_pago: 'tarjeta-empresa', titular_medio: 'empresa', ...extra,
})

describe('estadoDelServicio (C6: pagado y confirmado salen de la plata)', () => {
  it('sin pagos queda lo escrito', () => {
    expect(estadoDelServicio(hotel)).toBe('reservado')
    expect(estadoDelServicio({ ...hotel, estado: 'por_reservar' })).toBe('por_reservar')
  })

  it('pagado: lo pagado cubre lo que hay que pagar, con soporte, medio y titular', () => {
    expect(estadoDelServicio(hotel, [pago(1_100_000)])).toBe('pagado')
  })

  it('un pago partido cuenta las dos partes una vez cada una', () => {
    expect(estadoDelServicio(hotel, [pago(600_000), pago(500_000)])).toBe('pagado')
    expect(estadoDelServicio(hotel, [pago(600_000)])).toBe('reservado')
  })

  it('un pago sin soporte, sin medio o sin titular no deja la fila pagada', () => {
    expect(estadoDelServicio(hotel, [pago(1_100_000, { soporte_url: null })])).toBe('reservado')
    expect(estadoDelServicio(hotel, [pago(1_100_000, { medio_pago: null })])).toBe('reservado')
    expect(estadoDelServicio(hotel, [pago(1_100_000, { titular_medio: null })])).toBe('reservado')
  })

  it('confirmado: pagado y con la confirmación del proveedor final', () => {
    expect(estadoDelServicio({ ...hotel, confirmacion_ref: 'one://ve-documentos/ws/c.pdf' }, [pago(1_100_000)])).toBe('confirmado')
    // La confirmación sola, sin pago, no confirma nada.
    expect(estadoDelServicio({ ...hotel, confirmacion_ref: 'one://ve-documentos/ws/c.pdf' })).toBe('reservado')
  })

  it('el proveedor cobra distinto: se mide contra lo que cobra', () => {
    const caro = { ...hotel, valor_por_pagar: 1_190_000 }
    expect(valorAPagar(caro)).toBe(1_190_000)
    expect(estadoDelServicio(caro, [pago(1_100_000)])).toBe('reservado')
    expect(estadoDelServicio(caro, [pago(1_190_000)])).toBe('pagado')
  })

  it('una aprobación pedida deja la fila esperando, aunque esté pagada (C5)', () => {
    expect(estadoDelServicio(hotel, [pago(1_190_000)], [{ estado: 'solicitada' }])).toBe('esperando')
    expect(estadoDelServicio(hotel, [], [{ estado: 'solicitada' }])).toBe('esperando')
  })

  it('«No aprobar» sobre un pago que ya salió: la fila no cuenta; aprobada sí', () => {
    expect(estadoDelServicio(hotel, [pago(1_190_000)], [{ estado: 'rechazada' }])).toBe('no_aprobado')
    expect(estadoDelServicio(hotel, [pago(1_190_000)], [{ estado: 'aprobada' }])).toBe('pagado')
  })

  it('una fila que no va es «No va», tenga lo que tenga', () => {
    expect(estadoDelServicio({ ...hotel, estado: 'cancelado' }, [pago(1_100_000)], [{ estado: 'solicitada' }])).toBe('cancelado')
  })
})

describe('permisos (§7.4: el servidor decide, la pantalla solo esconde)', () => {
  const base = { staffId: 's-1', aprobadores: ['s-edgar'] }
  it('operaciones y la dirección editan filas; la comercial no', () => {
    expect(puedeEditarServicios({ ...base, role: 'operator', areas: ['operaciones'] })).toBe(true)
    expect(puedeEditarServicios({ ...base, role: 'owner', areas: [] })).toBe(true)
    expect(puedeEditarServicios({ ...base, staffId: 's-edgar', role: 'supervisor', areas: ['direccion'] })).toBe(true)
    expect(puedeEditarServicios({ ...base, role: 'operator', areas: ['comercial'] })).toBe(false)
    expect(puedeEditarServicios({ ...base, role: 'read_only', areas: ['operaciones'] })).toBe(false)
    expect(puedeEditarServicios({ ...base, role: 'contador', areas: ['operaciones'] })).toBe(false)
  })

  it('la comercial responsable adjunta vouchers; otra comercial no', () => {
    expect(puedeAdjuntarVoucher({ ...base, role: 'operator', areas: ['comercial'], esResponsable: true })).toBe(true)
    expect(puedeAdjuntarVoucher({ ...base, role: 'operator', areas: ['comercial'], esResponsable: false })).toBe(false)
  })
})

describe('configuración de la línea', () => {
  it('el interruptor solo vale con `true` explícito: ausente o cualquier otra cosa es apagado', () => {
    expect(serviciosViajeActivo({ servicios_viaje: { activo: true } })).toBe(true)
    expect(serviciosViajeActivo({ servicios_viaje: { activo: 'true' } })).toBe(false)
    expect(serviciosViajeActivo({ servicios_viaje: {} })).toBe(false)
    expect(serviciosViajeActivo(null)).toBe(false)
  })

  it('los aprobadores salen de `aprobaciones.staff_ids` y se ignora lo que no es texto', () => {
    expect(aprobadoresDeLinea({ aprobaciones: { staff_ids: ['s-edgar', 3, null] } })).toEqual(['s-edgar'])
    expect(aprobadoresDeLinea({})).toEqual([])
  })
})
