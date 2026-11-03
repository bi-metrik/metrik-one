import { ESQUEMA_BORRADOR, type BorradorCotizacion } from './borrador'
import type { Solicitud } from './a-propuesta'

/**
 * Una sola llamada: manual de la casa + solicitud + todos los pantallazos → borrador completo.
 * Mismo modelo que la bandeja (`bloqueo-leer.ts`): gemini-2.5-flash. A diferencia de la bandeja, que
 * lee un pantallazo por llamada y deja la estructura al formulario, aquí el modelo ve el caso entero.
 * La llave de pruebas (proyecto de Google nuevo) ya no tiene 2.5-flash: el piloto corre con
 * `MODELO_ASISTENTE` del entorno o, sin él, `gemini-3.8-flash`.
 */

export const MODELO_ASISTENTE = process.env.MODELO_ASISTENTE || 'gemini-3.8-flash'

const INSTRUCCIONES = `Eres el asistente de cotizaciones de una agencia de viajes. Armas el borrador de una cotización de paquete de bloqueo que una asesora va a revisar antes de enviarla.
Sigue el MANUAL DE LA CASA al pie de la letra. Lee los precios y datos exactamente como están en los pantallazos (los precios en pesos, enteros, sin puntos).
Todo lo que no puedas resolver con certeza va en "dudas" con lo que pusiste mientras tanto. No supongas en silencio.
En "cajaFoto" da la caja de la foto del hotel en el pantallazo como [ymin, xmin, ymax, xmax] normalizados a 0-1000.
Responde solo con el JSON del esquema.`

export interface UsoModelo {
  promptTokens: number
  salidaTokens: number
  pensamientoTokens: number
  totalTokens: number
}

export interface ResultadoArmado {
  borrador: BorradorCotizacion
  uso: UsoModelo
  ms: number
}

export async function armarBorrador(args: {
  manual: string
  solicitud: Solicitud
  pantallazos: { nombre: string; mime: string; base64: string }[]
  apiKey: string
  presupuestoPensamiento?: number
  timeoutMs?: number
}): Promise<ResultadoArmado> {
  const partes: unknown[] = [{ text: `SOLICITUD:\n${JSON.stringify(args.solicitud, null, 1)}` }]
  args.pantallazos.forEach((p, i) => {
    partes.push({ text: `Pantallazo ${i + 1} (${p.nombre}):` })
    partes.push({ inline_data: { mime_type: p.mime, data: p.base64 } })
  })
  const t0 = Date.now()
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_ASISTENTE}:generateContent`, {
    method: 'POST',
    signal: AbortSignal.timeout(args.timeoutMs ?? 180_000),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': args.apiKey },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: `${INSTRUCCIONES}\n\nMANUAL DE LA CASA:\n${args.manual}` }] },
      contents: [{ role: 'user', parts: partes }],
      generationConfig: {
        temperature: 0.1,
        maxOutputTokens: 16_384,
        responseMimeType: 'application/json',
        responseSchema: ESQUEMA_BORRADOR,
        thinkingConfig: { thinkingBudget: args.presupuestoPensamiento ?? 4096 },
      },
    }),
  })
  const ms = Date.now() - t0
  if (!res.ok) throw new Error(`Modelo ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const c = data.candidates?.[0]
  if (c?.finishReason && c.finishReason !== 'STOP') throw new Error(`El modelo terminó con ${c.finishReason}`)
  const texto: string = (c?.content?.parts ?? []).find((p: { thought?: boolean; text?: string }) => !p.thought && p.text)?.text ?? ''
  const u = data.usageMetadata ?? {}
  return {
    borrador: JSON.parse(texto) as BorradorCotizacion,
    uso: {
      promptTokens: u.promptTokenCount ?? 0,
      salidaTokens: u.candidatesTokenCount ?? 0,
      pensamientoTokens: u.thoughtsTokenCount ?? 0,
      totalTokens: u.totalTokenCount ?? 0,
    },
    ms,
  }
}
