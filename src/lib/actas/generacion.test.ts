import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { faltaLlaveDeActas, generarActa } from './generacion'
import type { CandidataActa } from './seleccion'
import type { ReunionCalendario } from './calendario'

function candidata(over: Partial<CandidataActa> = {}): CandidataActa {
  const reunion: ReunionCalendario = {
    eventId: 'ev1',
    titulo: 'Temas Marketing + Ventas - Soena x MéTRIK',
    inicio: '2026-08-18T12:00:00-05:00',
    fin: '2026-08-18T13:00:00-05:00',
    duracionAgendadaSegundos: 3600,
    participantes: [
      { email: 'mauricio.moreno@metrik.com.co', organizador: true, esUnoMismo: true },
      { email: 'daniela@gruposoena.com', organizador: false, esUnoMismo: false },
    ],
    transcriptFileId: '1DOC',
    transcriptNombre: 'Temas - Transcript',
    motivoSinTranscripcion: null,
    meetUrl: 'https://meet.google.com/abc-defg-hij',
  }
  return {
    reunion,
    transcripcion: {
      titulo: 'Temas Marketing + Ventas',
      asistentes: ['Mauricio Moreno', 'Daniela Játiva Castro'],
      duracionSegundos: 3600,
      cuerpo: 'Mauricio Moreno: Hola.\n\nDaniela Játiva Castro: Hola, hablemos del plan.',
      vacia: false,
    },
    duracionRealSegundos: 3600,
    tipo: 'externa',
    dominiosExternos: ['gruposoena.com'],
    ...over,
  }
}

function respuestaGemini(payload: unknown, finishReason = 'STOP') {
  return {
    ok: true,
    json: async () => ({
      candidates: [
        {
          finishReason,
          content: { parts: [{ text: JSON.stringify(payload) }] },
        },
      ],
    }),
  }
}

describe('generarActa', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
    // Las pruebas de abajo van por el camino de Gemini: sin llave de Anthropic, fetchModeloActas no traduce.
    vi.stubEnv('ANTHROPIC_API_KEY', '')
    vi.stubEnv('LLM_PROVEEDOR', '')
    vi.stubEnv('LLM_PROVEEDOR_ACTAS', '')
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('lanza si no hay apiKey', async () => {
    await expect(generarActa(candidata(), '')).rejects.toThrow('GEMINI_API_KEY')
  })

  it('lanza si el cuerpo de la transcripcion esta vacio', async () => {
    await expect(
      generarActa(candidata({ transcripcion: { ...candidata().transcripcion, cuerpo: '  ' } }), 'k'),
    ).rejects.toThrow('cuerpo')
  })

  it('parsea la respuesta de Gemini a la forma esperada', async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue(
      respuestaGemini({
        resumen: 'Se hablo del plan de marketing y ventas para el trimestre.',
        decisiones: ['Se aprueba el presupuesto de campana'],
        compromisos: [
          { responsable: 'Daniela Játiva Castro', tarea: 'Enviar el brief', fecha_limite: 'viernes' },
          { responsable: 'Mauricio Moreno', tarea: 'Revisar la propuesta', fecha_limite: null },
        ],
      }),
    )

    const acta = await generarActa(candidata(), 'fake-key')

    expect(acta.resumen).toContain('marketing')
    expect(acta.decisiones).toEqual(['Se aprueba el presupuesto de campana'])
    expect(acta.compromisos).toEqual([
      { responsable: 'Daniela Játiva Castro', tarea: 'Enviar el brief', fecha_limite: 'viernes' },
      { responsable: 'Mauricio Moreno', tarea: 'Revisar la propuesta', fecha_limite: null },
    ])

    // El prompt sistema declara los asistentes conocidos, para que el modelo
    // no invente nombres.
    const body = JSON.parse(mockFetch.mock.calls[0][1].body)
    expect(body.system_instruction.parts[0].text).toContain('Mauricio Moreno')
    expect(body.system_instruction.parts[0].text).toContain('Daniela Játiva Castro')
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingLevel: 'low' })
  })

  it('repara JSON con coma colgante antes de rendirse', async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    const roto = '{"resumen":"ok","decisiones":["uno",],"compromisos":[]}'
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ finishReason: 'STOP', content: { parts: [{ text: roto }] } }],
      }),
    })

    const acta = await generarActa(candidata(), 'fake-key')
    expect(acta.decisiones).toEqual(['uno'])
  })

  it('descarta compromisos sin responsable o sin tarea', async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue(
      respuestaGemini({
        resumen: 'resumen',
        decisiones: [],
        compromisos: [
          { responsable: '', tarea: 'algo', fecha_limite: null },
          { responsable: 'Mauricio', tarea: '', fecha_limite: null },
          { responsable: 'Mauricio', tarea: 'algo valido', fecha_limite: null },
        ],
      }),
    )

    const acta = await generarActa(candidata(), 'fake-key')
    expect(acta.compromisos).toEqual([{ responsable: 'Mauricio', tarea: 'algo valido', fecha_limite: null }])
  })

  it('lanza si Gemini corta por MAX_TOKENS sin devolver JSON', async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: '' }] } }],
      }),
    })

    await expect(generarActa(candidata(), 'fake-key')).rejects.toThrow(/agoto el limite/)
  })

  it('lanza si Gemini bloquea el contenido', async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ promptFeedback: { blockReason: 'SAFETY' } }),
    })

    await expect(generarActa(candidata(), 'fake-key')).rejects.toThrow('bloqueado')
  })

  it('lanza si la API responde con error HTTP', async () => {
    const mockFetch = fetch as unknown as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => 'Internal error',
    })

    await expect(generarActa(candidata(), 'fake-key')).rejects.toThrow('Error de Gemini (500)')
  })
})

describe('la llave que exigen las actas (faltaLlaveDeActas)', () => {
  const ent = (v: Record<string, string>) => (k: string) => v[k]

  it('Haiku activo (por defecto, con ANTHROPIC_API_KEY): no exige GEMINI_API_KEY', () => {
    expect(faltaLlaveDeActas(undefined, ent({ ANTHROPIC_API_KEY: 'sk' }))).toBeNull()
    expect(faltaLlaveDeActas('', ent({ ANTHROPIC_API_KEY: 'sk', LLM_PROVEEDOR_ACTAS: 'anthropic' }))).toBeNull()
  })

  it('las actas resuelven a Gemini: exige GEMINI_API_KEY como siempre', () => {
    for (const e of <Record<string, string>[]>[
      { ANTHROPIC_API_KEY: 'sk', LLM_PROVEEDOR_ACTAS: 'gemini' },
      { ANTHROPIC_API_KEY: 'sk', LLM_PROVEEDOR: 'gemini' },
    ]) {
      expect(faltaLlaveDeActas(undefined, ent(e))).toMatch(/GEMINI_API_KEY no configurada.*van a Gemini/)
      expect(faltaLlaveDeActas('g', ent(e))).toBeNull()
    }
    // Sin la llave de Anthropic, fetchModeloActas sigue en Gemini: con su llave, sale.
    expect(faltaLlaveDeActas('g', ent({}))).toBeNull()
  })

  it('sin ninguna llave utilizable: el mensaje nombra las dos', () => {
    expect(faltaLlaveDeActas(undefined, ent({}))).toBe(
      'Sin llave de modelo para las actas: falta ANTHROPIC_API_KEY (Claude Haiku) y GEMINI_API_KEY (respaldo en Gemini)',
    )
    expect(faltaLlaveDeActas('  ', ent({ ANTHROPIC_API_KEY: '  ' }))).toMatch(/falta ANTHROPIC_API_KEY/)
  })
})

describe('generarActa con Haiku y sin GEMINI_API_KEY', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it('sale solo a Anthropic, sin pedido a Gemini, y devuelve el acta', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-prueba')
    vi.stubEnv('LLM_PROVEEDOR', '')
    vi.stubEnv('LLM_PROVEEDOR_ACTAS', '')
    const payload = { resumen: 'Se hablo del plan.', decisiones: ['Seguir'], compromisos: [] }
    const mockFetch = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            content: [{ type: 'text', text: JSON.stringify(payload) }],
            stop_reason: 'end_turn',
            usage: { input_tokens: 10, output_tokens: 10 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    vi.stubGlobal('fetch', mockFetch)

    const acta = await generarActa(candidata(), undefined)
    expect(acta.resumen).toBe('Se hablo del plan.')
    expect(acta.decisiones).toEqual(['Seguir'])
    const urls = mockFetch.mock.calls.map((c) => String((c as unknown[])[0]))
    expect(urls).toEqual(['https://api.anthropic.com/v1/messages'])
  })

  it('con las actas en Gemini y sin su llave, no llama a nadie', async () => {
    vi.stubEnv('ANTHROPIC_API_KEY', 'sk-prueba')
    vi.stubEnv('LLM_PROVEEDOR_ACTAS', 'gemini')
    const mockFetch = vi.fn()
    vi.stubGlobal('fetch', mockFetch)
    await expect(generarActa(candidata(), '')).rejects.toThrow('GEMINI_API_KEY no configurada')
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
