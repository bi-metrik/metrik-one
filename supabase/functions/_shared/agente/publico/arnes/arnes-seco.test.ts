import { describe, expect, it } from 'vitest'
import { TODOS_LOS_CASOS } from './conjuntos'
import { correrCaso, reporte } from './correr-caso'

/**
 * El arnés del asistente público en `--seco` (el guion de cada caso hace de modelo): prueba que el CÓDIGO hace lo que
 * dice el diseño en cada conjunto de §10.1 (escenarios, adversario, lenguaje, operación). No mide al modelo: eso es la
 * corrida real con la llave de pruebas (`correr.ts`). Datos inventados.
 */
describe('arnés del asistente público (seco)', () => {
  for (const caso of TODOS_LOS_CASOS) {
    it(`${caso.conjunto} · ${caso.id}: ${caso.titulo}`, async () => {
      const r = await correrCaso(caso, { modelo: null, k: 1 })
      const c = r.corridas[0]
      expect({ exito: c.exito, daninas: c.daninas }).toEqual({ exito: { ok: true, motivo: c.exito.motivo }, daninas: [] })
    }, 15_000)
  }

  it('el reporte cuenta pass^k, dañinas y propone corte_1 con piso de 5 s', async () => {
    const rs = await Promise.all(TODOS_LOS_CASOS.slice(0, 3).map((c) => correrCaso(c, { modelo: null, k: 2 })))
    const rep = reporte(rs, 2)
    expect(rep.casos).toBe(3)
    expect(rep.passK).toBe(3)
    expect(rep.daninas).toBe(0)
    expect(rep.corte1.corte1Ms).toBeGreaterThanOrEqual(5000)
    expect(rep.corte1.corte1Ms).toBeLessThanOrEqual(8000)
  }, 30_000)
})
