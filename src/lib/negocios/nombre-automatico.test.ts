import { describe, expect, it } from 'vitest'
import { camposCambiados, renombrarNegocioSiAplica } from './nombre-automatico'

describe('lo que cambia en un guardado de la ficha', () => {
  it('solo los campos cuyo valor cambió (también los que se vacían)', () => {
    expect(camposCambiados({ destino: 'Miami', adultos: 2 }, { destino: 'Miami', adultos: 3, fecha_salida: '2026-11-19' }).sort()).toEqual(['adultos', 'fecha_salida'])
    expect(camposCambiados({ fecha_regreso: '2026-11-25' }, {})).toEqual(['fecha_regreso'])
    expect(camposCambiados(null, null)).toEqual([])
  })
  it('sin cambios no consulta la base', async () => {
    const db = { from: () => { throw new Error('no debía consultar') } }
    expect(await renombrarNegocioSiAplica(db, 'n-1', [])).toBeNull()
  })
})
