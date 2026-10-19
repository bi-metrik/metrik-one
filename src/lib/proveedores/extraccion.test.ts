import { describe, expect, it } from 'vitest'

import { resumenExtraccion, revisarExtraccion, sugerenciasParaFicha } from './extraccion'

/** Una extracción inventada con la forma del esquema 0.2 (proveedor ficticio). */
const EXTRACCION_FICTICIA = {
  esquema_version: '0.2',
  expediente: {
    archivos: [
      { archivo: 'tar0_TARIFAS 2027.pdf', clase: 'tarifario', decision: 'usar' },
      { archivo: 'tar1_TARIFAS 2025.pdf', clase: 'tarifario', decision: 'vencido_sin_reemplazo' },
      { archivo: 'tar2_CERTIFICACION BANCARIA.pdf', clase: 'bancario', decision: 'excluir_bancario' },
    ],
    pedir_actualizacion: ['Tarifa de temporada media 2027: no trae fechas.'],
  },
  documento: { archivo: 'tar0_TARIFAS 2027.pdf' },
  tarifario: {
    proveedor: { nombre: 'Hotel Ficticio del Mar', tipo: 'hotel', ciudad: 'Cartagena' },
    moneda: 'COP',
    vigencia: { desde: '2027-01-01', hasta: '2027-12-31' },
    canal: 'neta_mayorista',
    impuestos: { iva_declarado: true, iva_incluido: false, iva_pct: 19 },
    temporadas: [{ id: 'T1' }, { id: 'T2' }],
    tarifas: [{ precio: 100000 }, { precio: 120000 }, { precio: 90000 }],
    advertencias: ['Semana Santa calculada'],
  },
  datos_ficha: { direccion: 'Calle Falsa 123', ciudad: 'Cartagena' },
}

describe('extracción del motor', () => {
  it('revisa la forma y saca los archivos', () => {
    const r = revisarExtraccion(JSON.stringify(EXTRACCION_FICTICIA))
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.extraccion.esquemaVersion).toBe('0.2')
    expect(r.extraccion.archivos).toEqual(['tar0_TARIFAS 2027.pdf', 'tar1_TARIFAS 2025.pdf', 'tar2_CERTIFICACION BANCARIA.pdf'])
    expect(r.extraccion.datosFicha).toMatchObject({ ciudad: 'Cartagena' })
  })

  it('rechaza lo que no es una extracción', () => {
    expect(revisarExtraccion('{no es json')).toMatchObject({ ok: false, error: expect.stringMatching(/JSON/) })
    expect(revisarExtraccion({ expediente: {} })).toMatchObject({ ok: false, error: expect.stringMatching(/esquema_version/) })
    expect(revisarExtraccion({ esquema_version: '0.9', expediente: {} })).toMatchObject({ ok: false, error: expect.stringMatching(/0\.9/) })
    expect(revisarExtraccion({ esquema_version: '0.2' })).toMatchObject({ ok: false, error: expect.stringMatching(/expediente/) })
    expect(revisarExtraccion({ esquema_version: '0.2', expediente: {}, tarifario: [] })).toMatchObject({ ok: false })
  })

  it('resume y propone a la ficha solo lo que el documento sí dice', () => {
    const r = revisarExtraccion(EXTRACCION_FICTICIA)
    if (!r.ok) throw new Error(r.error)
    const res = resumenExtraccion(r.extraccion)
    expect(res).toMatchObject({ tarifas: 3, temporadas: 2, moneda: 'COP', canal: 'neta_mayorista', ivaDeclarado: true, ivaIncluido: false, advertencias: 1 })
    expect(res.decisiones).toEqual({ usar: 1, vencido_sin_reemplazo: 1, excluir_bancario: 1 })
    expect(res.pedir).toEqual(['Tarifa de temporada media 2027: no trae fechas.'])
    expect(sugerenciasParaFicha(res)).toEqual({ tarifaCanal: 'neta', ivaDeclarado: true, ivaIncluido: false })
    // «iva_declarado: false» del motor = el documento no lo dice: no se propone «no cobra».
    expect(sugerenciasParaFicha({ canal: 'publica', ivaDeclarado: false, ivaIncluido: false })).toEqual({ tarifaCanal: null, ivaDeclarado: null, ivaIncluido: null })
  })
})
