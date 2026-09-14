import { describe, it, expect } from 'vitest'

import {
  cotizacionesBajoPiso,
  cotizacionesQueFijanElPrecio,
  mensajeGateMargen,
  type CotizacionMedida,
} from './gate-margen'

/**
 * Regla 3 de la reunión del 2026-09-14: **bajo el piso NO se avanza de etapa.**
 *
 * El aviso (ámbar) sigue dejando pasar. Es la diferencia que el equipo tiene que poder
 * ver en pantalla, y aquí se fija en el criterio que decide.
 */

const UMBRALES = { pisoPct: 5, avisoPct: 10 }

function cot(id: string, estado: string, margenRealPct: number | null, pisoPct = 5): CotizacionMedida {
  return { id, codigo: `COT-${id}`, estado, margenRealPct, umbrales: { ...UMBRALES, pisoPct } }
}

describe('cuál cotización fija el precio', () => {
  it('con una aceptada, manda la aceptada y nada más', () => {
    const cots = [cot('a', 'borrador', 2), cot('b', 'enviada', 3), cot('c', 'aceptada', 18)]
    expect(cotizacionesQueFijanElPrecio(cots).map(c => c.id)).toEqual(['c'])
  })

  it('sin aceptada, mandan las enviadas', () => {
    const cots = [cot('a', 'borrador', 2), cot('b', 'enviada', 12)]
    expect(cotizacionesQueFijanElPrecio(cots).map(c => c.id)).toEqual(['b'])
  })

  it('sin aceptada ni enviada, manda el borrador', () => {
    expect(cotizacionesQueFijanElPrecio([cot('a', 'borrador', 2)]).map(c => c.id)).toEqual(['a'])
  })

  it('las rechazadas y las vencidas no se miran NUNCA', () => {
    // Bloquear por una cotización que el cliente ya rechazó es un bloqueo que no se
    // puede levantar sin borrar historia.
    const cots = [cot('r', 'rechazada', -10), cot('v', 'vencida', -20), cot('b', 'enviada', 15)]
    expect(cotizacionesQueFijanElPrecio(cots).map(c => c.id)).toEqual(['b'])
    expect(cotizacionesQueFijanElPrecio([cot('r', 'rechazada', -10)])).toEqual([])
  })

  it('un negocio sin cotizaciones no tiene nada que juzgar', () => {
    expect(cotizacionesQueFijanElPrecio([])).toEqual([])
  })
})

describe('qué frena el avance', () => {
  it('bajo el piso FRENA', () => {
    expect(cotizacionesBajoPiso([cot('a', 'enviada', 3.1)])).toEqual([
      { codigo: 'COT-a', margenRealPct: 3.1, pisoPct: 5 },
    ])
  })

  it('entre el piso y el aviso DEJA PASAR: el ámbar avisa, no bloquea', () => {
    expect(cotizacionesBajoPiso([cot('a', 'enviada', 7)])).toEqual([])
  })

  it('justo EN el piso pasa: el piso es un mínimo, no un umbral excluyente', () => {
    expect(cotizacionesBajoPiso([cot('a', 'enviada', 5)])).toEqual([])
  })

  it('un margen negativo frena: vender por debajo del costo es el caso que más importa', () => {
    expect(cotizacionesBajoPiso([cot('a', 'aceptada', -6.5)])).toHaveLength(1)
  })

  it('un margen que NO se puede medir NO frena', () => {
    // Al revés que `motivoDeRechazo`, y a propósito: allá el objeto es un documento
    // que va al cliente; aquí, un caso que todavía no se ha costeado y que va justo a
    // la etapa donde se costea.
    expect(cotizacionesBajoPiso([cot('a', 'borrador', null)])).toEqual([])
  })

  it('cada cotización se juzga contra SU piso congelado, no contra uno común', () => {
    const cots = [cot('vieja', 'enviada', 8, 12), cot('nueva', 'enviada', 8, 5)]
    // Las dos al 8%: la que congeló piso 12 frena, la que congeló 5 no.
    // Solo la del escalón más alto entra, y aquí las dos son `enviada`.
    expect(cotizacionesBajoPiso(cots).map(c => c.codigo)).toEqual(['COT-vieja'])
  })

  it('un borrador malo NO frena si hay una aceptada sana', () => {
    const cots = [cot('borrador', 'borrador', 1), cot('ok', 'aceptada', 18)]
    expect(cotizacionesBajoPiso(cots)).toEqual([])
  })
})

describe('el mensaje nombra la cotización, su margen y su piso', () => {
  it('con una, dice las tres cifras', () => {
    const texto = mensajeGateMargen(cotizacionesBajoPiso([cot('a', 'enviada', 3.1)]))
    expect(texto).toContain('COT-a')
    expect(texto).toContain('3,1%')
    expect(texto).toContain('5,0%')
    expect(texto).toContain('antes de avanzar')
  })

  it('con dos, las cuenta y las nombra a las dos', () => {
    const texto = mensajeGateMargen(
      cotizacionesBajoPiso([cot('a', 'enviada', 3.1), cot('b', 'enviada', 1)]),
    )
    expect(texto).toContain('2 cotizaciones')
    expect(texto).toContain('COT-a')
    expect(texto).toContain('COT-b')
  })

  it('sin bloqueadas no hay mensaje', () => {
    expect(mensajeGateMargen([])).toBe('')
  })
})
