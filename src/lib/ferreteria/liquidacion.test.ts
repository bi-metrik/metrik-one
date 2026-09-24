import { describe, expect, it } from 'vitest'
import {
  PARTE_METRIK,
  formatoPesosConSigno,
  liquidacionMensual,
  nombreMes,
  repartirGanancia,
  sentidoLiquidacion,
} from './liquidacion'

const v = (fecha_venta: string, precio_final: number, costo_dia: number, ganancia: number) => ({
  fecha_venta,
  precio_final,
  costo_dia,
  ganancia,
})

describe('liquidación mensual', () => {
  it('la parte de MeTRIK es la mitad', () => {
    expect(PARTE_METRIK).toBe(0.5)
  })

  it('mes positivo: MeTRIK cobra la mitad de la ganancia', () => {
    const [sep] = liquidacionMensual([v('2026-09-03', 120_000, 80_000, 26_125), v('2026-09-20', 60_000, 40_000, 13_063)], '2026-10-02')
    expect(sep).toEqual({
      mes: '2026-09',
      estado: 'cerrado',
      ventas: 2,
      ingreso: 180_000,
      costo: 120_000,
      ganancia: 39_188,
      parteDimpro: 19_594,
      parteMetrik: 19_594,
    })
    expect(sentidoLiquidacion(sep.parteMetrik)).toEqual({ texto: 'MeTRIK cobra a Dimpro', valor: 19_594 })
  })

  it('mes negativo: la pérdida también se reparte y MeTRIK aporta la mitad', () => {
    const [oct] = liquidacionMensual([v('2026-10-05', 50_000, 70_000, -19_927)], '2026-10-06')
    expect(oct.estado).toBe('abierto')
    expect(oct.ganancia).toBe(-19_927)
    expect(oct.parteMetrik).toBe(-9_963.5)
    expect(oct.parteDimpro).toBe(-9_963.5)
    expect(oct.parteMetrik + oct.parteDimpro).toBe(oct.ganancia)
    expect(sentidoLiquidacion(oct.parteMetrik)).toEqual({ texto: 'MeTRIK aporta a Dimpro', valor: 9_963.5 })
  })

  it('mes mixto: las pérdidas se restan antes de repartir, sin piso en cero', () => {
    const [m] = liquidacionMensual(
      [v('2026-11-01', 120_000, 80_000, 26_125), v('2026-11-15', 50_000, 70_000, -19_927), v('2026-11-30', 30_000, 60_000, -27_082)],
      '2026-12-01',
    )
    expect(m.ventas).toBe(3)
    expect(m.ganancia).toBe(-20_884)
    expect(m.parteMetrik).toBe(-10_442)
    expect(m.parteDimpro).toBe(-10_442)
  })

  it('cada mes se liquida solo: una pérdida no se arrastra al mes siguiente', () => {
    const meses = liquidacionMensual(
      [v('2026-09-10', 50_000, 70_000, -20_000), v('2026-10-10', 120_000, 80_000, 26_000)],
      '2026-10-20',
    )
    expect(meses.map((m) => [m.mes, m.estado, m.parteMetrik])).toEqual([
      ['2026-10', 'abierto', 13_000],
      ['2026-09', 'cerrado', -10_000],
    ])
  })

  it('el mes sale de la fecha de la venta, no de cuándo se registró', () => {
    const meses = liquidacionMensual([v('2026-09-30', 10_000, 5_000, 3_578), v('2026-10-01', 10_000, 5_000, 3_578)], '2026-10-01')
    expect(meses.map((m) => m.mes)).toEqual(['2026-10', '2026-09'])
  })

  it('sin ventas no hay meses', () => {
    expect(liquidacionMensual([], '2026-10-01')).toEqual([])
  })

  it('las dos partes suman exacto aun con centavos impares', () => {
    const r = repartirGanancia(1)
    expect(r.metrik + r.dimpro).toBe(1)
    expect(repartirGanancia(0)).toEqual({ dimpro: 0, metrik: 0 })
    expect(sentidoLiquidacion(0).valor).toBe(0)
  })
})

describe('formato', () => {
  it('el signo va antes del símbolo', () => {
    expect(formatoPesosConSigno(-12_000)).toBe('-$12.000')
    expect(formatoPesosConSigno(12_000)).toBe('$12.000')
  })
  it('nombre del mes', () => {
    expect(nombreMes('2026-09')).toBe('septiembre 2026')
  })
})
