import { describe, it, expect } from 'vitest'
import { cuotaParaFecha, cuotaSiguiente, diasEntreISO, fechaCuota, fechaCuotaISO } from './fecha-cuota'

// Planes reales medidos en produccion el 2026-09-08 (todos `manual`, todos mensuales).
const SOENA = { fecha_inicio: '2026-04-15', frecuencia: 'mensual', total_cuotas: 6 }
const TRAPPVEL = { fecha_inicio: '2026-08-20', frecuencia: 'mensual', total_cuotas: 6 }
const TERMOTECH = { fecha_inicio: '2026-09-05', frecuencia: 'mensual', total_cuotas: 6 }

describe('fechaCuota — la misma respuesta que daba el cron', () => {
  it('la cuota 1 es la fecha de inicio, a las 05:00Z (medianoche Bogota)', () => {
    expect(fechaCuota('2026-04-15', 'mensual', 1).toISOString()).toBe('2026-04-15T05:00:00.000Z')
  })

  it('mensual suma un mes por cuota', () => {
    expect(fechaCuotaISO('2026-04-15', 'mensual', 6)).toBe('2026-09-15')
  })

  it('trimestral suma tres meses y anual doce', () => {
    expect(fechaCuotaISO('2026-01-10', 'trimestral', 2)).toBe('2026-04-10')
    expect(fechaCuotaISO('2026-01-10', 'anual', 2)).toBe('2027-01-10')
  })

  it('una frecuencia desconocida no inventa: devuelve el inicio', () => {
    expect(fechaCuotaISO('2026-01-10', 'semanal', 4)).toBe('2026-01-10')
  })

  it('documenta el desborde heredado de setMonth (31 de enero + 1 mes)', () => {
    // No es una regla nueva: es lo que el cron ha hecho siempre. Si algun dia se
    // corrige, esta prueba es la que tiene que cambiar, a proposito.
    expect(fechaCuotaISO('2026-01-31', 'mensual', 2)).toBe('2026-03-03')
  })
})

describe('cuotaParaFecha', () => {
  it('resuelve la cuota exacta cuando proximo_cobro coincide con su fecha', () => {
    expect(cuotaParaFecha(SOENA, '2026-09-15')).toEqual({ numero: 6, fechaEsperada: '2026-09-15', esUltima: true })
  })

  it('con una fecha intermedia toma la PROXIMA cuota, no la anterior', () => {
    // Un proximo_cobro escrito a mano el 1 de octubre cae en la cuota del 20.
    expect(cuotaParaFecha(TRAPPVEL, '2026-10-01')).toEqual({ numero: 3, fechaEsperada: '2026-10-20', esUltima: false })
  })

  it('devuelve null cuando el plan ya no tiene cuotas desde esa fecha', () => {
    expect(cuotaParaFecha(SOENA, '2026-09-16')).toBeNull()
  })

  it('un plan sin cuotas nunca resuelve', () => {
    expect(cuotaParaFecha({ ...TERMOTECH, total_cuotas: 0 }, '2026-09-05')).toBeNull()
  })
})

describe('cuotaSiguiente', () => {
  it('avanza una cuota', () => {
    expect(cuotaSiguiente(TERMOTECH, 1)).toEqual({ numero: 2, fechaEsperada: '2026-10-05', esUltima: false })
  })

  it('marca la ultima y despues de ella devuelve null', () => {
    expect(cuotaSiguiente(TERMOTECH, 5)).toEqual({ numero: 6, fechaEsperada: '2027-02-05', esUltima: true })
    expect(cuotaSiguiente(TERMOTECH, 6)).toBeNull()
  })
})

describe('diasEntreISO', () => {
  it('cuenta dias calendario con signo', () => {
    expect(diasEntreISO('2026-09-05', '2026-09-08')).toBe(3)
    expect(diasEntreISO('2026-09-08', '2026-09-05')).toBe(-3)
    expect(diasEntreISO('2026-09-08', '2026-09-08')).toBe(0)
  })

  it('cruza el cambio de mes y de anio', () => {
    expect(diasEntreISO('2026-12-30', '2027-01-02')).toBe(3)
  })
})
