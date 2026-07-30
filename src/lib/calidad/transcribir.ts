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
        // OJO: los dos van DENTRO de `generationConfig`. Sueltos en la raiz del
        // cuerpo, la API responde 400 `Unknown name "maxOutputTokens": Cannot
        // find field` y la transcripcion no corre nunca. Paso: un cambio de
        // este tope se comio el `generationConfig` entero y llego a produccion.
        generationConfig: {
          // `temperature: 0` porque una transcripcion no se improvisa: el mismo
          // audio tiene que dar el mismo texto.
          temperature: 0,
          // 64.000 y no 32.768, PORQUE EL MODELO PIENSA Y SU PENSAMIENTO SE
          // COBRA DE AQUI. Medido sobre una llamada real de 40 minutos:
          // `thoughtsTokenCount` fue 14.862, o sea que de los 32.768 quedaban
          // ~18.000 para la transcripcion. Como el pensamiento varia entre
          // corridas, la MISMA entrada daba unas veces STOP y otras MAX_TOKENS.
          // Un tope que a veces alcanza no es un tope: es una moneda al aire.
          maxOutputTokens: 64_000,
        },
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

  /**
   * UNA TRANSCRIPCION A MEDIAS ES PEOR QUE NINGUNA, Y ANTES PASABA COMO BUENA.
   *
   * Aqui solo se miraba que el texto no viniera vacio. Cuando el modelo se
   * quedaba sin presupuesto de salida devolvia media llamada y `MAX_TOKENS`, y
   * esto lo daba por bueno: la auditoria corria sobre la mitad de la
   * conversacion y salia con su puntaje y su semaforo, con toda la pinta de ser
   * validos. El cierre de la llamada, que es donde viven las banderas de
   * cobro, simplemente no existia para el motor. Un falso verde perfecto.
   *
   * Cualquier final que no sea STOP significa que falta audio por transcribir,
   * asi que se cae ruidosamente. Es preferible que la pantalla diga que fallo.
   */
  if (c?.finishReason && c.finishReason !== 'STOP') {
    throw new Error(
      `La transcripción se cortó antes de terminar (${c.finishReason}). ` +
        `Se transcribieron ${texto.length.toLocaleString('es-CO')} caracteres, pero la llamada no llegó al final: ` +
        `auditar esto daría un resultado sobre media conversación. Sube un fragmento más corto.`,
    )
  }
  return {
    texto,
    turnos: texto.split('\n').filter((l) => /^\s*\[/.test(l)).length,
    ms: Date.now() - t,
  }
}
