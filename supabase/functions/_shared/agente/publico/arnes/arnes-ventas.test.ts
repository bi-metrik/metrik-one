import { describe, expect, it } from 'vitest'
import { CASOS_VENTAS } from './conjuntos-ventas'
import { correrCaso } from './correr-caso'

/**
 * El conjunto de VENTAS del asistente público (Dimpro, ensayo del 29-oct) en `--seco`: el guion hace de modelo y se prueba
 * el código (catálogo, total, link de Bold, verificación del pago, pasos a persona). Catálogo y datos inventados.
 */
describe('arnés del asistente de ventas (seco)', () => {
  for (const caso of CASOS_VENTAS) {
    it(`${caso.id}: ${caso.titulo}`, async () => {
      const r = await correrCaso(caso, { modelo: null, k: 1 })
      const c = r.corridas[0]
      if (!c.exito.ok || c.daninas.length) console.log(c.transcripcion.join('\n'))
      expect({ exito: c.exito, daninas: c.daninas }).toEqual({ exito: { ok: true, motivo: c.exito.motivo }, daninas: [] })
    }, 15_000)
  }
})
