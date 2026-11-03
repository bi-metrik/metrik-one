import { beforeEach, describe, expect, it, vi } from 'vitest'

import aliadosVuelos from './__fixtures__/bloqueo/aliados-vuelos.json'
import aliadosHotel from './__fixtures__/bloqueo/aliados-hotel.json'
import { PROMPT_HOTEL_BLOQUEO, PROMPT_VUELO_BLOQUEO } from './bloqueo-extraccion'

/**
 * El pantallazo pegado en una cotización de bloqueo lo lee el lector del BLOQUEO (QA del 2026-10-29).
 * El modelo es un doble: ni llaves ni red ni cuota. El caso real: el vuelo de COT-2026-0007, que no trae
 * precio (en un bloqueo el vuelo va dentro del precio del paquete) y el lector genérico rechazaba (RX4).
 */

const detectado = { tipo: 'vuelo' as string | null }
/** Lo que «devuelve el modelo» para el hotel; `null` = el fixture de Aliados. */
const respuestaHotel = { valor: null as unknown }
const prompts: string[] = []

vi.mock('@/lib/server-keys', () => ({ getServerKey: () => 'llave-de-prueba' }))
vi.mock('@/lib/ai/detectar-tipo-captura', () => ({
  detectarTipoDeCaptura: async () => ({ data: { tipo: detectado.tipo, lugar: null, origen: null, destino: null } }),
}))
// Si algo intentara el lector genérico, la prueba lo ve: no debe cargarse nunca.
vi.mock('@/lib/ai/extraer-ranura', () => { throw new Error('el lector genérico no se usa en un bloqueo') })
vi.mock('@/lib/ai/modelo-llm', () => ({
  fetchModeloDocumentos: async (_url: string, init: { body: string }) => {
    const cuerpo = JSON.parse(init.body) as { system_instruction: { parts: { text: string }[] } }
    const prompt = cuerpo.system_instruction.parts[0].text
    prompts.push(prompt)
    const respuesta = prompt === PROMPT_VUELO_BLOQUEO ? aliadosVuelos : (respuestaHotel.valor ?? aliadosHotel)
    return new Response(JSON.stringify({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(respuesta) }] } }] }), { status: 200 })
  },
}))

const { leerPantallazoDeBloqueo, MENSAJE_ELEGIR_CASILLA } = await import('./bloqueo-leer')
const IMAGEN = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

beforeEach(() => {
  prompts.length = 0
  detectado.tipo = 'vuelo'
  respuestaHotel.valor = null
})

describe('lector del bloqueo con detección', () => {
  it('un vuelo SIN precio pegado sin casilla: se detecta vuelo y lo lee PROMPT_VUELO_BLOQUEO, sin pedir precio', async () => {
    const r = await leerPantallazoDeBloqueo('detectar', IMAGEN)
    expect(prompts).toEqual([PROMPT_VUELO_BLOQUEO])
    expect(r.ok).toBe(true)
    if (!r.ok || r.cual !== 'vuelo') throw new Error('debía leer el vuelo')
    expect(r.vuelo.tramos.length).toBeGreaterThan(0)
    expect(JSON.stringify(aliadosVuelos)).not.toMatch(/precio/i)
  })
  it('un hotel (o un «paquete») detectado va a la casilla del hotel', async () => {
    detectado.tipo = 'paquete'
    const r = await leerPantallazoDeBloqueo('detectar', IMAGEN)
    expect(prompts).toEqual([PROMPT_HOTEL_BLOQUEO])
    expect(r.ok && r.cual).toBe('hotel')
  })
  it('si la detección no sabe, NO se lee nada: la tarjeta pregunta «¿hotel o vuelo?»', async () => {
    detectado.tipo = null
    const r = await leerPantallazoDeBloqueo('detectar', IMAGEN)
    expect(prompts).toEqual([])
    expect(r).toMatchObject({ ok: false, elegir: true, mensaje: MENSAJE_ELEGIR_CASILLA })
  })
  it('con la casilla dicha no se detecta: se lee directo', async () => {
    detectado.tipo = 'hotel'
    const r = await leerPantallazoDeBloqueo('vuelo', IMAGEN)
    expect(prompts).toEqual([PROMPT_VUELO_BLOQUEO])
    expect(r.ok && r.cual).toBe('vuelo')
  })
})

describe('prueba real del 2026-10-29: «INF 180.000» y «seguro hotelero»', () => {
  it('el precio del infante que lee el modelo llega a la tarjeta; el seguro hotelero no es seguro médico', async () => {
    respuestaHotel.valor = {
      ...aliadosHotel,
      iconos: [],
      infante: { precio: 180000 },
      texto_incluye: 'Incluye traslados in y out y seguro hotelero',
      incluye_por_texto: ['traslados', 'seguro_medico'],
    }
    const r = await leerPantallazoDeBloqueo('hotel', IMAGEN)
    expect(prompts).toEqual([PROMPT_HOTEL_BLOQUEO])
    if (!r.ok || r.cual !== 'hotel') throw new Error('debía leer el hotel')
    expect(r.hotel.infante).toEqual({ precio: 180000 })
    expect(r.incluye.casillas.traslados).toBe(true)
    expect(r.incluye.casillas.seguro_medico).toBeNull()
  })
})
