/**
 * La llamada a Gemini del redactor del texto para el cliente, con `fetch` falso.
 *
 * Lo que se fija: qué SALE hacia el modelo (sin nombres ni precios, con esquema fijo) y
 * qué se hace con una respuesta rara (cortada, bloqueada, con cercas de código, vacía).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { redactarTextoCliente } from './redactar-documento-cliente'
import { viajeParaRedactar } from '@/lib/cotizaciones/documento-cliente'

const campos = (o: Record<string, string>) => Object.entries(o).map(([label, valor]) => ({ label, valor }))

const VIAJE = viajeParaRedactar({
  items: [
    {
      nombre: 'AVIANCA BOG - ADZ LIGIA',
      grupo: 'vuelo',
      tarifa_pax: {
        casillas: {
          grupo_completo: {
            total: 1,
            moneda: 'COP',
            campos: campos({ 'Aerolínea': 'Avianca', 'Origen': 'Bogotá', 'Destino': 'San Andrés Isla', 'Salida': '2026-11-23', 'Precio': '6208296' }),
          },
        },
      },
    },
    { nombre: 'SEGURO LIGIA SANCHEZ $ 350.000', grupo: null },
  ],
  destino: 'San Andrés',
  fechas: { inicio: '2026-11-23', fin: '2026-11-28' },
  composicion: { adultos: 2, ninos: 0, infantes: 0 },
  nombresDelCliente: ['Ligia Sanchez', 'Ligia'],
})

const RESPUESTA = {
  titular: 'San Andrés, el mar de siete colores',
  intro: 'Seis días en San Andrés para descansar frente al Caribe.',
  incluye: ['Tiquetes Bogotá - San Andrés con Avianca', 'Seguro de viaje'],
  antes_de_viajar: ['Tramite la tarjeta de turismo de San Andrés antes de volar.'],
}

function respuestaGemini(texto: string, extra: Record<string, unknown> = {}) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: texto }] } }], ...extra }),
    text: async () => '',
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('redactarTextoCliente', () => {
  it('manda solo el viaje, con esquema JSON fijo, y devuelve el texto limpio', async () => {
    const fetchFalso = vi.fn(async () => respuestaGemini(JSON.stringify(RESPUESTA)))
    vi.stubGlobal('fetch', fetchFalso)

    const r = await redactarTextoCliente(VIAJE, 'clave-de-prueba')
    expect(r.modelo).toBe('gemini-2.5-flash')
    expect(r.texto.titular).toBe(RESPUESTA.titular)
    expect(r.texto.incluye).toEqual(RESPUESTA.incluye)

    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, { body: string }]
    expect(url).toContain('gemini-2.5-flash:generateContent')
    const body = JSON.parse(init.body)
    expect(body.generationConfig.responseMimeType).toBe('application/json')
    expect(body.generationConfig.responseSchema.required).toEqual(['titular', 'intro', 'incluye', 'antes_de_viajar'])

    // ⚠️⚠️ Lo que sale hacia el modelo: ni el nombre del cliente ni una cifra de dinero.
    const enviado = init.body.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    expect(enviado).not.toContain('ligia')
    expect(enviado).not.toContain('sanchez')
    for (const cifra of ['6208296', '350.000', '350000']) expect(init.body).not.toContain(cifra)
  })

  it('los ejemplos de la voz van en las instrucciones, nunca en la entrada del viaje', async () => {
    const fetchFalso = vi.fn(async () => respuestaGemini(JSON.stringify(RESPUESTA)))
    vi.stubGlobal('fetch', fetchFalso)

    const ejemplos = [{ titular: null, intro: 'Glaciares, cataratas y buenos vinos: Argentina tiene de todo.', incluye: [], antes_de_viajar: [] }]
    await redactarTextoCliente(VIAJE, 'clave-de-prueba', { ejemplos })
    const [, init] = fetchFalso.mock.calls[0] as unknown as [string, { body: string }]
    const body = JSON.parse(init.body)
    expect(body.system_instruction.parts[0].text).toContain('EJEMPLOS DE LA VOZ DE TRAPPVEL')
    expect(body.system_instruction.parts[0].text).toContain('Argentina tiene de todo.')
    expect(body.contents[0].parts[0].text).not.toContain('Argentina')
  })

  it('sin clave no llama a nadie', async () => {
    const fetchFalso = vi.fn()
    vi.stubGlobal('fetch', fetchFalso)
    await expect(redactarTextoCliente(VIAJE, '')).rejects.toThrow('GEMINI_API_KEY')
    expect(fetchFalso).not.toHaveBeenCalled()
  })

  it('⚠️ una respuesta cortada (MAX_TOKENS) no pasa por completa', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '{"titular":"San' }] } }] }),
      text: async () => '',
    })))
    await expect(redactarTextoCliente(VIAJE, 'k')).rejects.toThrow('MAX_TOKENS')
  })

  it('un contenido bloqueado se reporta como tal', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuestaGemini('', { promptFeedback: { blockReason: 'SAFETY' } })))
    await expect(redactarTextoCliente(VIAJE, 'k')).rejects.toThrow('SAFETY')
  })

  it('un error HTTP se reporta con su código', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}), text: async () => 'ocupado' })))
    await expect(redactarTextoCliente(VIAJE, 'k')).rejects.toThrow('503')
  })

  it('repara un JSON envuelto en cercas de código', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuestaGemini('```json\n' + JSON.stringify(RESPUESTA) + '\n```')))
    const r = await redactarTextoCliente(VIAJE, 'k')
    expect(r.texto.intro).toBe(RESPUESTA.intro)
  })

  it('un texto que queda vacío tras limpiar es un error, no un borrador en blanco', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respuestaGemini(JSON.stringify({
      titular: 'Desde $ 1.200.000', intro: '', incluye: ['COP 350000'], antes_de_viajar: [],
    }))))
    await expect(redactarTextoCliente(VIAJE, 'k')).rejects.toThrow('vacío')
  })
})
