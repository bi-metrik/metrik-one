import { describe, expect, it, vi } from 'vitest'
import { avisoSoloAQuienLleva, esNegocioDePrueba, filtrarNegociosDePrueba, negociosDePruebaOcultos, sinNegociosDePruebaAjenos, sinOcultos } from './negocios-de-prueba'
import { dobleFiltrante, type Fila } from '../../../test/doble-filtrante'

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

describe('negociosDePruebaOcultos (agregados y colas)', () => {
  const tablas: Record<string, Fila[]> = {
    negocios: [
      { id: 'n-real', workspace_id: 'ws', metadata: {}, linea_id: LINEA_REAL },
      { id: 'n-prueba', workspace_id: 'ws', metadata: { es_prueba: true }, linea_id: LINEA_CLON, negocio_responsables: [{ staff_id: CP }] },
      // Otro workspace: nunca entra.
      { id: 'n-otro', workspace_id: 'ws-2', metadata: { es_prueba: true }, linea_id: LINEA_CLON },
    ],
    lineas_negocio: [{ id: LINEA_CLON, workspace_id: 'ws', config_extra: { aprobaciones: { staff_ids: [DP] } } }],
  }
  const db = dobleFiltrante(() => tablas)

  it('para el staff real, el de prueba queda oculto; para su responsable y su aprobadora, no', async () => {
    expect([...(await negociosDePruebaOcultos(db, 'ws', EDGAR))]).toEqual(['n-prueba'])
    expect([...(await negociosDePruebaOcultos(db, 'ws', null))]).toEqual(['n-prueba'])
    expect([...(await negociosDePruebaOcultos(db, 'ws', CP))]).toEqual([])
    expect([...(await negociosDePruebaOcultos(db, 'ws', DP))]).toEqual([])
  })

  it('si la lectura falla, lanza (un agregado no puede parecer entero)', async () => {
    const roto = { from: () => ({ select: () => ({ eq: () => ({ eq: async () => ({ data: null, error: { message: 'caída' } }) }) }) }) }
    await expect(negociosDePruebaOcultos(roto, 'ws', EDGAR)).rejects.toThrow('caída')
  })

  it('sinOcultos quita las filas de esos negocios y deja las que no cuelgan de uno', () => {
    const filas = [{ negocio_id: 'n-real' }, { negocio_id: 'n-prueba' }, { negocio_id: null }]
    expect(sinOcultos(filas, new Set(['n-prueba']), (f) => f.negocio_id)).toEqual([{ negocio_id: 'n-real' }, { negocio_id: null }])
  })
})

describe('avisoSoloAQuienLleva (crons de avisos a staff)', () => {
  const tablas: Record<string, Fila[]> = {
    negocio_responsables: [{ negocio_id: 'n-prueba', staff_id: CP }],
    lineas_negocio: [{ id: LINEA_CLON, config_extra: { aprobaciones: { staff_ids: [DP] } } }],
    staff: [
      { id: CP, profile_id: 'p-cp', workspace_id: 'ws' },
      { id: DP, profile_id: 'p-dp', workspace_id: 'ws' },
      { id: EDGAR, profile_id: 'p-edgar', workspace_id: 'ws' },
    ],
  }
  const db = dobleFiltrante(() => tablas)
  const prueba = { id: 'n-prueba', workspace_id: 'ws', linea_id: LINEA_CLON, metadata: { es_prueba: true } }

  it('del negocio de prueba solo se enteran su responsable y la aprobadora de su línea', async () => {
    expect(await avisoSoloAQuienLleva(db, prueba, ['p-cp', 'p-edgar', 'p-supervisor', 'p-dp'])).toEqual(['p-cp', 'p-dp'])
  })

  it('un negocio real pasa igual, sin leer nada', async () => {
    const from = vi.fn()
    expect(await avisoSoloAQuienLleva({ from }, { id: 'n-real', workspace_id: 'ws', metadata: {} }, ['p-edgar'])).toEqual(['p-edgar'])
    expect(from).not.toHaveBeenCalled()
  })
})
