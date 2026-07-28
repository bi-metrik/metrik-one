import { describe, it, expect } from 'vitest'
import { documentoVigenteEn, diasAlObjetivo, parseFechaISO } from './vigencia'

describe('documentoVigenteEn', () => {
  it('reproduce el caso real que originó la regla (cliente de Cali)', () => {
    // Certificado bancario del 17 de julio, vigencia operativa de 20 días.
    // Sirve para una cita de comienzos de agosto; no sirve para la tercera semana.
    expect(documentoVigenteEn('2026-07-17', '2026-08-03', 20)).toBe(true)
    expect(documentoVigenteEn('2026-07-17', '2026-08-19', 20)).toBe(false)
  })

  it('valida contra el día de la cita, no contra el día de carga', () => {
    // Mismo documento, misma antigüedad al cargarlo: lo que decide es la cita.
    expect(documentoVigenteEn('2026-07-01', '2026-07-20', 20)).toBe(true)
    expect(documentoVigenteEn('2026-07-01', '2026-07-25', 20)).toBe(false)
  })

  it('el límite exacto pasa y un día más no', () => {
    expect(documentoVigenteEn('2026-07-01', '2026-07-21', 20)).toBe(true)
    expect(documentoVigenteEn('2026-07-01', '2026-07-22', 20)).toBe(false)
  })

  it('un documento posterior a la cita también sirve: es más nuevo', () => {
    expect(documentoVigenteEn('2026-08-10', '2026-08-01', 20)).toBe(true)
  })

  it('usa 30 días cuando no se especifica vigencia', () => {
    expect(documentoVigenteEn('2026-07-01', '2026-07-31', undefined)).toBe(true)
    expect(documentoVigenteEn('2026-07-01', '2026-08-01', undefined)).toBe(false)
  })

  it('devuelve null si falta una fecha o no parsea, en vez de declarar vencido', () => {
    // Sin datos no se afirma que algo esté vencido: bloquear un trámite por una
    // fecha ilegible es peor que dejarlo pasar y que lo revise una persona.
    expect(documentoVigenteEn(null, '2026-08-01', 20)).toBeNull()
    expect(documentoVigenteEn('2026-07-01', '', 20)).toBeNull()
    expect(documentoVigenteEn('17/07/2026', '2026-08-01', 20)).toBeNull()
    expect(documentoVigenteEn('no es fecha', '2026-08-01', 20)).toBeNull()
  })

  it('cruza fin de mes y fin de año sin desfase', () => {
    expect(documentoVigenteEn('2026-01-25', '2026-02-10', 20)).toBe(true)
    expect(documentoVigenteEn('2026-12-20', '2027-01-05', 20)).toBe(true)
    expect(documentoVigenteEn('2026-12-20', '2027-01-15', 20)).toBe(false)
  })

  it('maneja el año bisiesto', () => {
    expect(parseFechaISO('2024-02-29')).not.toBeNull()
    expect(documentoVigenteEn('2024-02-29', '2024-03-10', 20)).toBe(true)
  })
})

describe('parseFechaISO', () => {
  it('rechaza fechas imposibles que Date.UTC normalizaría en silencio', () => {
    expect(parseFechaISO('2026-02-31')).toBeNull()
    expect(parseFechaISO('2026-13-01')).toBeNull()
    expect(parseFechaISO('2026-00-10')).toBeNull()
    expect(parseFechaISO('2025-02-29')).toBeNull() // 2025 no es bisiesto
  })

  it('tolera timestamp completo y espacios', () => {
    expect(parseFechaISO('2026-07-17T10:30:00Z')).toBe(Date.UTC(2026, 6, 17))
    expect(parseFechaISO('  2026-07-17  ')).toBe(Date.UTC(2026, 6, 17))
  })
})

describe('diasAlObjetivo', () => {
  it('cuenta los días que tendrá el documento el día de la cita', () => {
    expect(diasAlObjetivo('2026-07-17', '2026-08-19')).toBe(33)
    expect(diasAlObjetivo('2026-07-17', '2026-07-17')).toBe(0)
  })

  it('devuelve null sin fechas válidas', () => {
    expect(diasAlObjetivo('2026-07-17', null)).toBeNull()
  })
})
