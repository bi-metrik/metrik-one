import { describe, expect, it } from 'vitest'
import { lotesDeLogs, resumir, tabla } from './red-resumen.mjs'

const T = Date.UTC(2026, 9, 6, 15, 0, 0) // 10:00 en Bogota

const lote = (persona, eventos) => ({ ws: 'soena', persona, operador: 'Claro', eventos })
const fila = (id, l) => JSON.stringify({ id, message: `[red-piloto] ${JSON.stringify(l)}` })

const pulso = (id, sw = false) => ({
  tipo: 'pulso', id, t0: T, t1: T + 300_000, visible_ms: 300_000, offline_ms: 0, sw,
  vercel: { n: 20, perdidas: 2, p95: 400 }, control: { n: 20, perdidas: 0, p95: 150 },
})

describe('resumen del piloto de red', () => {
  it('deduplica filas del log y eventos repetidos entre lotes', () => {
    const l1 = lote('jessica tejada', [pulso('p1'), { tipo: 'corte', id: 'c1', inicio: T, dur_ms: 6_000, vercel: true, control: false, sw: false }])
    // El mismo corte llega otra vez en otro lote (la bandeja lo reenvio).
    const l2 = lote('jessica tejada', [{ tipo: 'corte', id: 'c1', inicio: T, dur_ms: 6_000, vercel: true, control: false, sw: false }])
    const lineas = [fila('a', l1), fila('a', l1), fila('b', l2), 'basura', JSON.stringify({ id: 'z', message: '[rum] {}' })]
    const lotes = lotesDeLogs(lineas)
    expect(lotes).toHaveLength(2)
    const [r] = resumir(lotes)
    expect(r).toMatchObject({
      fecha: '2026-10-06',
      persona: 'jessica tejada',
      operador: 'Claro',
      minutosMedidos: 5,
      vercel: { sondas: 20, perdidas: 2, p95Mediana: 400 },
      cortes: { total: 1, soloVercel: 1, internet: 0, segundos: 6 },
    })
  })

  it('separa internet caido de camino a Vercel, cuenta fallas por superficie y el % con SW', () => {
    const l = lote(null, [
      pulso('p1', true),
      pulso('p2', false),
      { tipo: 'corte', id: 'c1', inicio: T, dur_ms: 4_000, vercel: true, control: true, sw: true },
      { tipo: 'falla', id: 'f1', t: T, superficie: 'carga', recuperado: true },
      { tipo: 'falla', id: 'f2', t: T, superficie: 'carga' },
    ])
    const [r] = resumir([l])
    expect(r.persona).toBe('(sin identificar)')
    expect(r.swPct).toBe(50)
    expect(r.cortes).toMatchObject({ internet: 1, soloVercel: 0 })
    expect(r.fallas).toEqual({ carga: { total: 2, recuperadas: 1 } })
    expect(tabla([r])).toContain('carga:2(1 solas)')
  })
})
