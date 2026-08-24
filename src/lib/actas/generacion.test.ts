import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { generarActa } from './generacion'
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
  })
  afterEach(() => {
    vi.unstubAllGlobals()
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
    expect(body.generationConfig.thinkingConfig).toEqual({ thinkingBudget: 1024 })
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
