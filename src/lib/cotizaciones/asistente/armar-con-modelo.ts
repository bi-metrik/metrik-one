import { ESQUEMA_BORRADOR, ESQUEMA_BORRADOR_JSON, type BorradorCotizacion } from './borrador'
import type { Solicitud } from './a-propuesta'

/**
 * Una sola llamada: manual de la casa + solicitud + todos los pantallazos → borrador completo.
 *
 * Modelo (Mauricio, 2026-11-03, tras comparar en el piloto): `claude-haiku-5-5`. En los dos casos
 * reales sacó los totales exactos en 12 de 12 corridas, igual que `gemini-3.8-flash`, y cuesta entre
 * la mitad y un tercio (precios oficiales: platform.claude.com/docs/en/about-claude/pricing,
 * consultada el 2026-11-03). Pide `ANTHROPIC_API_KEY`: no pasa por el AI Gateway (ver `armarConClaude`).
 * Gemini sigue disponible con `MODELO_ASISTENTE=gemini-…` y la llave de Gemini.
 */

export const MODELO_ASISTENTE = process.env.MODELO_ASISTENTE || 'claude-haiku-5-5'

const INSTRUCCIONES = `Eres el asistente de cotizaciones de una agencia de viajes. Armas el borrador de una cotización de paquete de bloqueo que una asesora va a revisar antes de enviarla.
Sigue el MANUAL DE LA CASA al pie de la letra. Lee los precios y datos exactamente como están en los pantallazos (los precios en pesos, enteros, sin puntos).
Todo lo que no puedas resolver con certeza va en "dudas" con lo que pusiste mientras tanto. No supongas en silencio.
En "cajaFoto" da la caja de la foto del hotel en el pantallazo como [ymin, xmin, ymax, xmax] normalizados a 0-1000.
Responde solo con el JSON del esquema.`

/** Las instrucciones de sistema: las mismas para cualquier modelo. */
export function sistemaDelAsistente(manual: string): string {
  return `${INSTRUCCIONES}\n\nMANUAL DE LA CASA:\n${manual}`
}

export interface Pantallazo {
  nombre: string
  mime: string
  base64: string
}

/** El mensaje del usuario en orden: la solicitud y cada pantallazo con su rótulo. */
export function partesDelCaso(solicitud: Solicitud, pantallazos: Pantallazo[]): ({ texto: string } | { imagen: Pantallazo })[] {
  return [
    { texto: `SOLICITUD:\n${JSON.stringify(solicitud, null, 1)}` },
    ...pantallazos.flatMap((p, i) => [{ texto: `Pantallazo ${i + 1} (${p.nombre}):` }, { imagen: p }]),
  ]
}

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
  modelo: string
}

interface Args {
  manual: string
  solicitud: Solicitud
  pantallazos: Pantallazo[]
  /** Solo para Gemini. Claude toma `ANTHROPIC_API_KEY` del entorno. */
  apiKey?: string
  presupuestoPensamiento?: number
  timeoutMs?: number
}

export function armarBorrador(args: Args): Promise<ResultadoArmado> {
  return MODELO_ASISTENTE.startsWith('gemini') ? armarConGemini(args) : armarConClaude(args)
}

/**
 * Claude por la API de Mensajes, directo (sin AI SDK ni gateway). Dos cosas medidas en el piloto
 * (2026-11-03) obligan a esta forma:
 * - El esquema entero no cabe en la salida estricta (`output_config.format`): «The compiled grammar
 *   is too large» (400), aun sin patrones, nulos ni enums. Va como herramienta no estricta.
 * - Sin razonamiento, Haiku invirtió Económica y Recomendada en San Andrés en 3 de 3 corridas (los
 *   totales cuadraban y solo salió un aviso). Con `@ai-sdk/anthropic` y la herramienta forzada, el
 *   modelo no razonó ni con `effort: 'high'`. Aquí: razonamiento adaptativo + `tool_choice: auto` y
 *   se exige que la respuesta termine en la herramienta.
 */
async function armarConClaude(args: Args): Promise<ResultadoArmado> {
  const llave = process.env.ANTHROPIC_API_KEY?.trim()
  if (!llave) throw new Error('Falta ANTHROPIC_API_KEY')
  const content = partesDelCaso(args.solicitud, args.pantallazos).map(p =>
    'texto' in p
      ? { type: 'text', text: p.texto }
      : { type: 'image', source: { type: 'base64', media_type: p.imagen.mime, data: p.imagen.base64 } })
  const t0 = Date.now()
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    signal: AbortSignal.timeout(args.timeoutMs ?? 300_000),
    headers: { 'content-type': 'application/json', 'x-api-key': llave, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: MODELO_ASISTENTE,
      max_tokens: 32_000,
      system: sistemaDelAsistente(args.manual),
      messages: [{ role: 'user', content }],
      tools: [{ name: 'entregar_borrador', description: 'Entrega el borrador final de la cotización.', input_schema: ESQUEMA_BORRADOR_JSON }],
      tool_choice: { type: 'auto' },
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
    }),
  })
  const ms = Date.now() - t0
  if (!res.ok) throw new Error(`Modelo ${res.status}: ${(await res.text()).slice(0, 300)}`)
  const data = await res.json()
  const entrega = (data.content ?? []).find((b: { type: string; name?: string }) => b.type === 'tool_use' && b.name === 'entregar_borrador')
  if (!entrega) throw new Error(`El modelo no entregó el borrador (terminó con ${data.stop_reason})`)
  const u = data.usage ?? {}
  const pensamiento = u.output_tokens_details?.thinking_tokens ?? 0
  return {
    borrador: entrega.input as BorradorCotizacion,
    uso: {
      promptTokens: (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
      salidaTokens: (u.output_tokens ?? 0) - pensamiento,
      pensamientoTokens: pensamiento,
      totalTokens: (u.input_tokens ?? 0) + (u.output_tokens ?? 0),
    },
    ms,
    modelo: data.model ?? MODELO_ASISTENTE,
  }
}

async function armarConGemini(args: Args): Promise<ResultadoArmado> {
  if (!args.apiKey) throw new Error('Falta la llave de Gemini')
  const partes = partesDelCaso(args.solicitud, args.pantallazos).map(p =>
    'texto' in p ? { text: p.texto } : { inline_data: { mime_type: p.imagen.mime, data: p.imagen.base64 } })
  const t0 = Date.now()
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODELO_ASISTENTE}:generateContent`, {
    method: 'POST',
    signal: AbortSignal.timeout(args.timeoutMs ?? 180_000),
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': args.apiKey },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: sistemaDelAsistente(args.manual) }] },
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
    modelo: MODELO_ASISTENTE,
  }
}
