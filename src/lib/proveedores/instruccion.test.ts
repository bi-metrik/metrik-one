import { describe, expect, it } from 'vitest'

import { INSTRUCCION_VERSION, instruccionVigente } from './instruccion'
import { conFechaDeHoy } from './instruccion-texto'

describe('la instrucción del motor vive en el repo', () => {
  it('la vigente es v13, esquema 0.3, y sale con la fecha de hoy', () => {
    expect(INSTRUCCION_VERSION).toBe('v13')
    const t = instruccionVigente('2027-03-01')
    expect(t).toMatch(/^# Instrucción de extracción de tarifarios · v13/)
    expect(t).toContain('"esquema_version": "0.3"')
    expect(t).toContain('Fecha de hoy: 2027-03-01')
    expect(t).not.toContain('Fecha de hoy: 2026-10-19')
    // Llegó limpia: sin correos ni cuentas.
    expect(t).not.toMatch(/[\p{L}\p{N}_.+-]+@[\p{L}\p{N}_-]+\.[a-z]{2,}/iu)
  })

  it('si la instrucción no trae la fecha, se agrega', () => {
    expect(conFechaDeHoy('Instrucción sin fecha', '2027-03-01')).toBe('Instrucción sin fecha\n\nFecha de hoy: 2027-03-01.\n')
    expect(conFechaDeHoy('a Fecha de hoy: 2020-01-01. b', '2027-03-01')).toBe('a Fecha de hoy: 2027-03-01. b')
    expect(() => conFechaDeHoy('x', '1-mar')).toThrow()
  })
})
