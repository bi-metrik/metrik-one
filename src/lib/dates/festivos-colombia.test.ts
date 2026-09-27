import { describe, it, expect } from 'vitest'
import { esHabilColombia, festivosColombia, pascua } from './festivos-colombia'

// Calendarios oficiales publicados. Los mismos que prueban calendario-co.py.
const OFICIAL: Record<number, string[]> = {
  2025: ['2025-01-01', '2025-01-06', '2025-03-24', '2025-04-17', '2025-04-18', '2025-05-01',
    '2025-06-02', '2025-06-23', '2025-06-30', '2025-07-20', '2025-08-07', '2025-08-18',
    '2025-10-13', '2025-11-03', '2025-11-17', '2025-12-08', '2025-12-25'],
  2026: ['2026-01-01', '2026-01-12', '2026-03-23', '2026-04-02', '2026-04-03', '2026-05-01',
    '2026-05-18', '2026-06-08', '2026-06-15', '2026-06-29', '2026-07-20', '2026-08-07',
    '2026-08-17', '2026-10-12', '2026-11-02', '2026-11-16', '2026-12-08', '2026-12-25'],
  // Los que estaban sembrados a mano en `festivos_colombia` (migracion 20260519000001).
  2027: ['2027-01-01', '2027-01-11', '2027-03-22', '2027-03-25', '2027-03-26', '2027-05-01',
    '2027-05-10', '2027-05-31', '2027-06-07', '2027-07-05', '2027-07-20', '2027-08-07',
    '2027-08-16', '2027-10-18', '2027-11-01', '2027-11-15', '2027-12-08', '2027-12-25'],
}

describe('festivosColombia', () => {
  for (const [anio, fechas] of Object.entries(OFICIAL)) {
    it(`coincide con el calendario oficial ${anio}`, () => {
      const calculadas = [...new Set(festivosColombia(Number(anio)).map((f) => f.fecha))].sort()
      expect(calculadas).toEqual([...new Set(fechas)].sort())
    })
  }

  it('dos festivos pueden caer el mismo lunes: 2025 trae 18 entradas y 17 fechas', () => {
    // Sagrado Corazon (27-jun → 30-jun) y San Pedro (29-jun → 30-jun) coinciden.
    expect(festivosColombia(2025)).toHaveLength(18)
    expect(new Set(festivosColombia(2025).map((f) => f.fecha)).size).toBe(17)
  })

  it('siempre hay calendario, tambien despues de 2027', () => {
    expect(festivosColombia(2028).length).toBe(18)
    expect(festivosColombia(2099).every((f) => f.fecha.startsWith('2099-'))).toBe(true)
  })

  it('los trasladados caen en lunes', () => {
    const trasladables = new Set(['Reyes Magos', 'San José', 'Ascensión del Señor', 'Corpus Christi',
      'Sagrado Corazón', 'San Pedro y San Pablo', 'Asunción de la Virgen', 'Día de la Raza',
      'Todos los Santos', 'Independencia de Cartagena'])
    for (let anio = 2025; anio <= 2060; anio++) {
      for (const f of festivosColombia(anio)) {
        if (!trasladables.has(f.descripcion)) continue
        expect(new Date(`${f.fecha}T00:00:00Z`).getUTCDay(), `${f.descripcion} ${f.fecha}`).toBe(1)
      }
    }
  })
})

describe('pascua', () => {
  it('Meeus', () => {
    expect(pascua(2026)).toBe('2026-04-05')
    expect(pascua(2027)).toBe('2027-03-28')
    expect(pascua(2028)).toBe('2028-04-16')
  })
})

describe('esHabilColombia', () => {
  it('festivo, fin de semana y dia habil', () => {
    expect(esHabilColombia('2026-10-12')).toBe(false) // Dia de la Raza, lunes
    expect(esHabilColombia('2026-09-27')).toBe(false) // domingo
    expect(esHabilColombia('2026-09-28')).toBe(true)
  })
})
