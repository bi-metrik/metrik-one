import { describe, expect, it } from 'vitest'
import { leerRed } from './contexto-red'

describe('leerRed', () => {
  it('lee navigator.connection y redondea', () => {
    expect(leerRed({ connection: { effectiveType: '3g', rtt: 312.4, downlink: 1.4567, saveData: false } })).toEqual({
      tipo: '3g',
      rtt: 312,
      bajadaMbps: 1.46,
      ahorroDatos: false,
    })
  })

  it('sin connection (Safari, iPhone) no hay red', () => {
    expect(leerRed({})).toBeUndefined()
    expect(leerRed(undefined)).toBeUndefined()
  })

  it('solo lo que existe; valores raros se omiten', () => {
    expect(leerRed({ connection: { effectiveType: '4g', rtt: -1, downlink: 'x' } })).toEqual({ tipo: '4g' })
    expect(leerRed({ connection: { rtt: Number.NaN } })).toBeUndefined()
  })

  it('un getter que lanza no rompe', () => {
    const nav = {}
    Object.defineProperty(nav, 'connection', {
      get() {
        throw new Error('bloqueado')
      },
    })
    expect(leerRed(nav)).toBeUndefined()
  })
})
