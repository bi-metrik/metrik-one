// Pruebas del resumen de `[rum]` (`rum-p75.mjs`): deduplicar filas, quedarse con la ultima
// vital por carga y sacar percentiles por ruta.
import { describe, expect, it } from 'vitest'
import { beaconsDeLogs, percentil, resumir, valoresPorRuta } from './rum-p75.mjs'

const fila = (id, beacon) => JSON.stringify({ id, message: `[rum] ${JSON.stringify(beacon)}` })

describe('rum-p75', () => {
  it('percentil por rango mas cercano', () => {
    expect(percentil([1, 2, 3, 4], 75)).toBe(3)
    expect(percentil([10], 75)).toBe(10)
    expect(percentil([], 75)).toBeNull()
  })

  it('deduplica filas repetidas del log, ignora otras lineas y filtra por workspace', () => {
    const b = { carga: 'c1', ciclo: 1, ws: 'soena', vitales: [], navs: [{ a: '/negocios', ms: 100 }] }
    const lineas = [
      fila('l1', b),
      fila('l1', b),
      JSON.stringify({ id: 'l2', message: '[error-cliente] {"message":"x"}' }),
      'basura',
      fila('l3', { ...b, carga: 'c2', ws: 'otro' }),
    ]
    expect(beaconsDeLogs(lineas)).toHaveLength(2)
    expect(beaconsDeLogs(lineas, 'soena')).toHaveLength(1)
  })

  it('vitales: la ultima por carga + metrica; el mismo ciclo en dos filas cuenta una vez', () => {
    const porRuta = valoresPorRuta([
      { carga: 'c1', ciclo: 1, vitales: [{ n: 'INP', v: 100, ruta: '/a' }], navs: [{ a: '/b', ms: 50 }] },
      { carga: 'c1', ciclo: 1, vitales: [{ n: 'INP', v: 100, ruta: '/a' }], navs: [{ a: '/b', ms: 50 }] },
      { carga: 'c1', ciclo: 2, vitales: [{ n: 'INP', v: 300, ruta: '/b' }], navs: [] },
      { carga: 'c2', ciclo: 1, vitales: [{ n: 'INP', v: 200, ruta: '/b' }], navs: [] },
    ])
    expect(porRuta.INP).toEqual({ '/b': [300, 200] })
    expect(porRuta.NAV).toEqual({ '/b': [50] })
  })

  it('resumen con minimo de datos por ruta', () => {
    const filas = resumir({ NAV: { '/a': [100, 200, 300, 400], '/poca': [1] } }, 2)
    expect(filas).toEqual([{ metrica: 'NAV', ruta: '/a', n: 4, p50: 200, p75: 300, p95: 400 }])
  })
})
