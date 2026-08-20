import { describe, it, expect } from 'vitest'
import { fechaEmisionSegura, rangoDelMes } from './emitir-cuota-explicita'

describe('fechaEmisionSegura', () => {
  it('deja la fecha del cron cuando la cuota vence despues', () => {
    // Trappvel: el cron fecha el 13, la cuota vence el 20. Siete dias de margen.
    expect(fechaEmisionSegura('2026-08-13', '2026-08-20')).toBe('2026-08-13')
  })

  it('recorta al vencimiento cuando la cuota vence ANTES del dia de emision', () => {
    // Un cronograma explicito puede vencer el 5. Con el override del cron la
    // cuenta saldria fechada ocho dias despues de la fecha en que pide el pago.
    expect(fechaEmisionSegura('2026-08-13', '2026-08-05')).toBe('2026-08-05')
  })

  it('acepta emitir el mismo dia del vencimiento', () => {
    expect(fechaEmisionSegura('2026-08-15', '2026-08-15')).toBe('2026-08-15')
  })

  it('recorta tambien cuando el vencimiento cae en otro anio', () => {
    expect(fechaEmisionSegura('2027-01-13', '2026-12-20')).toBe('2026-12-20')
  })
})

describe('rangoDelMes', () => {
  it('cubre el mes completo, no solo el dia 15', () => {
    // El generador uniforme filtra por `fecha_esperada = dia 15`; por eso las
    // cuotas de Trappvel (dia 20) le eran invisibles. Aqui entra el mes entero.
    expect(rangoDelMes(2026, 8)).toEqual({ desde: '2026-08-01', hasta: '2026-08-31' })
  })

  it('resuelve los meses de 30 dias', () => {
    expect(rangoDelMes(2026, 9)).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' })
  })

  it('resuelve febrero, incluido el bisiesto', () => {
    expect(rangoDelMes(2026, 2)).toEqual({ desde: '2026-02-01', hasta: '2026-02-28' })
    expect(rangoDelMes(2028, 2)).toEqual({ desde: '2028-02-01', hasta: '2028-02-29' })
  })

  it('padea el mes de un digito', () => {
    expect(rangoDelMes(2027, 1)).toEqual({ desde: '2027-01-01', hasta: '2027-01-31' })
  })
})
