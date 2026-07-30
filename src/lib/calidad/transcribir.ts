import 'server-only'
import { MODELO_AUDITORIA } from './motor-auditoria'

/**
 * El tope del audio vive en `./tope-audio`, sin `server-only`, porque el
 * navegador tambien lo importa: es el que rechaza el archivo ANTES de subirlo
 * y le da al usuario un mensaje escrito por nosotros en vez de un fallo seco.
 *
 * (La razon original era otra: la plataforma cortaba el cuerpo de la peticion
 * antes de que este archivo llegara a ejecutarse. Eso dejo de aplicar cuando el
 * audio salio del cuerpo y paso a subirse directo a Storage.)
 */

/**
 * Instruccion de transcripcion.
 *
 * Prohibe el preambulo de forma explicita: un "Aquí tienes la transcripción..."
 * al inicio corre todas las marcas de tiempo y rompe las citas de la auditoria.
 * Con 3.1 Pro pasaba; Flash arranca limpio, pero la instruccion se queda porque
 * el modelo puede cambiar.
 */
export const PROMPT_TRANSCRIPCION = `Transcribe este audio de una llamada telefónica de venta.

Formato de salida, una línea por turno y NADA MÁS:
[HH:MM:SS] AGENTE: texto
[HH:MM:SS] CLIENTE: texto

Reglas:
- Empieza directamente con el primer turno. Sin preámbulo, sin título, sin explicaciones.
- La marca de tiempo es el segundo en que EMPIEZA ese turno, medido desde el inicio del audio.
- AGENTE es quien representa a la empresa; CLIENTE es la otra persona.
- Transcribe literal, incluidas muletillas y repeticiones. No resumas ni corrijas la gramática.
- Si alguien dicta números, transcríbelos tal como se dicen.
- Si un tramo es inaudible, escribe [inaudible] en su lugar.`

export interface Transcripcion {
  texto: string
  turnos: number
  ms: number
}

export async function transcribirAudio(
  audio: Buffer,
  mimeType: string,
  apiKey: string,
): Promise<Transcripcion> {
  const t = Date.now()
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_AUDITORIA}:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: PROMPT_TRANSCRIPCION },
              { inline_data: { mime_type: mimeType, data: audio.toString('base64') } },
            ],
          },
        ],
        generationConfig: { temperature: 0, maxOutputTokens: 32768 },
      }),
    },
  )
  if (!res.ok) {
    throw new Error(`La transcripción falló (${res.status}). ${(await res.text()).slice(0, 160)}`)
  }
  const j = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[]
  }
  const c = j.candidates?.[0]
  const texto = c?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
  if (!texto.trim()) {
    throw new Error(`La transcripción volvió vacía (${c?.finishReason ?? 'sin razón'}).`)
  }
  return {
    texto,
    turnos: texto.split('\n').filter((l) => /^\s*\[/.test(l)).length,
    ms: Date.now() - t,
  }
}
