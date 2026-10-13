import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  armarPedido,
  CORTE_DESTINO_MS,
  decidirDestinoConModelo,
  leerServiciosDelViaje,
  normalizarDecision,
  type ServicioDelViaje,
} from './decidir-destino'

/**
 * C5 · V6 de Vera: la decisión del modelo corre en la lectura con un corte de 2,5 s. Con el modelo
 * lento o caído, devuelve `null` sin esperar más, y la fila se queda con la frase de las reglas.
 */

const SERVICIOS: ServicioDelViaje[] = [
  { id: 'v-avianca', tipo: 'vuelo', servicio: 'Vuelo', nombre: 'AVIANCA BOGOTÁ ⇄ SAN ANDRÉS', detalle: 'Avianca · Bogotá BOG · San Andrés ADZ · 2026-11-23' },
  { id: 'a-cayo', tipo: 'actividad', servicio: 'Actividad en Providencia', nombre: 'Cayo Cangrejo · lancha compartida', detalle: '' },
]
const LECTURA = { tipo: 'actividad', nombre: 'Cayo Cangrejo · lancha privada', detalle: 'Cayo Cangrejo · 2026-11-24', ocupacion: '6 adultos, 1 niños, 1 infantes' }
const IDS = new Set(SERVICIOS.map(s => s.id))

const respuesta = (cuerpo: unknown) => new Response(JSON.stringify({
  candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(cuerpo) }] } }],
}), { status: 200 })

afterEach(() => {
  vi.useRealTimers()
})

describe('C5 · lo que se le pregunta al modelo y cómo se lee su respuesta', () => {
  it('el pedido lleva los servicios con su id y el pantallazo nuevo', () => {
    const t = armarPedido(LECTURA, SERVICIOS)
    expect(t).toContain('id=v-avianca')
    expect(t).toContain('id=a-cayo')
    expect(t).toContain('Cayo Cangrejo · lancha privada')
  })

  it('un id que no estaba en la lista no vale', () => {
    expect(normalizarDecision({ como: 'hermana', servicio: 'inventado', duda: false, razon: 'x' }, IDS)).toBeNull()
    expect(normalizarDecision({ como: 'hermana', servicio: 'a-cayo', duda: false, razon: 'Otra lancha' }, IDS)).toEqual({ como: 'hermana', itemId: 'a-cayo', razon: 'Otra lancha', duda: false })
  })

  it('una forma desconocida no vale; la duda conserva contra qué dudó', () => {
    expect(normalizarDecision({ como: 'reemplaza' }, IDS)).toBeNull()
    expect(normalizarDecision(null, IDS)).toBeNull()
    expect(normalizarDecision({ como: 'nueva', servicio: 'a-cayo', duda: true }, IDS)).toEqual({ como: 'nueva', itemId: 'a-cayo', razon: null, duda: true })
    expect(normalizarDecision({ como: 'nueva', servicio: 'a-cayo', duda: false }, IDS)).toEqual({ como: 'nueva', itemId: null, razon: null, duda: false })
  })

  it('los servicios que manda el navegador se leen sin confiar en su forma', () => {
    expect(leerServiciosDelViaje('x')).toEqual([])
    expect(leerServiciosDelViaje([{ id: '' }, null, { id: 'a', nombre: 7 }])).toEqual([{ id: 'a', tipo: '', servicio: '', nombre: '', detalle: '' }])
    expect(leerServiciosDelViaje(Array.from({ length: 100 }, (_, i) => ({ id: `s${i}` })))).toHaveLength(60)
  })
})

describe('C5 · V6 · el corte de 2,5 s', () => {
  it('el corte es de 2,5 s', () => {
    expect(CORTE_DESTINO_MS).toBe(2500)
  })

  it('con el modelo lento, a los 2,5 s devuelve `null` y no espera más', async () => {
    vi.useFakeTimers()
    let abortado = false
    const lento = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_res, rej) => {
      init?.signal?.addEventListener('abort', () => { abortado = true; rej(Object.assign(new Error('abort'), { name: 'AbortError' })) })
    }))
    const p = decidirDestinoConModelo(LECTURA, SERVICIOS, 'llave', { fetchImpl: lento as unknown as typeof fetch })
    let listo = false
    void p.then(() => { listo = true })
    await vi.advanceTimersByTimeAsync(CORTE_DESTINO_MS - 1)
    expect(listo).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(await p).toBeNull()
    expect(abortado).toBe(true)
  })

  it('con el modelo caído (error de red o 500) devuelve `null` en el acto', async () => {
    const caido = vi.fn(async () => { throw new Error('ECONNRESET') })
    expect(await decidirDestinoConModelo(LECTURA, SERVICIOS, 'llave', { fetchImpl: caido as unknown as typeof fetch })).toBeNull()
    const quinientos = vi.fn(async () => new Response('x', { status: 500 }))
    expect(await decidirDestinoConModelo(LECTURA, SERVICIOS, 'llave', { fetchImpl: quinientos as unknown as typeof fetch })).toBeNull()
  })

  it('sin llave no llama a nadie', async () => {
    const f = vi.fn()
    expect(await decidirDestinoConModelo(LECTURA, SERVICIOS, '', { fetchImpl: f as unknown as typeof fetch })).toBeNull()
    expect(f).not.toHaveBeenCalled()
  })

  it('con el modelo a tiempo, devuelve su decisión ya validada', async () => {
    const ok = vi.fn(async () => respuesta({ como: 'hermana', servicio: 'a-cayo', duda: false, razon: 'La misma excursión en otra lancha' }))
    expect(await decidirDestinoConModelo(LECTURA, SERVICIOS, 'llave', { fetchImpl: ok as unknown as typeof fetch }))
      .toEqual({ como: 'hermana', itemId: 'a-cayo', razon: 'La misma excursión en otra lancha', duda: false })
  })
})
