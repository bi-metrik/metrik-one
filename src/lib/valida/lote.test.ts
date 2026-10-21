import { describe, expect, it } from 'vitest'
import {
  autorizadoHasta,
  claveIdempotenciaFila,
  concurrenciaDelLote,
  filaConsume,
  lotesSimultaneos,
  partesDelPdf,
  recortarAlSaldo,
} from './lote'

describe('autorización del lote', () => {
  it('dos horas si caben en el día de Bogotá', () => {
    expect(autorizadoHasta(new Date('2026-10-15T15:00:00Z')).toISOString()).toBe('2026-10-15T17:00:00.000Z')
  })

  it('nunca más allá de la medianoche de Bogotá (la mora se mide por día)', () => {
    // 22:30 en Bogotá = 03:30 UTC del día siguiente; la medianoche de Bogotá es 05:00 UTC.
    expect(autorizadoHasta(new Date('2026-10-16T03:30:00Z')).toISOString()).toBe('2026-10-16T05:00:00.000Z')
  })
})

describe('bolsa', () => {
  it('una fila sin nombre de 2+ ni documento de 3+ no gasta consulta (Valida la rechaza sin cobrar)', () => {
    expect(filaConsume({ tipo: 'natural', nombre: 'Ana' })).toBe(true)
    expect(filaConsume({ tipo: 'natural', documento: { tipo: 'CC', numero: '123' } })).toBe(true)
    expect(filaConsume({ tipo: 'natural' })).toBe(false)
    expect(filaConsume({ tipo: 'natural', nombre: 'A' })).toBe(false)
  })

  it('recorta al saldo en el orden del archivo, sin contar las que no gastan', () => {
    const filas = [
      { input: { tipo: 'natural' as const, nombre: 'Uno' } },
      { input: { tipo: 'natural' as const } },
      { input: { tipo: 'natural' as const, nombre: 'Dos' } },
      { input: { tipo: 'natural' as const, nombre: 'Tres' } },
    ]
    expect(recortarAlSaldo(filas, 2).map((f) => f.input.nombre ?? '-')).toEqual(['Uno', '-', 'Dos'])
  })
})

describe('ritmo y piezas', () => {
  it('concurrencia: la del lote, la del entorno, o 8; nunca más de 20', () => {
    expect(concurrenciaDelLote(null, undefined)).toBe(8)
    expect(concurrenciaDelLote(null, '6')).toBe(6)
    expect(concurrenciaDelLote(4, '6')).toBe(4)
    expect(concurrenciaDelLote(null, '50')).toBe(8)
    expect(lotesSimultaneos(undefined)).toBe(3)
  })

  it('PDF en partes de 500; llave de idempotencia dentro del límite de Valida (64)', () => {
    expect([0, 1, 500, 501, 10_000].map(partesDelPdf)).toEqual([0, 1, 1, 2, 20])
    expect(claveIdempotenciaFila('00000000-0000-4000-8000-000000000001').length).toBeLessThanOrEqual(64)
  })
})
