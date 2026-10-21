import { describe, expect, it } from 'vitest'
import { inicioBogota, mensajeDeError, posicionPorDefecto, rangoDiaBogota, reservaActiva } from './reglas'

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
    expect(mensajeDeError({ message: 'mesa_llena', details: 'La mesa M1 tiene 1 puestos libres.' })).toBe(
      'Esa mesa no tiene puestos para tantas personas. La mesa M1 tiene 1 puestos libres.',
    )
    expect(mensajeDeError({ message: 'datos_invalidos', details: 'nombre' })).toBe('Revisa los datos del formulario. (nombre)')
    expect(mensajeDeError({ message: 'algo raro de la red' })).toBe('No se pudo guardar. Intenta de nuevo.')
  })

  it('posiciones por defecto dentro de la cuadrícula', () => {
    const ps = Array.from({ length: 10 }, (_, i) => posicionPorDefecto(i, 10))
    expect(ps.every((p) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100)).toBe(true)
    expect(new Set(ps.map((p) => `${p.x},${p.y}`)).size).toBe(10)
  })
})
