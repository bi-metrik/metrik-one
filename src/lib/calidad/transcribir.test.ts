/**
 * Que el cuerpo que se le manda a Gemini tenga la FORMA que Gemini espera.
 *
 * POR QUE EXISTE ESTE ARCHIVO. Un cambio del tope de tokens se comio el
 * `generationConfig` entero y dejo `maxOutputTokens` suelto en la raiz del
 * cuerpo. La API responde `400 Unknown name "maxOutputTokens": Cannot find
 * field` y la transcripcion no corre NUNCA. Llego a produccion.
 *
 * No lo atrapo nada de lo que habia: el typecheck pasa (es un objeto con una
 * propiedad de mas), el lint pasa, y las pruebas manuales que se corrieron
 * construian el cuerpo A MANO para llamar a la API, en vez de llamar a esta
 * funcion. O sea que probaban la API de Google, no nuestro codigo. Un audio de
 * 25 minutos "paso" mientras la aplicacion estaba rota.
 *
 * La leccion, y el motivo de que esto sea un test y no una nota: una prueba que
 * no pasa por el codigo que se va a desplegar no prueba ese codigo.
 */
import { describe, expect, it, vi, afterEach } from 'vitest'

vi.mock('server-only', () => ({}))

const { transcribirAudio } = await import('./transcribir')

/** Captura el cuerpo de la unica llamada a fetch y devuelve algo valido. */
function espiarFetch(respuesta: unknown = { candidates: [{ content: { parts: [{ text: '[00:00:01] AGENTE: hola' }] }, finishReason: 'STOP' }] }) {
  const espia = vi.fn(async () => ({
    ok: true,
    json: async () => respuesta,
    text: async () => JSON.stringify(respuesta),
  }))
  vi.stubGlobal('fetch', espia)
  return espia
}

function cuerpoDe(espia: ReturnType<typeof espiarFetch>) {
  const init = (espia.mock.calls[0] as unknown as [string, { body: string }])[1]
  return JSON.parse(init.body) as Record<string, unknown>
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('el cuerpo de la peticion de transcripcion', () => {
  it('mete temperature y maxOutputTokens DENTRO de generationConfig, no en la raiz', async () => {
    const espia = espiarFetch()
    await transcribirAudio(Buffer.from('audio'), 'audio/mpeg', 'clave-falsa')

    const cuerpo = cuerpoDe(espia)

    // Esto es exactamente lo que fallo: los campos sueltos arriba.
    expect(cuerpo.maxOutputTokens).toBeUndefined()
    expect(cuerpo.temperature).toBeUndefined()

    expect(cuerpo.generationConfig).toEqual({
      temperature: 0,
      maxOutputTokens: 64_000,
    })
  })

  it('no manda ninguna clave desconocida en la raiz del cuerpo', async () => {
    const espia = espiarFetch()
    await transcribirAudio(Buffer.from('audio'), 'audio/mpeg', 'clave-falsa')

    // La API rechaza el request entero con 400 ante cualquier campo que no
    // conozca, asi que la lista blanca es la defensa correcta: si alguien
    // agrega una opcion nueva, que este test le recuerde donde va.
    expect(Object.keys(cuerpoDe(espia)).sort()).toEqual(['contents', 'generationConfig'])
  })

  it('manda el audio como inline_data con su mime type', async () => {
    const espia = espiarFetch()
    await transcribirAudio(Buffer.from('hola'), 'audio/mp4', 'clave-falsa')

    const partes = (cuerpoDe(espia).contents as { parts: Record<string, unknown>[] }[])[0].parts
    expect(partes[1].inline_data).toEqual({
      mime_type: 'audio/mp4',
      data: Buffer.from('hola').toString('base64'),
    })
  })

  it('se cae cuando el modelo corta antes de terminar, en vez de dar media llamada por buena', async () => {
    espiarFetch({
      candidates: [{ content: { parts: [{ text: '[00:00:01] AGENTE: media llamada' }] }, finishReason: 'MAX_TOKENS' }],
    })

    // Media transcripcion auditada como si fuera entera sale en verde y sin el
    // cierre, que es donde viven las banderas de cobro.
    await expect(transcribirAudio(Buffer.from('audio'), 'audio/mpeg', 'clave-falsa')).rejects.toThrow(
      /se cortó antes de terminar/i,
    )
  })

  it('acepta la transcripcion cuando el modelo termina por STOP', async () => {
    espiarFetch()
    const t = await transcribirAudio(Buffer.from('audio'), 'audio/mpeg', 'clave-falsa')
    expect(t.texto).toContain('AGENTE')
    expect(t.turnos).toBe(1)
  })
})
