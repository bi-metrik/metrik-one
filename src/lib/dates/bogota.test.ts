import { describe, it, expect } from 'vitest'
import {
  formatFecha,
  formatBogotaFechaCorta,
  formatBogotaFechaCortaAno,
  formatBogotaFechaHora,
  formatBogotaFechaLarga,
  todayBogotaISO,
} from './bogota'

// El proceso de prueba corre en la zona de quien lo ejecute (en CI, UTC; en el
// Mac de Mauricio, Bogota). Estas pruebas comprueban que la salida NO dependa de
// eso: es justo la propiedad que faltaba y la que rompia la hidratacion.

describe('formatFecha — instantes (timestamptz)', () => {
  // 2026-08-13T03:45:00Z = 2026-08-12 22:45 en Bogota. Es el instante medido en
  // produccion el 2026-08-12, cuando el encabezado disparaba el error #418.
  const nocheEnColombia = '2026-08-13T03:45:00Z'

  it('lee el instante en Bogota, no en UTC', () => {
    expect(formatBogotaFechaCorta(nocheEnColombia)).toBe('12 de ago')
  })

  it('un Date se trata como instante', () => {
    expect(formatBogotaFechaCorta(new Date(nocheEnColombia))).toBe('12 de ago')
  })

  it('respeta un offset explicito distinto de Z', () => {
    // Las 00:30 del 13 en Bogota, escritas con su offset.
    expect(formatBogotaFechaCorta('2026-08-13T00:30:00-05:00')).toBe('13 de ago')
  })

  it('la hora sale en horario de Colombia', () => {
    expect(formatBogotaFechaHora(nocheEnColombia)).toContain('12 de ago')
    expect(formatBogotaFechaHora(nocheEnColombia)).toMatch(/10:45/)
  })
})

describe('formatFecha — fechas civiles (columna date)', () => {
  // Una columna `date` ya viene en el calendario de Colombia. Leerla en Bogota
  // la retrocederia un dia, porque `new Date('2026-08-15')` es medianoche UTC.
  it('no retrocede el dia de una fecha sin zona', () => {
    expect(formatBogotaFechaCorta('2026-08-15')).toBe('15 de ago')
    expect(formatBogotaFechaCortaAno('2026-01-01')).toBe('1 de ene de 2026')
  })

  it('el 1 de enero no se cae al ano anterior', () => {
    expect(formatFecha('2026-01-01', { year: 'numeric' })).toBe('2026')
  })

  it('acepta fecha con hora pero sin zona, y la toma literal', () => {
    expect(formatBogotaFechaHora('2026-08-15T08:00:00')).toContain('15 de ago')
  })
})

describe('formatFecha — entradas invalidas', () => {
  it('devuelve undefined en vez de "Invalid Date"', () => {
    for (const v of [null, undefined, '', 'no es fecha', '2026-13-45']) {
      expect(formatFecha(v, { day: 'numeric', month: 'short' })).toBeUndefined()
    }
  })
})

describe('formatBogotaFechaLarga', () => {
  it('capitaliza y usa el dia de Bogota', () => {
    expect(formatBogotaFechaLarga(new Date('2026-08-13T03:45:00Z')))
      .toBe('Miércoles, 12 de agosto de 2026')
  })
})

describe('todayBogotaISO', () => {
  it('sigue dando el dia civil de Bogota', () => {
    expect(todayBogotaISO(new Date('2026-08-13T03:45:00Z'))).toBe('2026-08-12')
  })
})
