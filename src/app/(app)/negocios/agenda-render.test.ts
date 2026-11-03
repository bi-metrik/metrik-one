/**
 * La Agenda en pantalla (brief del 2026-10-22): como asesora (solo lo suyo, sin contador) y como
 * Edgar (todo el equipo, inicial de la responsable y contador por persona); el vacío dice lo
 * próximo; las píldoras de hito en la fila del servicio; y con los hitos apagados, «Mis pendientes»
 * de siempre. Datos ficticios.
 *
 * ⚠️ `.ts` y no `.tsx`: el `include` de `vitest.config.ts` es `src/**\/*.test.ts`.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { configHitos, hitosDelViaje, type ViajeHitos } from '@/lib/viaje/hitos'
import { hitosVisibles } from '@/lib/viaje/agenda'
import type { DatosBloqueServicios } from '@/lib/viaje/bloque-servicios'
import type { Pendiente } from '@/lib/viaje/mis-pendientes'

vi.mock('./hitos-actions', () => ({ adjuntarHito: vi.fn(), marcarHito: vi.fn(), deshacerHito: vi.fn() }))
vi.mock('./servicios-viaje-actions', () => ({ decidirAprobacionServicio: vi.fn() }))
vi.mock('./confirmacion-viaje-actions', () => ({ decidirAprobacionPlan: vi.fn() }))
vi.mock('../../servicios-viaje-actions', () => ({}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { default: Agenda } = await import('./agenda')
const { default: MisPendientes } = await import('./mis-pendientes')

const EDGAR = 'staff-direccion'
const ALE = 'staff-asesora-a'
const DANI = 'staff-asesora-d'
const HOY = '2026-11-06' // viernes
const nombres = { [EDGAR]: 'Edgar', [ALE]: 'Alejandra', [DANI]: 'Daniela' }

const svc = (id: string, tipo: string, nombre: string, responsable: string, extra: Record<string, unknown> = {}) => ({
  id, tipo, nombre, estado: 'por_reservar', responsable_staff_id: responsable, fecha_servicio: null, hora_inicio: null, fecha_fin: null, hora_fin: null, tramos: null, voucher_ref: null, confirmacion_ref: null, ...extra,
})

const viaje: ViajeHitos = {
  id: 'neg-1', nombre: 'P 26 1 — Viaje de prueba', cliente: 'Viajera Ficticia', clienteTelefono: '3000000000', estado: 'abierto', etapaNumero: 5, esPrueba: false,
  salida: '2026-11-09', regreso: '2026-11-12', internacional: false, destino: null, confirmadoEl: '2026-10-01', documentosCompletos: true,
  comercialStaffId: ALE, operacionesStaffId: null, aprobadoresStaffIds: [EDGAR], catalogo: configHitos({ hitos: { activo: true } }),
  servicios: [
    svc('vuelo-1', 'vuelo', 'Vuelo de prueba', ALE, { fecha_servicio: '2026-11-07', tramos: [{ fecha: '2026-11-07', hora_salida: '08:40', origen: 'ADZ', destino: 'PVA', aerolinea: 'Aerolínea X', numero_vuelo: 'XX12' }] }),
    svc('hotel-1', 'hotel', 'Hotel de prueba', DANI, { fecha_servicio: '2026-11-09' }),
    svc('tour-1', 'actividad', 'Tour de prueba', ALE, { fecha_servicio: '2026-11-07' }),
    svc('traslado-1', 'traslado', 'Traslado de prueba', DANI, { fecha_servicio: '2026-11-05' }),
    svc('tour-2', 'actividad', 'Tour sin fecha', ALE),
  ],
  marcas: [],
}
const todos = hitosDelViaje(viaje, HOY)
const plata: Pendiente = { id: 'p1', grupo: 'hoy', fecha: HOY, texto: 'Paga el traslado: vence hoy.', negocioId: 'neg-1', viaje: viaje.nombre, accion: { tipo: 'abrir', label: 'Abrir fila' }, plata: true }

const agenda = (staffId: string, esDireccion: boolean, extra: Record<string, unknown> = {}) => renderToStaticMarkup(React.createElement(Agenda, {
  datos: { hitos: hitosVisibles(todos, { staffId, esDireccion }), nombres, esDireccion, staffId },
  pendientes: [plata], servicios: [], hoy: HOY, proximo: null, tablero: null, ...extra,
}))

describe('Agenda', () => {
  it('asesora: solo lo suyo, sin contador; Hecho ⇪ en el check-in, Hecho en el tour; plata al final en gris', () => {
    const h = agenda(ALE, false)
    expect(h).toContain('data-agenda')
    expect(h).toContain('Hoy vie 6')
    expect(h).toContain('Fin de semana')
    expect(h).toContain('Próx. semana')
    expect(h).toContain('Check-in y pasabordo · vuelo')
    expect(h).toContain('Confirmar con el proveedor del tour')
    expect(h).not.toContain('Reconfirmar la reserva con el hotel')
    expect(h).not.toContain('data-contador')
    expect(h).toContain('Hecho ⇪')
    expect(h).toContain('accept="image/*,application/pdf"')
    expect(h.indexOf('Check-in y pasabordo')).toBeLessThan(h.indexOf('Paga el traslado'))
    expect(h).toContain('bg-muted/40')
    // Sin fecha: «Falta un dato» con acceso al viaje.
    expect(h).toContain('Falta la fecha de Tour sin fecha: ponla para saber cuándo confirmar con el proveedor del tour los detalles.')
    expect(h).toContain('Poner la fecha')
    expect(h).toContain('min-h-11')
    expect(h).toContain('overflow-x-auto')
  })

  it('Edgar: todo el equipo con inicial y contador por persona, y el vencido arriba', () => {
    const h = agenda(EDGAR, true)
    expect(h).toContain('Todo el equipo')
    expect(h).toContain('data-contador')
    expect(h).toMatch(/Alejandra 2/)
    expect(h).toMatch(/Daniela 1/)
    // El check-in de Alejandra abrió ayer (48 h antes de las 8:40 del sábado): vencido.
    expect(h).toContain('vencidos 1')
    expect(h).toContain('Reconfirmar la reserva con el hotel')
    expect(h).toContain('data-inicial')
    expect(h.indexOf('Vencido')).toBeLessThan(h.indexOf('Hoy ·'))
    // El traslado de ayer ya no tiene remedio: sale de la lista y queda contado para Edgar.
    expect(h).toContain('No se hizo a tiempo · 1')
  })

  it('vacía: «Nada para hoy. Lo próximo: …»', () => {
    const lejos = hitosDelViaje({ ...viaje, servicios: [svc('vuelo-9', 'vuelo', 'Vuelo lejano', ALE, { fecha_servicio: '2026-11-26', tramos: [{ fecha: '2026-11-26', hora_salida: '06:10', origen: 'BOG', destino: 'CTG' }] })] }, HOY)
    const h = renderToStaticMarkup(React.createElement(Agenda, {
      datos: { hitos: lejos, nombres, esDireccion: false, staffId: ALE }, pendientes: [], servicios: [], hoy: HOY, proximo: null, tablero: null,
    }))
    expect(h).toContain('Nada para hoy. Lo próximo: check-in de Viajera el mar 24 nov.')
  })
})

describe('píldoras de hito en la fila del servicio', () => {
  beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date('2026-11-06T15:00:00Z')) })
  afterAll(() => { vi.useRealTimers() })

  it('ámbar mañana, rojo vencido, verde hecho con quién; «Sigue:» toma el hito más urgente', async () => {
    const { default: BloqueServicios } = await import('./[id]/bloques/BloqueServicios')
    const conMarca: ViajeHitos = { ...viaje, marcas: [{ servicio_id: 'tour-1', tramo: null, hito_id: 'detalles_tour', fecha_objetivo: '2026-11-07', estado: 'hecho', evidencia_ref: null, nota: '8:00 en el muelle', hecho_por: ALE, hecho_at: '2026-11-06T13:00:00Z' }] }
    const hitos = hitosDelViaje(conMarca, HOY).filter(h => h.servicioId)
    const fila = (id: string, tipo: string, nombre: string, fecha: string | null) => ({
      id, tipo, nombre, proveedor_nombre: null, localizador: null, estado: 'por_reservar' as const, fecha_servicio: fecha, fecha_limite_pago: null,
      costo_cotizado: 100, valor_por_pagar: null, voucher_ref: null, confirmacion_ref: null, orden: 0, origen: 'cotizacion' as const, gastos: [], aprobaciones: [],
    })
    const datos: DatosBloqueServicios = {
      activo: true, hayCotizacionAceptada: true, quien: { role: 'operator', areas: ['operaciones'], staffId: DANI, aprobadores: [] },
      filas: [fila('hotel-1', 'hotel', 'Hotel de prueba', '2026-11-09'), fila('tour-1', 'actividad', 'Tour de prueba', '2026-11-07'), fila('traslado-1', 'traslado', 'Traslado de prueba', '2026-11-05')],
      nombres, hitos,
    }
    const h = renderToStaticMarkup(React.createElement(BloqueServicios, { negocioId: 'neg-1', modo: 'editable', datos, esResponsable: false }))
    expect(h).toContain('data-pildoras-hito')
    expect(h).toContain('Reconfirmar hotel · vie 6 nov')
    expect(h).toContain('data-color="ambar"')
    expect(h).toContain('✓ Detalles del tour')
    expect(h).toContain('Hecho por Alejandra el vie 6 nov: 8:00 en el muelle')
    expect(h).toContain('Confirmar traslado · No se hizo a tiempo')
    expect(h).toContain('Sigue:</span> Reconfirmar la reserva con el hotel (no con la plataforma): es hoy.')
  })
})

describe('interruptor apagado', () => {
  it('«Mis pendientes» de siempre: sin agenda, sin selector de días', () => {
    const h = renderToStaticMarkup(React.createElement(MisPendientes, { pendientes: [plata], servicios: [], hoy: HOY, proximo: null, tablero: null }))
    expect(h).toContain('data-mis-pendientes')
    expect(h).not.toContain('data-agenda')
    expect(h).not.toContain('Fin de semana')
    expect(h).toContain('Hoy · 1')
  })
})
