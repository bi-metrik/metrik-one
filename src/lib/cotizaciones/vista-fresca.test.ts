import { describe, expect, it } from 'vitest'

import {
  interpretarVistaFresca,
  laMasNueva,
  lineasParaPintar,
  rutaVistaFresca,
  traerVistaFresca,
  vistaFrescaVigente,
} from './vista-fresca'

const T0 = '2026-10-01T09:45:10.000Z'
const T1 = '2026-10-01T09:45:12.000Z'

describe('cuál lectura gana (criterios 5 a 7: la pantalla queda al día sin recargar)', () => {
  it('la lectura propia más nueva que la página gana', () => {
    expect(vistaFrescaVigente({ leidaEn: T1 }, T0)).toBe(true)
  })

  it('cuando el refresco trae una página más nueva, gana la página', () => {
    expect(vistaFrescaVigente({ leidaEn: T0 }, T1)).toBe(false)
  })

  it('a la misma hora gana la página (no hay razón para preferir la propia)', () => {
    expect(vistaFrescaVigente({ leidaEn: T0 }, T0)).toBe(false)
  })

  it('sin lectura propia, la página', () => {
    expect(vistaFrescaVigente(null, T0)).toBe(false)
  })

  it('una página sin marca no le gana a una lectura que sí la tiene', () => {
    expect(vistaFrescaVigente({ leidaEn: T0 }, null)).toBe(true)
  })

  it('dos lecturas propias que llegan en desorden: se queda la más nueva', () => {
    const vieja = { leidaEn: T0, n: 1 }
    const nueva = { leidaEn: T1, n: 2 }
    expect(laMasNueva(null, vieja)).toBe(vieja)
    expect(laMasNueva(vieja, nueva)).toBe(nueva)
    expect(laMasNueva(nueva, vieja)).toBe(nueva)
  })
})

describe('la respuesta de la ruta', () => {
  it('se interpreta con su forma', () => {
    const v = interpretarVistaFresca({
      ok: true, leidaEn: T1, items: [{ id: 'i1' }], adicionalesPorItem: { i1: [{ id: 'a1' }], malo: 'x' }, valorTotal: '941176',
    })
    expect(v).toEqual({ leidaEn: T1, items: [{ id: 'i1' }], adicionalesPorItem: { i1: [{ id: 'a1' }] }, valorTotal: 941_176 })
  })

  it('lo que no tiene la forma se descarta', () => {
    expect(interpretarVistaFresca(null)).toBeNull()
    expect(interpretarVistaFresca({ ok: false })).toBeNull()
    expect(interpretarVistaFresca({ ok: true, leidaEn: '', items: [] })).toBeNull()
    expect(interpretarVistaFresca({ ok: true, leidaEn: T1, items: 'x' })).toBeNull()
  })

  it('sin total, null (la columna se queda con el de la página)', () => {
    expect(interpretarVistaFresca({ ok: true, leidaEn: T1, items: [] })?.valorTotal).toBeNull()
  })
})

describe('traerVistaFresca', () => {
  it('pide la ruta de la cotización por GET y sin caché', async () => {
    const llamadas: [string, RequestInit | undefined][] = []
    const f = (async (url: string, init?: RequestInit) => {
      llamadas.push([url, init])
      return { ok: true, json: async () => ({ ok: true, leidaEn: T1, items: [], adicionalesPorItem: {}, valorTotal: 800_000 }) }
    }) as unknown as typeof fetch
    const v = await traerVistaFresca('cot-1', f)
    expect(v?.valorTotal).toBe(800_000)
    expect(llamadas).toHaveLength(1)
    expect(llamadas[0][0]).toBe(rutaVistaFresca('cot-1'))
    expect(llamadas[0][0]).toBe('/api/cotizaciones/cot-1/vista')
    expect(llamadas[0][1]?.method).toBe('GET')
    expect(llamadas[0][1]?.cache).toBe('no-store')
  })

  it('sin sesión, red caída o respuesta rara: null, nunca una excepción', async () => {
    const sinSesion = (async () => ({ ok: false, json: async () => ({ ok: false }) })) as unknown as typeof fetch
    const caida = (async () => { throw new Error('red') }) as unknown as typeof fetch
    const html = (async () => ({ ok: true, json: async () => { throw new SyntaxError('<html>') } })) as unknown as typeof fetch
    expect(await traerVistaFresca('cot-1', sinSesion)).toBeNull()
    expect(await traerVistaFresca('cot-1', caida)).toBeNull()
    expect(await traerVistaFresca('cot-1', html)).toBeNull()
  })
})

describe('lineasParaPintar (lo que usa el editor)', () => {
  const pagina = { items: [{ id: 'vieja' }], adicionalesPorItem: { i: [1] }, leidaEn: T0 }
  const fresca = { leidaEn: T1, items: [{ id: 'nueva' }], adicionalesPorItem: { i: [2] }, valorTotal: 1 }

  it('en el viaje, con lectura propia más nueva: la propia', () => {
    const r = lineasParaPintar(pagina, fresca, true)
    expect(r).toEqual({ items: [{ id: 'nueva' }], adicionalesPorItem: { i: [2] }, deLaLecturaPropia: true })
  })

  it('en el viaje, con la página más nueva: la página, y el MISMO objeto', () => {
    const r = lineasParaPintar({ ...pagina, leidaEn: '2026-10-01T10:00:00.000Z' }, fresca, true)
    expect(r.deLaLecturaPropia).toBe(false)
    expect(r.items).toBe(pagina.items)
  })

  it('fuera del viaje (genérica, Termotech): siempre la página, aunque haya lectura propia', () => {
    const r = lineasParaPintar(pagina, fresca, false)
    expect(r.deLaLecturaPropia).toBe(false)
    expect(r.items).toBe(pagina.items)
    expect(r.adicionalesPorItem).toBe(pagina.adicionalesPorItem)
  })
})
