import 'server-only'
import { MODELO_AUDITORIA } from './motor-auditoria'

/**
 * Tope de duracion del audio.
 *
 * LOS 60 SEGUNDOS NO APLICAN A ESTE PROYECTO. La tabla del plan Hobby dice 60,
 * pero eso rige para proyectos anteriores a abril de 2025 sin Fluid compute;
 * este lo tiene activo y su presupuesto por funcion es de 300 s. Lo di por
 * cierto sin verificarlo y estuve a punto de recortar el producto a la mitad
 * por un limite que no existia aqui.
 *
 * Con 300 s el reloj deja de mandar y vuelve a mandar el peso, que era el
 * criterio original: 20 minutos pesan 4,6 MB y caben en una sola peticion.
 * Medido: 8 min → 25 s, 12 min → 56 s, 20 min → 81 s. Sobra margen.
 *
 * El tope se avisa ANTES de procesar, no a mitad de la barra: un cliente
 * esperando un minuto para que le digan que no, es peor que un rechazo
 * inmediato.
 */
export const MAX_MINUTOS_AUDIO = 20

/** Margen de tolerancia: nadie recorta un audio al segundo exacto. */
export const TOLERANCIA_SEG = 30

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
