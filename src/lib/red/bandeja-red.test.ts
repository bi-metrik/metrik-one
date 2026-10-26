import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CLAVE_BANDEJA_RED,
  _reiniciarBandejaRed,
  activarPilotoRed,
  anotarFallaRed,
  leerBandeja,
  vaciarBandejaRed,
} from './bandeja-red'

class Memoria {
  m = new Map<string, string>()
  getItem(k: string) {
    return this.m.get(k) ?? null
  }
  setItem(k: string, v: string) {
    this.m.set(k, v)
  }
  removeItem(k: string) {
    this.m.delete(k)
  }
}

let memoria: Memoria
let respuestas: Array<number | Error>
let cuerpos: string[]

beforeEach(() => {
  _reiniciarBandejaRed()
  memoria = new Memoria()
  respuestas = []
  cuerpos = []
  vi.stubGlobal('window', { localStorage: memoria, location: { pathname: '/negocios/84630bca-1111-4222-8333-444455556666' } })
  vi.stubGlobal('navigator', {})
  vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
    cuerpos.push(String(init.body))
    const r = respuestas.shift() ?? 204
    if (r instanceof Error) throw r
    return { status: r } as Response
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('bandeja de eventos del piloto de red', () => {
  it('fuera del piloto no anota nada', () => {
    anotarFallaRed({ superficie: 'subida', error: new Error('x') })
    expect(memoria.getItem(CLAVE_BANDEJA_RED)).toBeNull()
  })

  it('anota la falla con la ruta normalizada y el error recortado', () => {
    activarPilotoRed()
    anotarFallaRed({ superficie: 'subida', error: new TypeError('Failed to fetch'), dur_ms: 1234.6 })
    const [e] = leerBandeja()
    expect(e).toMatchObject({ tipo: 'falla', superficie: 'subida', ruta: '/negocios/[id]', error: 'TypeError: Failed to fetch', dur_ms: 1235, sw: false })
  })

  it('un envío que no llega deja todo en la bandeja; el siguiente lo vacía', async () => {
    activarPilotoRed()
    anotarFallaRed({ superficie: 'carga' })
    anotarFallaRed({ superficie: 'accion' })
    respuestas = [new TypeError('Failed to fetch')]
    expect(await vaciarBandejaRed()).toBe(0)
    expect(leerBandeja()).toHaveLength(2)
    expect(await vaciarBandejaRed()).toBe(2)
    expect(leerBandeja()).toHaveLength(0)
    expect(JSON.parse(cuerpos[1]).eventos).toHaveLength(2)
  })

  it('un 307 a /login (sin sesión) no cuenta como confirmación', async () => {
    activarPilotoRed()
    anotarFallaRed({ superficie: 'carga' })
    respuestas = [0] // `redirect: manual` → respuesta opaca con status 0
    expect(await vaciarBandejaRed()).toBe(0)
    expect(leerBandeja()).toHaveLength(1)
  })

  it('lo que entra mientras se envía no se pierde', async () => {
    activarPilotoRed()
    anotarFallaRed({ superficie: 'carga' })
    let soltar!: () => void
    vi.stubGlobal('fetch', () => new Promise((r) => { soltar = () => r({ status: 204 }) }))
    const envio = vaciarBandejaRed()
    anotarFallaRed({ superficie: 'subida' })
    soltar()
    expect(await envio).toBe(1)
    expect(leerBandeja().map((e) => e.tipo === 'falla' && e.superficie)).toEqual(['subida'])
  })
})
