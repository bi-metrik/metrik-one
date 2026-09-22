import { describe, expect, it } from 'vitest'

import { costoManualVigente, normalizarCostoManual } from './costo-manual'

describe('el costo escrito a mano, en su moneda', () => {
  it('COP por defecto: los pesos tal cual y nada que anotar', () => {
    expect(normalizarCostoManual({ valor: 850000.4, moneda: null, tasa: null }))
      .toEqual({ ok: true, pesos: 850000, origen: null })
  })

  it('USD con tasa: pesos convertidos y lo escrito anotado', () => {
    expect(normalizarCostoManual({ valor: 1200, moneda: 'usd', tasa: 4150 }))
      .toEqual({ ok: true, pesos: 4980000, origen: { moneda: 'USD', valor: 1200, tasa: 4150 } })
  })

  it('en otra moneda SIN tasa no se guarda: guardarlo en cero regalaría el costo', () => {
    const r = normalizarCostoManual({ valor: 1200, moneda: 'USD', tasa: null })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.motivo).toContain('falta la tasa de cambio')
  })

  it('un código que no es moneda, o un costo negativo, se rechazan', () => {
    expect(normalizarCostoManual({ valor: 1, moneda: 'dólares', tasa: 4000 }).ok).toBe(false)
    expect(normalizarCostoManual({ valor: -1, moneda: 'COP', tasa: null }).ok).toBe(false)
  })

  it('la anotación solo vale mientras explique el costo en pesos', () => {
    const anotado = { moneda: 'USD', valor: 1200, tasa: 4150, por: null, porId: null, en: '2026-09-22T10:00:00Z' }
    expect(costoManualVigente(anotado, 4980000)).toBe(true)
    // Alguien cambió el costo por otro camino, o la línea pasó a rubros (subtotal 0).
    expect(costoManualVigente(anotado, 5000000)).toBe(false)
    expect(costoManualVigente(anotado, 0)).toBe(false)
    expect(costoManualVigente(null, 4980000)).toBe(false)
  })
})
