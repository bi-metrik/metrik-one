import { describe, expect, it } from 'vitest'

import { notasDeTasaDeCambio, terminosConTasaDeCambio } from './nota-tasa-pdf'

const COMP = { adultos: 2, ninos: 0, infantes: 0 }
const conf = (moneda: string, tasa: number | null) => ({
  confirmada: { composicion: COMP, costos: [], costoTotalCOP: 1, moneda, tasa, confirmadaEn: '2026-10-29T10:00:00Z' },
})

describe('nota de la tasa de cambio en el PDF (H8 · QA Trappvel 2026-10-29)', () => {
  it('viaje 06: hoteles y traslado en USD a 4.150', () => {
    const notas = notasDeTasaDeCambio([
      { grupo: 'vuelo', tarifa_pax: conf('COP', null) },
      { grupo: 'hotel', tarifa_pax: conf('USD', 4150) },
      { grupo: 'hotel', tarifa_pax: conf('USD', 4150) },
      { grupo: 'traslado', tarifa_pax: conf('USD', 4150) },
    ])
    expect(notas).toEqual([
      'Los hoteles y el traslado tienen tarifa en dólares (USD). Sus valores en pesos en esta cotización se calcularon con una tasa de $4.150 por dólar.',
    ])
  })

  it('una sola línea en EUR, en singular; dos tasas distintas se dicen las dos', () => {
    expect(notasDeTasaDeCambio([{ grupo: 'actividad', tarifa_pax: conf('EUR', 4500) }])).toEqual([
      'La actividad tiene tarifa en euros (EUR). Su valor en pesos en esta cotización se calculó con una tasa de $4.500 por euro.',
    ])
    expect(notasDeTasaDeCambio([
      { grupo: 'hotel', tarifa_pax: conf('USD', 4200) },
      { grupo: 'traslado', tarifa_pax: conf('USD', 4150) },
    ])[0]).toContain('con tasas de $4.150 y $4.200 por dólar')
  })

  it('todo en pesos: los términos no cambian', () => {
    expect(terminosConTasaDeCambio('- Las tarifas están sujetas a cambios.', [{ grupo: 'hotel', tarifa_pax: conf('COP', null) }]))
      .toBe('- Las tarifas están sujetas a cambios.')
    expect(terminosConTasaDeCambio(null, [])).toBeNull()
  })

  it('con otra moneda, la tarjeta va al final de los términos', () => {
    const t = terminosConTasaDeCambio('- Las tarifas están sujetas a cambios.', [{ grupo: 'hotel', tarifa_pax: conf('USD', 4150) }])
    expect(t).toBe('- Las tarifas están sujetas a cambios.\n\nTasa de cambio\n- El hotel tiene tarifa en dólares (USD). Su valor en pesos en esta cotización se calculó con una tasa de $4.150 por dólar.')
  })
})
