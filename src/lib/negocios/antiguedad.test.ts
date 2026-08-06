import { describe, it, expect } from 'vitest'
import { diasDesde, etiquetaAntiguedad } from './antiguedad'

// Reloj fijo: estas pruebas no pueden depender de cuándo se corran.
const AHORA = new Date('2026-08-06T17:00:00.000Z').getTime()

describe('diasDesde', () => {
  it('cuenta días CUMPLIDOS, no cambios de fecha en el calendario', () => {
    // Ayer a las 23:00 UTC: cambió el día, pero no han pasado 24 horas.
    expect(diasDesde('2026-08-05T23:00:00.000Z', AHORA)).toBe(0)
    // 24 horas exactas.
    expect(diasDesde('2026-08-05T17:00:00.000Z', AHORA)).toBe(1)
    expect(diasDesde('2026-08-05T16:59:59.000Z', AHORA)).toBe(1)
  })

  // Casos reales de SOENA medidos el 2026-08-06: los tres faltantes de la pestaña.
  it('reproduce la antigüedad de los faltantes vivos', () => {
    expect(diasDesde('2026-07-15T00:00:00.000Z', AHORA)).toBe(22) // V0072
    expect(diasDesde('2026-07-27T00:00:00.000Z', AHORA)).toBe(10) // V0124
    expect(diasDesde('2026-08-06T15:33:00.000Z', AHORA)).toBe(0)  // V0292, creado hoy
  })

  // Un dato ausente se muestra ausente. Un 0 diría "recién creado", que es una
  // afirmación falsa sobre algo que no sabemos.
  it('sin fecha devuelve null, nunca cero', () => {
    expect(diasDesde(null, AHORA)).toBeNull()
    expect(diasDesde(undefined, AHORA)).toBeNull()
    expect(diasDesde('', AHORA)).toBeNull()
    expect(diasDesde('no es una fecha', AHORA)).toBeNull()
  })

  it('una fecha futura da 0, no un negativo', () => {
    // Pasa por desfase de reloj entre servidor y base. "-1 días" no significa nada
    // en una pantalla de cartera.
    expect(diasDesde('2026-08-07T00:00:00.000Z', AHORA)).toBe(0)
  })

  it('un reloj inválido no inventa un número', () => {
    expect(diasDesde('2026-07-15T00:00:00.000Z', Number.NaN)).toBeNull()
  })
})

describe('etiquetaAntiguedad', () => {
  it('singular, plural y el día de hoy', () => {
    expect(etiquetaAntiguedad(0)).toBe('hoy')
    expect(etiquetaAntiguedad(1)).toBe('1 día')
    expect(etiquetaAntiguedad(22)).toBe('22 días')
  })

  it('sin dato no escribe nada', () => {
    expect(etiquetaAntiguedad(null)).toBe('')
    expect(etiquetaAntiguedad(undefined)).toBe('')
  })
})
