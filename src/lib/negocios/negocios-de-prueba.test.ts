import { describe, expect, it, vi } from 'vitest'
import { esNegocioDePrueba, filtrarNegociosDePrueba, sinNegociosDePruebaAjenos } from './negocios-de-prueba'

/**
 * Vera F8-1: el negocio del viaje de prueba no aparece en las listas del equipo real.
 *
 * VISTO FALLAR (2026-10-12), una mutación a la vez:
 *   · devolver `true` para todo negocio de prueba → cae «el equipo real no lo ve»;
 *   · no mirar los responsables → cae «sus responsables sí lo ven»;
 *   · no mirar los aprobadores de la línea → cae «el aprobador de SU línea lo ve».
 * (Quitar el atajo «sin negocios de prueba, devuelve igual» no cae: sin ellos tampoco hay líneas que
 * leer, así que el resultado es el mismo. El atajo es solo para no recorrer dos veces.)
 */

const LINEA_CLON = 'linea-clon'
const LINEA_REAL = 'linea-real'
const CP = 'staff-cp'
const DP = 'staff-dp'
const EDGAR = 'staff-edgar'
const ALEJANDRA = 'staff-alejandra'

const real = { id: 'n-real', metadata: {}, linea_id: LINEA_REAL, negocio_responsables: [{ staff: { id: ALEJANDRA } }] }
const prueba = { id: 'n-prueba', metadata: { es_prueba: true }, linea_id: LINEA_CLON, negocio_responsables: [{ staff: { id: CP } }] }
const aprobadoresPorLinea = new Map([[LINEA_CLON, [DP]], [LINEA_REAL, [EDGAR]]])

describe('esNegocioDePrueba', () => {
  it('solo con es_prueba === true', () => {
    expect(esNegocioDePrueba({ es_prueba: true })).toBe(true)
    expect(esNegocioDePrueba({ es_prueba: 'true' })).toBe(false)
    expect(esNegocioDePrueba(null)).toBe(false)
  })
})

describe('filtrarNegociosDePrueba', () => {
  it('el equipo real no lo ve (ni el aprobador de OTRA línea)', () => {
    expect(filtrarNegociosDePrueba([real, prueba], { staffId: ALEJANDRA, aprobadoresPorLinea }).map((n) => n.id)).toEqual(['n-real'])
    expect(filtrarNegociosDePrueba([real, prueba], { staffId: EDGAR, aprobadoresPorLinea }).map((n) => n.id)).toEqual(['n-real'])
  })
  it('sus responsables sí lo ven', () => {
    expect(filtrarNegociosDePrueba([real, prueba], { staffId: CP, aprobadoresPorLinea }).map((n) => n.id)).toEqual(['n-real', 'n-prueba'])
  })
  it('el aprobador de SU línea lo ve', () => {
    expect(filtrarNegociosDePrueba([real, prueba], { staffId: DP, aprobadoresPorLinea }).map((n) => n.id)).toEqual(['n-real', 'n-prueba'])
  })
  it('sin ficha de staff no ve ninguno de prueba', () => {
    expect(filtrarNegociosDePrueba([real, prueba], { staffId: null, aprobadoresPorLinea }).map((n) => n.id)).toEqual(['n-real'])
  })
})

describe('sinNegociosDePruebaAjenos', () => {
  const doble = (lineas: Array<{ id: string; config_extra: unknown }>) => {
    const from = vi.fn(() => {
      const chain: Record<string, unknown> = {}
      for (const m of ['select', 'eq', 'in']) chain[m] = () => chain
      chain.then = (res: (v: unknown) => unknown) => res({ data: lineas, error: null })
      return chain
    })
    return { from }
  }

  it('sin negocios de prueba no lee nada', async () => {
    const db = doble([])
    expect(await sinNegociosDePruebaAjenos(db, 'ws', ALEJANDRA, [real])).toEqual([real])
    expect(db.from).not.toHaveBeenCalled()
  })

  it('lee los aprobadores de la línea y filtra', async () => {
    const db = doble([{ id: LINEA_CLON, config_extra: { aprobaciones: { staff_ids: [DP] } } }])
    expect((await sinNegociosDePruebaAjenos(db, 'ws', DP, [real, prueba])).map((n) => n.id)).toEqual(['n-real', 'n-prueba'])
    expect((await sinNegociosDePruebaAjenos(db, 'ws', EDGAR, [real, prueba])).map((n) => n.id)).toEqual(['n-real'])
  })
})
