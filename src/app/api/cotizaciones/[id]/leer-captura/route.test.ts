/**
 * Las dos rutas de lectura de la bandeja son un paso sin lógica propia: validan el cuerpo y
 * delegan en la misma acción de siempre (sesión, RLS, módulo). Ver `bandeja-red.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const llamadas: unknown[][] = []
vi.mock('@/app/(app)/negocios/tarifa-pax-actions', () => ({
  leerCapturaEnBorrador: async (...a: unknown[]) => { llamadas.push(['leer', ...a]); return { ok: true, marca: 'leer' } },
}))
vi.mock('@/app/(app)/negocios/ranura-actions', () => ({
  detectarCaptura: async (...a: unknown[]) => { llamadas.push(['detectar', ...a]); return { ok: true, marca: 'detectar' } },
}))

import { POST as leer } from './route'
import { POST as detectar } from '../detectar-captura/route'

const params = Promise.resolve({ id: 'cot-1' })
const pedir = (cuerpo: unknown) => new Request('http://x/api', { method: 'POST', body: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo) })

beforeEach(() => { llamadas.length = 0 })

describe('POST /api/cotizaciones/[id]/leer-captura', () => {
  it('delega en leerCapturaEnBorrador con el tipo, la imagen y el enfoque', async () => {
    const r = await leer(pedir({ tipo: 'hotel', dataUrl: 'data:x', enfoque: { nombre: 'Enilda', precio: '$1' } }), { params })
    expect(await r.json()).toEqual({ ok: true, marca: 'leer' })
    expect(llamadas).toEqual([['leer', 'cot-1', 'hotel', 'data:x', { nombre: 'Enilda', precio: '$1' }]])
  })
  it('sin enfoque pasa null', async () => {
    await leer(pedir({ tipo: 'vuelo', dataUrl: 'data:x' }), { params })
    expect(llamadas[0][4]).toBeNull()
  })
  it('cuerpo incompleto o ilegible: 400 y no lee', async () => {
    expect((await leer(pedir({ tipo: 'hotel' }), { params })).status).toBe(400)
    expect((await leer(pedir('no es json'), { params })).status).toBe(400)
    expect(llamadas).toEqual([])
  })
})

describe('POST /api/cotizaciones/[id]/detectar-captura', () => {
  it('delega en detectarCaptura', async () => {
    const r = await detectar(pedir({ dataUrl: 'data:x' }), { params })
    expect(await r.json()).toEqual({ ok: true, marca: 'detectar' })
    expect(llamadas).toEqual([['detectar', 'cot-1', 'data:x']])
  })
  it('sin imagen: 400 y no detecta', async () => {
    expect((await detectar(pedir({}), { params })).status).toBe(400)
    expect(llamadas).toEqual([])
  })
})
