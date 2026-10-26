/**
 * SOE-002, segunda parte: la barra «2º pago recibido» de la serie mensual descarta los
 * sobrantes de centavos igual que la cifra del panel.
 *
 * Fixture sintético con la forma de lo medido el 2026-10-08: julio con un sobrante de
 * $10,08 y septiembre con dos ($3,36 y $28,57). Los ids son inventados.
 *
 * ⚠️ Mutaciones corridas el 2026-10-08; cada una tumba al menos una prueba:
 *   no restar en `descontarSobrantesPorMes` ............................ 3
 *   restar el sobrante en cualquier punto que lo traiga, sin mirar el mes  1
 *   quitar `umbral_sobrantes` de la serie total ......................... 1
 *   tocar el recaudo además del segundo pago ............................ 1
 */
import { describe, it, expect } from 'vitest'
import {
  descontarSobrantesPorMes,
  descontarSobrantesPorCobro,
  normalizarSobrantes,
  sinSobrantes,
  type SobranteTramo2,
} from './segundo-pago'

const sobrantes: SobranteTramo2[] = [
  { cobro_id: 'c-jul', negocio_id: 'n-1', codigo: 'V9001', fecha: '2026-07-22', anio: 2026, mes: 7, valor: 10.08 },
  { cobro_id: 'c-sep-a', negocio_id: 'n-2', codigo: 'V9002', fecha: '2026-09-04', anio: 2026, mes: 9, valor: 3.36 },
  { cobro_id: 'c-sep-b', negocio_id: 'n-3', codigo: 'V9003', fecha: '2026-09-16', anio: 2026, mes: 9, valor: 28.57 },
]

const punto = (mes: number, segundo: number, recaudo = 5_000_000) => ({
  anio: 2026, mes, label: `m${mes}`, segundo_pago: segundo, honorario_recaudado: recaudo,
})

describe('serie total', () => {
  it('resta a cada mes sus sobrantes y deja el resto igual', () => {
    const r = descontarSobrantesPorMes(
      [punto(6, 3_571_428.6), punto(7, 1_428_581.52), punto(8, 0), punto(9, 2_053_117.65)],
      sobrantes,
    )
    expect(r.map((p) => p.segundo_pago)).toEqual([3_571_428.6, 1_428_571.44, 0, 2_053_085.72])
  })

  it('no toca el recaudo: esa plata sí entró', () => {
    const [p] = descontarSobrantesPorMes([punto(9, 2_053_117.65, 7_000_000)], sobrantes)
    expect(p.honorario_recaudado).toBe(7_000_000)
  })

  it('nunca deja una barra en negativo', () => {
    const [p] = descontarSobrantesPorMes([punto(7, 5)], sobrantes)
    expect(p.segundo_pago).toBe(0)
  })
})

describe('serie por vendedor o seccional', () => {
  it('resta el sobrante al punto que trae su cobro, y solo en su mes', () => {
    const r = descontarSobrantesPorCobro(
      [
        { anio: 2026, mes: 9, segundo_pago: 1_000_028.57, cobro_ids: ['c-sep-b', 'otro'] },
        { anio: 2026, mes: 9, segundo_pago: 500_003.36, cobro_ids: ['c-sep-a'] },
        // Un cobro de julio que, por lo que sea, aparece en un punto de agosto: no se resta.
        { anio: 2026, mes: 8, segundo_pago: 100, cobro_ids: ['c-jul'] },
      ],
      sobrantes,
    )
    expect(r.map((p) => p.segundo_pago)).toEqual([1_000_000, 500_000, 100])
  })
})

type SerieTotal = { serie: ReturnType<typeof punto>[]; tasa_recaudo_global: null; umbral_sobrantes?: number | null }

describe('las tres juntas', () => {
  it('con sobrantes marca la serie total con el umbral', () => {
    const total: SerieTotal = { serie: [punto(9, 2_053_117.65)], tasa_recaudo_global: null }
    const r = sinSobrantes(
      total,
      { serie: [] },
      { serie: [] },
      { umbral_migaja: 1000, sobrantes },
    )
    expect(r.serie?.umbral_sobrantes).toBe(1000)
    expect(r.serie?.serie[0].segundo_pago).toBe(2_053_085.72)
  })

  it('sin sobrantes (RPC caída) devuelve todo tal cual y sin umbral', () => {
    const serie: SerieTotal = { serie: [punto(9, 2_053_117.65)], tasa_recaudo_global: null }
    const r = sinSobrantes(serie, null, null, null)
    expect(r.serie).toBe(serie)
    expect(r.serie?.umbral_sobrantes).toBeUndefined()
  })
})

describe('normalizarSobrantes', () => {
  it('convierte numeric en cadena y rechaza respuestas vacías', () => {
    const r = normalizarSobrantes({ umbral_migaja: '1000', sobrantes: [{ ...sobrantes[0], valor: '10.08' }] })
    expect(r?.umbral_migaja).toBe(1000)
    expect(r?.sobrantes[0].valor).toBe(10.08)
    expect(normalizarSobrantes(null)).toBeNull()
    expect(normalizarSobrantes({})).toBeNull()
  })
})
