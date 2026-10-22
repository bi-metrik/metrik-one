import { describe, expect, it } from 'vitest'
import { inicioBogota, mensajeDeError, rangoDiaBogota, reservaActiva } from './reglas'

describe('reglas del módulo funciones', () => {
  it('reservaActiva usa la misma definición que la base', () => {
    const ahora = Date.parse('2026-11-09T12:00:00Z')
    expect(reservaActiva({ estado: 'confirmada', vence_at: '2026-11-01T00:00:00Z' }, ahora)).toBe(true)
    expect(reservaActiva({ estado: 'apartada', vence_at: '2026-11-09T12:30:00Z' }, ahora)).toBe(true)
    expect(reservaActiva({ estado: 'apartada', vence_at: '2026-11-09T11:59:00Z' }, ahora)).toBe(false)
    expect(reservaActiva({ estado: 'cancelada', vence_at: null }, ahora)).toBe(false)
  })

  it('el día y la hora de Bogotá', () => {
    expect(rangoDiaBogota('2026-11-09')).toEqual({ desde: '2026-11-09T05:00:00.000Z', hasta: '2026-11-10T05:00:00.000Z' })
    expect(rangoDiaBogota('9-11-2026')).toBeNull()
    expect(inicioBogota('2026-11-09', '19:30')).toBe('2026-11-09T19:30:00-05:00')
    expect(inicioBogota('2026-11-09', '7pm')).toBeNull()
  })

  it('los errores de la base se dicen en llano', () => {
    expect(mensajeDeError({ message: 'sin_cupo', details: 'Quedan 2 puestos.' })).toBe('No hay cupo para esa cantidad de personas. Quedan 2 puestos.')
    expect(mensajeDeError({ message: 'datos_invalidos', details: 'nombre' })).toBe('Revisa los datos del formulario. (nombre)')
    expect(mensajeDeError({ message: 'algo raro de la red' })).toBe('No se pudo guardar. Intenta de nuevo.')
  })
})
