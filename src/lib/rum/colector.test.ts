import { describe, expect, it } from 'vitest'
import { crearColector, MAX_DURACION_NAV_MS, MAX_NAVS } from './colector'

const nuevo = () => crearColector({ carga: 'c-1', entrada: '/negocios', version: 'dpl_x' })

describe('colector de RUM', () => {
  it('sin nada juntado no hay beacon (no se gasta un viaje)', () => {
    expect(nuevo().tomarBeacon('/negocios', {})).toBeNull()
  })

  it('junta vitales y navegaciones en UN beacon y vacia lo juntado', () => {
    const c = nuevo()
    c.anotarVital({ name: 'LCP', value: 2512.7, rating: 'needs-improvement' }, '/negocios/[id]')
    c.anotarVital({ name: 'CLS', value: 0.123456 }, '/negocios/[id]')
    c.iniciarNavegacion('tarjeta', '/negocios', 1000)
    c.terminarNavegacion('/negocios/[id]', 2350.4)
    const b = c.tomarBeacon('/negocios/[id]', { enLinea: true, red: { tipo: '4g', rtt: 150 }, segDesdeCarga: 12.3 })
    expect(b).toMatchObject({
      v: 1,
      carga: 'c-1',
      ciclo: 1,
      entrada: '/negocios',
      ruta: '/negocios/[id]',
      version: 'dpl_x',
      enLinea: true,
      red: { tipo: '4g', rtt: 150 },
      navs: [{ de: '/negocios', a: '/negocios/[id]', ms: 1350, tipo: 'tarjeta' }],
    })
    // LCP es de la carga: su ruta es la de entrada, no la de cuando se reporto.
    expect(b?.vitales).toEqual([
      { n: 'LCP', v: 2513, r: 'needs-improvement', ruta: '/negocios' },
      { n: 'CLS', v: 0.1235, ruta: '/negocios/[id]' },
    ])
    expect(c.tomarBeacon('/negocios/[id]', {})).toBeNull()
  })

  it('una metrica repetida guarda el ultimo valor; el ciclo sube por beacon', () => {
    const c = nuevo()
    c.anotarVital({ name: 'INP', value: 100 }, '/a')
    c.anotarVital({ name: 'INP', value: 380 }, '/b')
    expect(c.tomarBeacon('/b', {})?.vitales).toEqual([{ n: 'INP', v: 380, ruta: '/b' }])
    c.anotarVital({ name: 'INP', value: 500 }, '/b')
    expect(c.tomarBeacon('/b', {})?.ciclo).toBe(2)
  })

  it('ignora FID, nombres raros y valores no finitos', () => {
    const c = nuevo()
    c.anotarVital({ name: 'FID', value: 10 }, '/a')
    c.anotarVital({ name: 'LCP', value: Number.NaN }, '/a')
    expect(c.tomarBeacon('/a', {})).toBeNull()
  })

  it('terminar sin inicio no anota; una navegacion nueva reemplaza a la que no termino', () => {
    const c = nuevo()
    c.terminarNavegacion('/x', 10)
    c.iniciarNavegacion('enlace', '/a', 0)
    c.iniciarNavegacion('historial', '/a', 500)
    c.terminarNavegacion('/b', 900)
    c.terminarNavegacion('/c', 1200)
    expect(c.tomarBeacon('/c', {})?.navs).toEqual([{ de: '/a', a: '/b', ms: 400, tipo: 'historial' }])
  })

  it('una navegacion de mas de 2 minutos se da por abandonada', () => {
    const c = nuevo()
    c.iniciarNavegacion('enlace', '/a', 0)
    c.terminarNavegacion('/b', MAX_DURACION_NAV_MS + 1)
    expect(c.tomarBeacon('/b', {})).toBeNull()
  })

  it('tope de navegaciones por beacon: las de mas se cuentan, no viajan', () => {
    const c = nuevo()
    for (let i = 0; i < MAX_NAVS + 3; i++) {
      c.iniciarNavegacion('enlace', '/a', i * 10)
      c.terminarNavegacion('/b', i * 10 + 5)
    }
    const b = c.tomarBeacon('/b', {})
    expect(b?.navs).toHaveLength(MAX_NAVS)
    expect(b?.navsDescartadas).toBe(3)
  })
})
