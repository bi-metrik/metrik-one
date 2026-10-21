/**
 * El bloque «Servicios del viaje» dice lo que el diseño pide y nada técnico (Vera §7.6), con
 * botones de 44 px (§7.5) y el vacío con su salida (F0-4: «Traer los servicios…»).
 *
 * ⚠️ Se queda en `.ts`: el `include` de `vitest.config.ts` es `src/**\/*.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { DatosBloqueServicios } from '@/lib/viaje/bloque-servicios'

vi.mock('../../servicios-viaje-actions', () => ({
  actualizarServicio: vi.fn(),
  actualizarFechasServicio: vi.fn(),
  adjuntarArchivoServicio: vi.fn(),
  traerServiciosDeCotizacion: vi.fn(),
  registrarPagoServicio: vi.fn(),
  pedirAprobacionServicio: vi.fn(),
  decidirAprobacionServicio: vi.fn(),
  subirSoporteServicio: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { default: BloqueServicios } = await import('./BloqueServicios')

const OPERACIONES = { role: 'operator', areas: ['operaciones'], staffId: 's-1', aprobadores: [] }

function datos(extra: Partial<DatosBloqueServicios> = {}): DatosBloqueServicios {
  return {
    activo: true,
    hayCotizacionAceptada: true,
    quien: OPERACIONES,
    filas: [
      {
        id: 's1', tipo: 'vuelo', nombre: 'LATAM BOG-CUZ', proveedor_nombre: 'LATAM', localizador: 'K7P2Q',
        estado: 'reservado', fecha_servicio: null, fecha_limite_pago: null, costo_cotizado: 1_800_000,
        valor_por_pagar: null, voucher_ref: 'one://ve-documentos/ws/v.pdf', confirmacion_ref: null, orden: 0,
        origen: 'cotizacion', gastos: [], aprobaciones: [],
      },
      {
        id: 's2', tipo: 'hotel', nombre: 'Hotel Andino', proveedor_nombre: null, localizador: null,
        estado: 'por_reservar', fecha_servicio: null, fecha_limite_pago: null, costo_cotizado: 1_100_000,
        valor_por_pagar: null, voucher_ref: null, confirmacion_ref: null, orden: 1,
        origen: 'cotizacion', gastos: [], aprobaciones: [],
      },
    ],
    ...extra,
  }
}

const html = (d: DatosBloqueServicios | null, modo: 'editable' | 'visible' = 'editable', esResponsable = false, abiertaInicial: string | null = null) =>
  renderToStaticMarkup(React.createElement(BloqueServicios, { negocioId: 'n1', modo, datos: d, esResponsable, abiertaInicial }))

const PROHIBIDAS = ['cobro programado', 'checklist', 'bloque', 'stage', 'gate', 'plan_pago', 'wa_manual', 'excepción', 'huella', 'FIFO', 'RLS']

describe('BloqueServicios', () => {
  it('pinta el resumen, cada fila con su estado y lo que falta, y el costo real', () => {
    const h = html(datos())
    expect(h).toContain('2 servicios')
    expect(h).toContain('LATAM BOG-CUZ')
    expect(h).toContain('Reservado')
    expect(h).toContain('Por reservar')
    expect(h).toContain('Falta el proveedor')
    expect(h).toContain('Costo real hasta hoy')
    for (const p of PROHIBIDAS) expect(h.toLowerCase()).not.toContain(p.toLowerCase())
  })

  it('sin filas y con cotización aceptada ofrece traerlas, con un botón de 44 px', () => {
    const h = html(datos({ filas: [] }))
    expect(h).toContain('Este viaje no tiene servicios todavía.')
    expect(h).toContain('Traer los servicios de la cotización aceptada')
    expect(h).toContain('min-h-11')
  })

  it('una comercial que no es responsable ve el vacío sin el botón; apagado tampoco lo ofrece', () => {
    expect(html(datos({ filas: [], quien: { ...OPERACIONES, areas: ['comercial'] } }))).not.toContain('Traer los servicios')
    expect(html(datos({ filas: [], activo: false }))).not.toContain('Traer los servicios')
  })

  it('apagado se ve y lo dice: no se edita', () => {
    expect(html(datos({ activo: false }))).toContain('se ven, no se editan')
  })

  it('F3: la hoja trae el pago con medio, titular y soporte; sin anticipo, el botón es «Pedir a Edgar»', () => {
    const medios = [{ id: 'tc-emp', label: 'Tarjeta empresa ••4417', titular: 'empresa' as const }]
    const h = html(datos({ medios, cobradoCliente: 0, precioAprobado: 9_000_000 }), 'editable', false, 's1')
    expect(h).toContain('Valor pagado')
    expect(h).toContain('Medio de pago')
    expect(h).toContain('Titular: Empresa')
    expect(h).toContain('Pegar soporte')
    expect(h).toContain('Tomar foto')
    expect(h).toContain('El cliente no ha pagado el anticipo.')
    expect(h).toContain('Pedir a Edgar')
    expect(h).toContain('El pago ya salió')
    for (const p of PROHIBIDAS) expect(h.toLowerCase()).not.toContain(p.toLowerCase())
  })

  it('F3: con anticipo y medio de empresa, «Registrar pago»; sin medios configurados lo dice', () => {
    const medios = [{ id: 'tc-emp', label: 'Tarjeta empresa ••4417', titular: 'empresa' as const }]
    const h = html(datos({ medios, cobradoCliente: 2_000_000, precioAprobado: 9_000_000 }), 'editable', false, 's1')
    expect(h).toContain('Registrar pago')
    expect(h).not.toContain('Pedir a Edgar')
    expect(html(datos({ medios: [] }), 'editable', false, 's1')).toContain('Falta configurar los medios de pago')
  })

  it('F3: Edgar ve el pedido en la fila con Aprobar y No aprobar; operaciones solo lo ve', () => {
    const conPedido = datos({
      nombres: { 's-ale': 'Alejandra' },
      filas: [{
        ...datos().filas[0],
        aprobaciones: [{ id: 'ap1', tipo: 'desviacion_costo', estado: 'solicitada', huella: 'h', solicitada_por: 's-ale',
          detalle: { monto: 1_262_000, proveedor: 'SATENA', texto: 'Costó $82.000 más de lo cotizado (+6,9 %).' } }],
      }],
    })
    const edgar = html({ ...conPedido, quien: { role: 'owner', areas: [], staffId: 's-edgar', aprobadores: [] } }, 'editable', false, 's1')
    expect(edgar).toContain('Alejandra pide pagar')
    expect(edgar).toContain('SATENA')
    expect(edgar).toContain('Aprobar')
    expect(edgar).toContain('No aprobar')
    expect(edgar).toContain('Esperando a Edgar')
    const ope = html(conPedido, 'editable', false, 's1')
    expect(ope).toContain('Alejandra pide pagar')
    expect(ope).not.toContain('>Aprobar<')
  })

  it('F3: resumen con % de tarjetas personales y filtros', () => {
    const h = html(datos())
    expect(h).toContain('Pagado con tarjetas personales')
    expect(h).toContain('Esperando a Edgar')
    expect(h).toContain('Falta confirmar')
    expect(h).toContain('Sigue:')
  })

  it('fechas: la fila cerrada dice cuándo o «Falta la fecha»; la hoja del vuelo edita cada tramo con campos nativos de 44 px', () => {
    const vuelo = {
      ...datos().filas[0],
      fecha_servicio: '2026-11-10', hora_inicio: '06:10', fecha_fin: '2026-11-15', hora_fin: '20:05',
      tramos: [
        { fecha: '2026-11-10', hora_salida: '06:10', hora_llegada: '07:45', origen: 'BOG', destino: 'ADZ', aerolinea: 'Aerolínea X', numero_vuelo: 'XX100' },
        { fecha: '2026-11-15', hora_salida: '18:30', hora_llegada: '20:05', origen: 'ADZ', destino: 'BOG', aerolinea: 'Aerolínea X', numero_vuelo: null },
      ],
      fechas_corregidas_at: '2026-10-21T15:00:00Z', fechas_corregidas_por: 's-ale',
    }
    const h = html(datos({ filas: [vuelo, datos().filas[1]], nombres: { 's-ale': 'Alejandra' } }), 'editable', false, 's1')
    expect(h).toContain('mar 10 nov · 06:10 → dom 15 nov · 20:05')
    expect(h).toContain('Falta la fecha') // el hotel, sin fecha leída
    expect(h).toContain('Ida')
    expect(h).toContain('Regreso')
    expect(h).toContain('Corregida a mano por Alejandra el mié 21 oct.')
    expect(h.match(/type="date"/g)?.length).toBeGreaterThanOrEqual(3) // 2 tramos + fecha límite
    expect(h.match(/type="time"/g)?.length).toBe(4)
    expect(h).toContain('Guardar fechas')
    expect(h).toContain('Agregar tramo')
    for (const campo of h.match(/<input[^>]*type="(date|time)"[^>]*>/g) ?? []) expect(campo).toContain('h-11')
    for (const p of PROHIBIDAS) expect(h.toLowerCase()).not.toContain(p.toLowerCase())
  })

  it('fechas: el hotel se edita con check-in y check-out; quien no edita no ve «Guardar fechas»', () => {
    const hotel = { ...datos().filas[1], fecha_servicio: '2026-11-10', fecha_fin: '2026-11-13' }
    const h = html(datos({ filas: [hotel] }), 'editable', false, 's2')
    expect(h).toContain('Check-in')
    expect(h).toContain('Check-out')
    expect(h).toContain('value="2026-11-13"')
    const comercial = html(datos({ filas: [hotel], quien: { ...OPERACIONES, areas: ['comercial'] } }), 'editable', false, 's2')
    expect(comercial).not.toContain('Guardar fechas')
  })
})
