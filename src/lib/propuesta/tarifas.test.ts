import { describe, expect, it } from 'vitest'
import {
  casillasDeRuta,
  decidirEsquema,
  validarTarifaNueva,
  valorConDescuento,
  versionVigenteEn,
  type TarifaNueva,
  type TarifaVersion,
} from './tarifas'

/**
 * Tarifas fijas por plan y ruta. Los números son la tabla del brief (2026-10-01), que es
 * configuración, no datos de un cliente: Plan 1 = 910.000, Plan 2 = 682.500; rutas
 * completo 100 %, solo_upme 50 %, solo_iva 80 %; Plan 1 + solo_iva no se ofrece.
 */

function version(over: Partial<TarifaVersion> = {}): TarifaVersion {
  return {
    id: 'v1',
    servicio_id: 's1',
    version: 1,
    vigente_desde: '2026-10-01',
    planes: [
      { n: 1, nombre: 'Plan 1', valor: 910000 },
      { n: 2, nombre: 'Plan 2', valor: 682500 },
    ],
    rutas: [
      { valor: 'completo', nombre: 'Completo', pct: 100 },
      { valor: 'solo_upme', nombre: 'Solo UPME', pct: 50 },
      { valor: 'solo_iva', nombre: 'Solo DIAN', pct: 80 },
    ],
    no_ofrece: [{ plan: 1, ruta: 'solo_iva' }],
    cap_descuento_pct: 25,
    creado_por: null,
    created_at: '2026-10-01T12:00:00Z',
    nota: null,
    ...over,
  }
}

describe('casillas plan × ruta', () => {
  it('la tabla del brief sale del valor del plan por el % de la ruta', () => {
    const v = version()
    expect(casillasDeRuta(v, 'completo')[1]).toMatchObject({ ofrece: true, valor: 910000 })
    expect(casillasDeRuta(v, 'completo')[2]).toMatchObject({ ofrece: true, valor: 682500 })
    expect(casillasDeRuta(v, 'solo_upme')[1]).toMatchObject({ ofrece: true, valor: 455000 })
    expect(casillasDeRuta(v, 'solo_upme')[2]).toMatchObject({ ofrece: true, valor: 341250 })
    expect(casillasDeRuta(v, 'solo_iva')[2]).toMatchObject({ ofrece: true, valor: 546000 })
  })

  it('Plan 1 en Solo DIAN no se ofrece, pero su valor teórico existe (la casilla queda abierta)', () => {
    expect(casillasDeRuta(version(), 'solo_iva')[1]).toMatchObject({ ofrece: false, valor: 728000 })
  })

  it('una ruta que la versión no conoce no ofrece nada', () => {
    const c = casillasDeRuta(version(), 'otra')
    expect(c[1]).toMatchObject({ ofrece: false, valor: null })
    expect(c[2]).toMatchObject({ ofrece: false, valor: null })
    expect(casillasDeRuta(version(), null)[2].ofrece).toBe(false)
  })

  it('el piso con el 25 % de descuento en Solo UPME Plan 2 es 255.938', () => {
    expect(valorConDescuento(341250, 25)).toBe(255938)
  })
})

describe('versión vigente y esquema del negocio', () => {
  const v1 = version()
  const v2 = version({ id: 'v2', version: 2, vigente_desde: '2026-11-15', planes: [
    { n: 1, nombre: 'Plan 1', valor: 950000 },
    { n: 2, nombre: 'Plan 2', valor: 700000 },
  ] })

  it('rige la de vigencia más reciente que no sea posterior a la creación', () => {
    expect(versionVigenteEn([v1, v2], '2026-09-30')).toBeNull()
    expect(versionVigenteEn([v1, v2], '2026-10-01')?.id).toBe('v1')
    expect(versionVigenteEn([v1, v2], '2026-11-14')?.id).toBe('v1')
    expect(versionVigenteEn([v1, v2], '2026-11-15')?.id).toBe('v2')
  })

  it('a igual vigencia gana la última versión guardada', () => {
    const v1b = version({ id: 'v1b', version: 3 })
    expect(versionVigenteEn([v1b, v1], '2026-10-05')?.id).toBe('v1b')
  })

  it('un negocio de septiembre sigue con el esquema anterior', () => {
    expect(decidirEsquema({ versiones: [v1], congelada: null, versionesEmitidas: 0, creadoEl: '2026-09-28' }))
      .toEqual({ esquema: 'anterior', motivo: 'creado_antes' })
  })

  it('un negocio creado desde el 1-oct sin propuesta emitida toma la tarifa vigente', () => {
    const e = decidirEsquema({ versiones: [v1], congelada: null, versionesEmitidas: 0, creadoEl: '2026-10-01' })
    expect(e).toMatchObject({ esquema: 'tarifas', congelada: false })
    expect(e.esquema === 'tarifas' && e.version.id).toBe('v1')
  })

  it('una propuesta ya emitida con el esquema anterior NO cambia de esquema sola', () => {
    expect(decidirEsquema({ versiones: [v1], congelada: null, versionesEmitidas: 1, creadoEl: '2026-10-01' }))
      .toEqual({ esquema: 'anterior', motivo: 'emitida_antes' })
  })

  it('la versión congelada manda aunque después se publique otra', () => {
    const e = decidirEsquema({
      versiones: [v1, v2],
      congelada: { version_id: 'v1' },
      versionesEmitidas: 2,
      creadoEl: '2026-11-20',
    })
    expect(e.esquema === 'tarifas' && e.version.id).toBe('v1')
  })

  it('sin tarifas en el servicio, nada cambia', () => {
    expect(decidirEsquema({ versiones: [], congelada: null, versionesEmitidas: 0, creadoEl: '2026-10-01' }))
      .toEqual({ esquema: 'anterior', motivo: 'sin_tarifas' })
  })
})

describe('validar una versión nueva', () => {
  const base: TarifaNueva = {
    planes: [
      { n: 1, nombre: 'Plan 1', valor: 910000 },
      { n: 2, nombre: 'Plan 2', valor: 682500 },
    ],
    rutas: [
      { valor: 'completo', nombre: 'Completo', pct: 100 },
      { valor: 'solo_iva', nombre: 'Solo DIAN', pct: 80 },
    ],
    no_ofrece: [{ plan: 1, ruta: 'solo_iva' }],
    cap_descuento_pct: 25,
    vigente_desde: '2026-10-02',
  }

  it('acepta la tabla y limpia la nota vacía', () => {
    const r = validarTarifaNueva(base, '2026-10-01')
    expect('tarifa' in r && r.tarifa).toMatchObject({ cap_descuento_pct: 25, nota: null })
  })

  it('no deja regir hacia atrás', () => {
    expect(validarTarifaNueva({ ...base, vigente_desde: '2026-09-30' }, '2026-10-01'))
      .toEqual({ error: expect.stringMatching(/anterior a hoy/) })
  })

  it('una ruta sin ningún plan se rechaza', () => {
    const r = validarTarifaNueva({ ...base, no_ofrece: [{ plan: 1, ruta: 'solo_iva' }, { plan: 2, ruta: 'solo_iva' }] }, '2026-10-01')
    expect(r).toEqual({ error: expect.stringMatching(/sin ningún plan/) })
  })

  it('% fuera de rango, plan en cero y cap fuera de rango se rechazan', () => {
    expect('error' in validarTarifaNueva({ ...base, rutas: [{ valor: 'completo', nombre: 'C', pct: 0 }] }, '2026-10-01')).toBe(true)
    expect('error' in validarTarifaNueva({ ...base, planes: [{ n: 1, nombre: 'P', valor: 0 }, base.planes[1]] }, '2026-10-01')).toBe(true)
    expect('error' in validarTarifaNueva({ ...base, cap_descuento_pct: 101 }, '2026-10-01')).toBe(true)
  })

  it('descarta casillas «no se ofrece» de rutas que no existen', () => {
    const r = validarTarifaNueva({ ...base, no_ofrece: [{ plan: 2, ruta: 'fantasma' }] }, '2026-10-01')
    expect('tarifa' in r && r.tarifa.no_ofrece).toEqual([])
  })
})
