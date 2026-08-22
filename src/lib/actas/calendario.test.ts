import { describe, expect, it } from 'vitest'
import { elegirTranscripcion } from './calendario'

const doc = (id: string) => `https://docs.google.com/document/d/${id}/edit`

describe('elegirTranscripcion', () => {
  it('sin adjuntos devuelve el motivo, no una excepcion', () => {
    const r = elegirTranscripcion(undefined, '2026-08-20T10:00:00-05:00')
    expect(r.elegida).toBeNull()
    expect(r.motivo).toBe('sin_adjuntos')
  })

  // Medido: "Alejandra Lancheros - Trappvel x MeTRIK" (2026-08-19) quedo con
  // grabacion y notas de Gemini, sin transcripcion. No debe generar acta.
  it('grabacion + notas de Gemini no cuentan como transcripcion', () => {
    const r = elegirTranscripcion(
      [
        {
          title: 'Alejandra Lancheros - Trappvel x MéTRIK - 2026/08/19 09:01 GMT-05:00 - Recording',
          fileUrl: 'https://drive.google.com/file/d/1abcRECORDING/view',
        },
        { title: 'Notas de Gemini', fileUrl: doc('1abcNOTAS') },
      ],
      '2026-08-19T09:00:00-05:00',
    )
    expect(r.elegida).toBeNull()
    expect(r.motivo).toBe('solo_grabacion')
  })

  it('con una sola transcripcion la toma', () => {
    const r = elegirTranscripcion(
      [
        {
          title: 'Daniela Gomez - Trappvel x MéTRIK - 2026/08/20 10:01 GMT-05:00 - Transcript',
          fileUrl: doc('1DANIELA'),
        },
      ],
      '2026-08-20T10:00:00-05:00',
    )
    expect(r.elegida?.id).toBe('1DANIELA')
    expect(r.motivo).toBeNull()
  })

  // El caso que motivo el cambio: dos transcripciones en el mismo evento.
  // Reunion de las 12:00; sellos 11:55 y 17:55. Gana la de 11:55, y el orden
  // del arreglo es el contrario a proposito.
  it('con dos transcripciones gana la mas cercana al inicio, no la primera', () => {
    const r = elegirTranscripcion(
      [
        {
          title: 'Temas Marketing + Ventas - Soena x MéTRIK - 2026/08/18 17:55 GMT-05:00 - Transcript',
          fileUrl: doc('1TARDE'),
        },
        {
          title: 'Temas Marketing + Ventas - Soena x MéTRIK - 2026/08/18 11:55 GMT-05:00 - Transcript',
          fileUrl: doc('1CORRECTA'),
        },
      ],
      '2026-08-18T12:00:00-05:00',
    )
    expect(r.elegida?.id).toBe('1CORRECTA')
  })

  it('un adjunto de transcripcion sin fileId de Doc no se acepta en silencio', () => {
    const r = elegirTranscripcion(
      [{ title: 'Reunion X - 2026/08/20 16:00 GMT-05:00 - Transcript', fileUrl: 'https://example.com/x' }],
      '2026-08-20T16:00:00-05:00',
    )
    expect(r.elegida).toBeNull()
    expect(r.motivo).toBe('adjunto_ilegible')
  })

  it('si una transcripcion no trae sello sigue siendo elegible cuando es la unica legible', () => {
    const r = elegirTranscripcion(
      [
        { title: 'Reunion sin sello - Transcript', fileUrl: doc('1SINSELLO') },
        { title: 'Reunion - 2026/08/20 16:00 GMT-05:00 - Transcript', fileUrl: 'https://example.com/x' },
      ],
      '2026-08-20T16:00:00-05:00',
    )
    expect(r.elegida?.id).toBe('1SINSELLO')
  })
})
