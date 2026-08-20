import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { particionarPorCronograma, planesConCronogramaExplicito } from './cronograma-explicito'

// Los dos planes activos que obligaron el corte: SOENA es uniforme (dia 15,
// monto igual todos los meses) y Trappvel tiene cronograma explicito (anticipo
// + 5x$833.333 + 1x$833.335, vencimiento el 20).
const SOENA = { id: 'plan-soena', monto: 1_750_000 }
const TRAPPVEL = { id: 'plan-trappvel', monto: 833_333 }

describe('particionarPorCronograma', () => {
  it('saca del camino uniforme al plan que tiene cronograma explicito', () => {
    const { uniformes, explicitos } = particionarPorCronograma(
      [SOENA, TRAPPVEL],
      new Set(['plan-trappvel']),
    )
    expect(uniformes).toEqual([SOENA])
    expect(explicitos).toEqual([TRAPPVEL])
  })

  it('retrocompat: sin filas en plan_cobro_cuotas TODO plan sigue siendo uniforme', () => {
    // Es la promesa literal de la migracion 20260630000001. Un plan que no
    // declara cronograma no puede cambiar de comportamiento.
    const { uniformes, explicitos } = particionarPorCronograma([SOENA, TRAPPVEL], [])
    expect(uniformes).toEqual([SOENA, TRAPPVEL])
    expect(explicitos).toEqual([])
  })

  it('acepta una lista, no solo un Set', () => {
    const { explicitos } = particionarPorCronograma([SOENA, TRAPPVEL], ['plan-trappvel'])
    expect(explicitos).toEqual([TRAPPVEL])
  })

  it('con la lista de planes vacia no inventa nada', () => {
    expect(particionarPorCronograma([], ['plan-trappvel'])).toEqual({ uniformes: [], explicitos: [] })
  })
})

function fakeSupabase(filas: { plan_cobro_id: string }[], onIn?: (ids: string[]) => void): SupabaseClient {
  return {
    from: () => {
      const q = {
        select: () => q,
        in: (_col: string, ids: string[]) => {
          onIn?.(ids)
          return q
        },
        then: (resolve: (v: { data: typeof filas }) => unknown) => resolve({ data: filas }),
      }
      return q
    },
  } as unknown as SupabaseClient
}

describe('planesConCronogramaExplicito', () => {
  it('devuelve los ids que tienen al menos una cuota, deduplicados', async () => {
    const sb = fakeSupabase([
      { plan_cobro_id: 'plan-trappvel' },
      { plan_cobro_id: 'plan-trappvel' },
      { plan_cobro_id: 'plan-trappvel' },
    ])
    const set = await planesConCronogramaExplicito(sb, ['plan-soena', 'plan-trappvel'])
    expect([...set]).toEqual(['plan-trappvel'])
  })

  it('no consulta cuando no hay planes que mirar', async () => {
    let consultado = false
    const sb = fakeSupabase([], () => { consultado = true })
    expect((await planesConCronogramaExplicito(sb, [])).size).toBe(0)
    expect(consultado).toBe(false)
  })
})
