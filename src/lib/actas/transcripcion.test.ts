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
    // El cuerpo queda como habla pura: sin encabezados y sin marcas de tiempo.
    expect(t.cuerpo.startsWith('Daniela Játiva Castro: Hola, Mauro.')).toBe(true)
    expect(t.cuerpo).not.toContain('Asistentes')
    expect(t.cuerpo).not.toContain('00:05:00')
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

  it('cuando el documento es de Notas de Gemini, ignora el resumen y lee solo la transcripcion embebida', () => {
    // Reproduce, sin markdown (como llega el export text/plain real), la
    // forma de un documento "Notas de Gemini": Resumen/Decisiones/Detalles
    // ANTES del encabezado "Transcripcion", que aparece solo una vez y sin
    // "Asistentes". El texto de un Detalles con dos puntos ("Metodologia: X
    // explica que...") calzaria con RE_INTERVENCION si se colara al cuerpo —
    // por eso importa que se descarte entero, no solo el titulo.
    const NOTAS_GEMINI = `Las notas

ago 19, 2026

Alejandra Lancheros - Trappvel x MéTRIK

Invitado Mauricio Moreno contacto.trappvel@gmail.com

Resumen

Revisión de metodologías de trabajo.

Detalles

Metodología de trabajo: contacto trappvel explica que mantiene un Excel propio.

Transcripción

ago 19, 2026

Alejandra Lancheros - Trappvel x MéTRIK - Transcripción

00:00:06

contacto trappvel: Hola, Mauricio. ¿Me escuchas bien?

Mauricio Moreno: Alejandra, ¿cómo estás?

contacto trappvel: Bien, gracias.

00:01:16

Mauricio Moreno: Perfecto, empecemos.

La transcripción finalizó después de 01:29:41

Esta transcripción editable se generó por computadora y puede contener errores.
`
    const t = parseTranscripcion(NOTAS_GEMINI)
    expect(t.duracionSegundos).toBe(89 * 60 + 41)
    expect(t.vacia).toBe(false)
    expect(t.cuerpo).not.toContain('Metodología de trabajo')
    expect(t.cuerpo).not.toContain('Resumen')
    // Antes de la primera intervencion quedan la fecha y el titulo repetido
    // (la linea "Titulo - Transcripcion" que separa Notas del cuerpo real);
    // ninguna de las dos tiene el patron "Hablante: texto", asi que
    // alcance.ts las descarta igual al extraer intervenciones.
    expect(t.cuerpo).toContain('contacto trappvel: Hola, Mauricio. ¿Me escuchas bien?')
    const primeraLinea = t.cuerpo.split('\n')[0]
    expect(primeraLinea).not.toMatch(/^[^:\n]{2,60}:\s+\S/)
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


// Formato REAL que devuelve el export a text/plain (verificado contra
// "Daniela Gomez - Trappvel x MéTRIK", 2026-08-20, 105 KB, 1192 intervenciones).
// No trae markdown: los encabezados son lineas sueltas y las marcas de tiempo
// van solas. Este es el formato que ve el cron en produccion.
const PLANO = `\ufeffDaniela Gomez - Trappvel x MéTRIK
Asistentes
Comercial Trappvel, Mauricio Moreno
Transcripción
Comercial Trappvel: Aló.
Mauricio Moreno: ¿Cómo estás?
00:05:00
Comercial Trappvel: Bien, bien.
Mauricio Moreno: Qué bueno.
00:10:00
Mauricio Moreno: Chao.
La reunión finalizó después de 01:35:56 👋
Esta transcripción editable se generó automáticamente y puede contener errores.`

describe('parseTranscripcion sobre el export real de Drive', () => {
  it('lee titulo, asistentes y duracion sin markdown', () => {
    const t = parseTranscripcion(PLANO)
    expect(t.titulo).toBe('Daniela Gomez - Trappvel x MéTRIK')
    expect(t.asistentes).toEqual(['Comercial Trappvel', 'Mauricio Moreno'])
    expect(t.duracionSegundos).toBe(5756)
    expect(t.vacia).toBe(false)
  })

  it('no cuenta como vacia una reunion larga real', () => {
    const t = parseTranscripcion(PLANO)
    // 5756 s supera la hora: esta reunion si genera acta.
    expect(t.duracionSegundos!).toBeGreaterThan(3600)
  })

  it('el cuerpo excluye encabezados, marcas de tiempo, cierre y pie', () => {
    const t = parseTranscripcion(PLANO)
    expect(t.cuerpo).not.toContain('Asistentes')
    expect(t.cuerpo).not.toContain('00:05:00')
    expect(t.cuerpo).not.toContain('finalizó después de')
    expect(t.cuerpo).not.toContain('se generó automáticamente')
    expect(t.cuerpo.split('\n')).toHaveLength(5)
  })
})
