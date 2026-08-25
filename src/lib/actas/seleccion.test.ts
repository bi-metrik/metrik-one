import { describe, expect, it } from 'vitest'
import { evaluarReunion, DURACION_MINIMA_SEGUNDOS } from './seleccion'
import type { ReunionCalendario } from './calendario'

function transcripcion(duracion: string, lineas = 4): string {
  const cuerpo = Array.from({ length: lineas }, (_, i) =>
    i % 2 === 0 ? `Daniela Játiva Castro: Linea ${i}.` : `Mauricio Moreno: Linea ${i}.`,
  ).join('\n\n')
  return `## **Reunión de prueba**

# **Asistentes**

Daniela Játiva Castro, Mauricio Moreno

# **Transcripción**

### 00:05:00

${cuerpo}

### La reunión finalizó después de ${duracion} 
`
}

function reunion(over: Partial<ReunionCalendario> = {}): ReunionCalendario {
  return {
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
    ...over,
  }
}

describe('evaluarReunion', () => {
  // El caso real: agendada a 60 minutos, duro 18:23. La agenda no manda.
  it('descarta por duracion real aunque la agendada alcance el minimo', () => {
    const r = evaluarReunion(reunion(), transcripcion('00:18:23'))
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.descarte.motivo).toBe('duracion_insuficiente')
      expect(r.descarte.detalle).toBe('18 min de 45 requeridos')
    }
  })

  it('acepta cuando la duracion real supera el minimo', () => {
    const r = evaluarReunion(reunion(), transcripcion('01:12:40'))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.candidata.duracionRealSegundos).toBe(4360)
      expect(r.candidata.duracionRealSegundos).toBeGreaterThan(DURACION_MINIMA_SEGUNDOS)
    }
  })

  it('marca externa la reunion con un correo fuera del dominio de MeTRIK', () => {
    const r = evaluarReunion(reunion(), transcripcion('01:30:00'))
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.candidata.tipo).toBe('externa')
      expect(r.candidata.dominiosExternos).toEqual(['gruposoena.com'])
    }
  })

  it('marca interna la reunion donde todos son de MeTRIK', () => {
    const r = evaluarReunion(
      reunion({
        participantes: [
          { email: 'mauricio.moreno@metrik.com.co', organizador: true, esUnoMismo: true },
          { email: 'otro@METRIK.COM.CO', organizador: false, esUnoMismo: false },
        ],
      }),
      transcripcion('01:05:00'),
    )
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.candidata.tipo).toBe('interna')
      expect(r.candidata.dominiosExternos).toEqual([])
    }
  })

  // Alejandra Lancheros 2026-08-19: Recording + Notas de Gemini, sin transcripcion.
  it('propaga el motivo que venia del calendario cuando no hay transcripcion', () => {
    const r = evaluarReunion(
      reunion({ transcriptFileId: null, motivoSinTranscripcion: 'solo_grabacion' }),
      null,
    )
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.descarte.motivo).toBe('solo_grabacion')
  })

  it('descarta la reunion sin invitados: no hay a quien enviarle el acta', () => {
    const r = evaluarReunion(reunion({ participantes: [] }), transcripcion('02:00:00'))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.descarte.motivo).toBe('sin_participantes')
  })

  it('descarta la transcripcion sin habla util', () => {
    const r = evaluarReunion(reunion(), transcripcion('01:30:00', 1))
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.descarte.motivo).toBe('transcripcion_vacia')
  })

  it('el minimo se puede bajar para la semana de revision', () => {
    const r = evaluarReunion(reunion(), transcripcion('00:18:23'), {
      duracionMinimaSegundos: 600,
    })
    expect(r.ok).toBe(true)
  })

  // Los dos casos que motivaron bajar el umbral: 50 y 55 minutos de trabajo
  // real que con una hora quedaban sin acta.
  it('50 y 55 minutos ya generan acta con el umbral en 45', () => {
    for (const d of ['00:50:12', '00:55:47']) {
      const r = evaluarReunion(reunion(), transcripcion(d))
      expect(r.ok).toBe(true)
    }
  })

  it('el umbral por defecto son 45 minutos', () => {
    expect(DURACION_MINIMA_SEGUNDOS).toBe(2700)
  })
})
