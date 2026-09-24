import { describe, expect, it } from 'vitest'
import {
  armarTablero,
  clicsEntre,
  clicsPorDia,
  diasSinMedicion,
  estadoEnDia,
  estadosPorDia,
  inicioDelPiloto,
  mesConMeta,
  periodoAnterior,
  rangoDe,
  sinClicsUltimos7,
  totalesDelRango,
  variacion,
  type DatosPiloto,
} from './ferreteria'
import { alarmaCierre, alarmaPisoOctubre, metaProrrateada, semaforoRitmo, TASAS_META } from '@/lib/ferreteria/metas'

const m = (publicacion_id: string, fecha: string, clics_acumulados: number) => ({ publicacion_id, fecha, clics_acumulados })

describe('diferencia de acumulados', () => {
  it('los clics del día son la diferencia contra la medición anterior del mismo aviso', () => {
    const { porDia } = clicsPorDia([m('a', '2026-10-01', 10), m('a', '2026-10-02', 14), m('b', '2026-10-01', 3), m('b', '2026-10-02', 4)])
    expect(porDia.get('2026-10-02')).toBe(5)
  })

  it('la primera medición de un aviso es línea base: no suma a ningún día', () => {
    const { porDia } = clicsPorDia([m('a', '2026-10-01', 40)])
    expect(porDia.get('2026-10-01')).toBeUndefined()
  })

  it('el orden de llegada no importa', () => {
    const { porDia } = clicsPorDia([m('a', '2026-10-03', 9), m('a', '2026-10-01', 2), m('a', '2026-10-02', 5)])
    expect([porDia.get('2026-10-02'), porDia.get('2026-10-03')]).toEqual([3, 4])
  })
})

describe('días faltantes', () => {
  it('si el cron no corrió, la diferencia cae entera el día medido y no se reparte', () => {
    const med = [m('a', '2026-10-01', 10), m('a', '2026-10-04', 22)]
    const { porDia } = clicsPorDia(med)
    expect(porDia.get('2026-10-04')).toBe(12)
    expect(porDia.get('2026-10-02')).toBeUndefined()
    expect(porDia.get('2026-10-03')).toBeUndefined()
  })

  it('marca los días del rango sin ninguna medición', () => {
    const med = [m('a', '2026-10-01', 10), m('a', '2026-10-04', 22)]
    expect(diasSinMedicion(med, { desde: '2026-10-01', hasta: '2026-10-05' })).toEqual(['2026-10-02', '2026-10-03', '2026-10-05'])
  })
})

describe('reinicio del contador', () => {
  it('un salto hacia abajo no resta: cuenta lo que marca desde el reinicio', () => {
    expect(clicsEntre(30, 4)).toEqual({ clics: 4, reinicio: true })
    expect(clicsEntre(30, 0)).toEqual({ clics: 0, reinicio: true })
    expect(clicsEntre(30, 35)).toEqual({ clics: 5, reinicio: false })
  })

  it('un aviso republicado que vuelve a cero sigue sumando después', () => {
    const r = clicsPorDia([m('a', '2026-10-01', 30), m('a', '2026-10-02', 0), m('a', '2026-10-03', 6)])
    expect([r.porDia.get('2026-10-02'), r.porDia.get('2026-10-03')]).toEqual([0, 6])
    expect(r.reinicios).toBe(1)
  })
})

describe('comparación entre periodos', () => {
  it('el periodo anterior tiene la misma duración y termina el día antes', () => {
    expect(periodoAnterior({ desde: '2026-10-08', hasta: '2026-10-14' })).toEqual({ desde: '2026-10-01', hasta: '2026-10-07' })
    expect(rangoDe('7d', '2026-09-24', '2026-10-14')).toEqual({ desde: '2026-10-08', hasta: '2026-10-14' })
    expect(rangoDe('30d', '2026-09-24', '2026-10-30')).toEqual({ desde: '2026-10-01', hasta: '2026-10-30' })
    expect(rangoDe('piloto', '2026-09-24', '2026-10-30')).toEqual({ desde: '2026-09-24', hasta: '2026-10-30' })
  })

  it('variación con signo; sin base (cero o sin dato) no hay porcentaje', () => {
    expect(variacion(15, 10)).toBe(50)
    expect(variacion(5, 10)).toBe(-50)
    expect(variacion(-5, -10)).toBe(50)
    expect(variacion(10, 0)).toBeNull()
    expect(variacion(null, 10)).toBeNull()
  })
})

describe('estado de las publicaciones por día', () => {
  const pub = { id: 'a', estado: 'agotada', desde: '2026-09-20' }
  const cambios = [
    { publicacion_id: 'a', fecha: '2026-09-23', instante: '2026-09-23T17:00:00Z', anterior: 'activa', nuevo: 'agotada' },
  ]
  it('antes del primer cambio vale el estado anterior; después, el nuevo; antes de existir, nada', () => {
    expect(estadoEnDia(pub, cambios, '2026-09-19')).toBeNull()
    expect(estadoEnDia(pub, cambios, '2026-09-22')).toBe('activa')
    expect(estadoEnDia(pub, cambios, '2026-09-23')).toBe('agotada')
    expect(estadoEnDia({ ...pub, estado: 'activa' }, [], '2026-09-22')).toBe('activa')
  })
  it('cuenta activas, en revisión y agotadas por día', () => {
    const pubs = [pub, { id: 'b', estado: 'en_revision', desde: '2026-09-22' }]
    expect(estadosPorDia(pubs, cambios, ['2026-09-21', '2026-09-23'])).toEqual([
      { fecha: '2026-09-21', activa: 1, en_revision: 0, agotada: 0 },
      { fecha: '2026-09-23', activa: 0, en_revision: 1, agotada: 1 },
    ])
  })
})

const DATOS: DatosPiloto = {
  publicaciones: [
    { id: 'a', estado: 'activa', desde: '2026-10-01' },
    { id: 'b', estado: 'activa', desde: '2026-10-01' },
  ],
  cambios: [],
  mediciones: [m('a', '2026-10-01', 5), m('a', '2026-10-05', 25), m('b', '2026-10-01', 1), m('b', '2026-10-09', 1)],
  conversaciones: [{ fecha: '2026-10-03' }, { fecha: '2026-10-04' }, { fecha: '2026-10-09' }, { fecha: '2026-10-10' }],
  ventas: [
    { fecha_primer_pago: '2026-10-04', precio_final: 120_000, costo_dia: 80_000, ganancia: 26_125 },
    { fecha_primer_pago: '2026-10-09', precio_final: 60_000, costo_dia: 40_000, ganancia: 13_063 },
    // Contra entrega sin pagar: fuera de toda cuenta de ventas, sale en "por cobrar".
    { fecha_primer_pago: null, precio_final: 50_000, costo_dia: 30_000, ganancia: 13_686 },
  ],
}

describe('totales y tablero', () => {
  it('tasas, ticket y ganancia promedio salen solo de ventas pagadas en el rango', () => {
    const t = totalesDelRango(DATOS, { desde: '2026-10-01', hasta: '2026-10-10' })
    expect(t).toMatchObject({ clics: 20, conversaciones: 4, ventas: 2, ingreso: 180_000, ganancia: 39_188, activas: 2 })
    expect(t.tasaConversacion).toBeCloseTo(0.2)
    expect(t.tasaVenta).toBe(0.5)
    expect(t.ticketPromedio).toBe(90_000)
    expect(t.gananciaPromedio).toBe(19_594)
    expect(t.clicsPorActiva).toBe(10)
  })

  it('el tablero compara contra el periodo anterior y no compara antes del piloto', () => {
    const t = armarTablero(DATOS, '7d', '2026-10-14')
    expect(t.rango).toEqual({ desde: '2026-10-08', hasta: '2026-10-14' })
    expect(t.sinComparacion).toBe(false)
    expect(t.actual.ventas).toBe(1)
    expect(t.previo.ventas).toBe(1)
    expect(t.porCobrar).toEqual({ ventas: 1, valor: 50_000 })
    expect(t.mesEnCurso?.ventas).toBe(2)
    expect(t.clics.at(-1)?.acumulado).toBe(0)
    expect(armarTablero(DATOS, 'piloto', '2026-10-14').sinComparacion).toBe(true)
    expect(inicioDelPiloto(DATOS, '2026-10-14')).toBe('2026-10-01')
  })

  it('sin clics en 7 días: activas ya medidas que no sumaron clics', () => {
    expect(sinClicsUltimos7(DATOS, '2026-10-14')).toBe(2)
    expect(sinClicsUltimos7(DATOS, '2026-10-09')).toBe(1)
  })
})

describe('metas', () => {
  it('meta prorrateada por día y semáforo de ritmo', () => {
    expect(metaProrrateada(31, '2026-10', 10)).toBe(10)
    expect(semaforoRitmo(9, 10)?.semaforo).toBe('verde')
    expect(semaforoRitmo(6, 10)?.semaforo).toBe('amarillo')
    expect(semaforoRitmo(5.9, 10)?.semaforo).toBe('rojo')
    expect(semaforoRitmo(3, 0)).toBeNull()
  })

  it('alarma de cierre solo con 30 conversaciones o más', () => {
    expect(alarmaCierre(29, 0)).toBe(false)
    expect(alarmaCierre(40, 1)).toBe(true)
    expect(alarmaCierre(40, 2)).toBe(false)
    expect(TASAS_META.clicAConversacion).toBeNull()
  })

  it('piso de octubre: solo con el mes cerrado y menos de 3 ventas', () => {
    expect(alarmaPisoOctubre(2, '2026-10-31')).toBe(false)
    expect(alarmaPisoOctubre(2, '2026-11-01')).toBe(true)
    expect(alarmaPisoOctubre(3, '2026-11-01')).toBe(false)
  })

  it('el mes en curso con meta: acumulado contra meta a hoy y curva del mes', () => {
    const r = mesConMeta(DATOS, '2026-10-10')
    expect(r.meta?.ventas).toBe(10)
    expect(r.ventas?.acumulado).toBe(2)
    expect(r.ventas?.metaAHoy).toBeCloseTo((10 * 10) / 31)
    expect(r.ventas?.ritmo?.semaforo).toBe('amarillo')
    expect(r.ventas?.curva).toHaveLength(31)
    expect(r.ventas?.curva[10].real).toBeNull()
    expect(r.conversaciones?.acumulado).toBe(4)
    expect(r.bajoPisoActivas).toBe(true)
    expect(r.totalPiloto).toEqual({ ventas: 2, ganancia: 39_188, metaVentas: 63, metaGanancia: 2_464_920 })
  })

  it('antes de octubre no hay meta', () => {
    const r = mesConMeta(DATOS, '2026-09-28')
    expect(r.meta).toBeNull()
    expect(r.ventas).toBeNull()
    expect(r.bajoPisoActivas).toBe(false)
  })
})
