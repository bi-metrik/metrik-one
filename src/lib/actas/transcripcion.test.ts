import { describe, it, expect } from 'vitest'
import { parseTranscripcion, parseNombreArchivo } from './transcripcion'

// Muestra fiel al formato real que produce Meet (verificado contra la carpeta
// de transcripciones de mauricio.moreno@metrik.com.co).
const REAL = `## **Temas Marketing + Ventas - Soena x MéTRIK**

# **Asistentes**

Daniela Játiva Castro, Mauricio Moreno

# **Transcripción**

### 00:05:00

Daniela Játiva Castro: Hola, Mauro.

Mauricio Moreno: Dani, ¿cómo vas?

Mauricio Moreno: Todo super bien, todo andando.

### 00:15:00

Daniela Játiva Castro: Listo, ahí te di acceso.

### La reunión finalizó después de 00:18:23 

*Esta transcripción editable se generó automáticamente y puede contener errores.*
`

const SIN_MARCADOR_FIN = `## **Reunión larga**

# **Asistentes**

Ana Ruiz, Mauricio Moreno

# **Transcripción**

### 00:05:00

Ana Ruiz: Buenas.

Mauricio Moreno: Hola.

Ana Ruiz: Seguimos.

### 01:25:00

Ana Ruiz: Cerramos.
`

const VACIA = `## **Alineación Proyecto - AFI x MéTRIK**

# **Asistentes**

Mauricio Moreno

# **Transcripción**
`

describe('parseTranscripcion', () => {
  it('extrae titulo, asistentes y duracion real del marcador de cierre', () => {
    const t = parseTranscripcion(REAL)
    expect(t.titulo).toBe('Temas Marketing + Ventas - Soena x MéTRIK')
    expect(t.asistentes).toEqual(['Daniela Játiva Castro', 'Mauricio Moreno'])
    expect(t.duracionSegundos).toBe(18 * 60 + 23)
    expect(t.vacia).toBe(false)
  })

  it('el cuerpo arranca en la transcripcion, sin el bloque de asistentes', () => {
    const t = parseTranscripcion(REAL)
    expect(t.cuerpo.startsWith('### 00:05:00')).toBe(true)
    expect(t.cuerpo).not.toContain('Asistentes')
  })

  it('cae a la ultima marca de tiempo cuando falta el marcador de cierre', () => {
    const t = parseTranscripcion(SIN_MARCADOR_FIN)
    expect(t.duracionSegundos).toBe(85 * 60)
  })

  it('marca como vacia una transcripcion sin intervenciones', () => {
    const t = parseTranscripcion(VACIA)
    expect(t.vacia).toBe(true)
    expect(t.duracionSegundos).toBeNull()
  })

  it('una reunion de 18 minutos no pasa el umbral de una hora', () => {
    const t = parseTranscripcion(REAL)
    expect(t.duracionSegundos! >= 3600).toBe(false)
  })
})

describe('parseNombreArchivo', () => {
  it('separa titulo del evento y contraparte en una reunion agendada', () => {
    const m = parseNombreArchivo(
      'Temas Marketing + Ventas - Soena x MéTRIK - 2026/08/18 11:55 GMT-05:00 - Transcript',
    )
    expect(m.tituloEvento).toBe('Temas Marketing + Ventas - Soena x MéTRIK')
    expect(m.contraparte).toBe('Soena')
    expect(m.codigoMeet).toBeNull()
    expect(m.esTranscript).toBe(true)
    expect(m.esNotasGemini).toBe(false)
  })

  it('reconoce una reunion ad-hoc por el codigo de Meet y no inventa contraparte', () => {
    const m = parseNombreArchivo('kud-trys-hix (2026-08-13 11:20 GMT-5) - Transcript')
    expect(m.codigoMeet).toBe('kud-trys-hix')
    expect(m.tituloEvento).toBeNull()
    expect(m.contraparte).toBeNull()
  })

  it('distingue el documento de notas de Gemini del transcript', () => {
    const m = parseNombreArchivo(
      'Sesión 3 Diagnóstico - Trappvel x MéTRIK - 2026/08/05 16:23 GMT-05:00 - Notes by Gemini',
    )
    expect(m.esNotasGemini).toBe(true)
    expect(m.esTranscript).toBe(false)
    expect(m.contraparte).toBe('Trappvel')
  })
})
