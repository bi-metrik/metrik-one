import { describe, expect, it } from 'vitest'
import { DIAS_SALDO, diaBogota, diasSaldoValido, inicioBogota, insigniaFuncion, mensajeDeError, pesos, preventaPasaLaFuncion, rangoDiaBogota, reservaActiva } from './reglas'

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

  it('las insignias de la función, con las palabras de Sabor', () => {
    const f = { estado: 'activa', capacidad: 35, cupo_asistente: 30, ocupadas: 12 }
    expect(insigniaFuncion(f)).toBe('Disponible')
    expect(insigniaFuncion({ ...f, ocupadas: 30 })).toBe('Llena para el asistente')
    expect(insigniaFuncion({ ...f, ocupadas: 35 })).toBe('Llena')
    expect(insigniaFuncion({ ...f, estado: 'pausada' })).toBe('Pausada')
    expect(insigniaFuncion({ ...f, estado: 'cancelada', ocupadas: 35 })).toBe('Cancelada')
    expect([pesos(180000), pesos(null)]).toEqual(['$180.000', '—'])
  })

  it('la fecha de fin de la preventa no pasa el día de Bogotá de la función (el formulario, como la base)', () => {
    expect(diaBogota('2026-10-24T18:00:00.000Z')).toBe('2026-10-24')
    // 10:00 p. m. del 24 en Bogotá ya es el 25 en UTC: cuenta el 24.
    expect(diaBogota('2026-10-25T03:00:00.000Z')).toBe('2026-10-24')
    expect(preventaPasaLaFuncion('2026-10-25', '2026-10-24')).toBe(true)
    expect(preventaPasaLaFuncion('2026-10-24', '2026-10-24')).toBe(false)
    expect(preventaPasaLaFuncion('2026-10-15', '2026-10-24')).toBe(false)
    expect(preventaPasaLaFuncion(null, '2026-10-24')).toBe(false)
    expect(preventaPasaLaFuncion('', '2026-10-24')).toBe(false)
  })

  it('el plazo del saldo: entero de 1 a 30, por defecto 1', () => {
    expect(DIAS_SALDO.porDefecto).toBe(1)
    expect([1, 2, 30].map(diasSaldoValido)).toEqual([true, true, true])
    expect([0, -1, 31, 1.5, null, undefined, Number.NaN].map(diasSaldoValido)).toEqual([false, false, false, false, false, false, false])
  })
})
