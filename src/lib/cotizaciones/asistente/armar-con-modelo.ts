import { anthropic } from '@ai-sdk/anthropic'
import { generateText, jsonSchema, Output, type LanguageModel } from 'ai'

import { ESQUEMA_BORRADOR, ESQUEMA_BORRADOR_JSON, type BorradorCotizacion } from './borrador'
import type { Solicitud } from './a-propuesta'

/**
 * Una sola llamada: manual de la casa + solicitud + todos los pantallazos → borrador completo.
 *
 * Modelo (Mauricio, 2026-11-03, tras comparar en el piloto): `claude-haiku-5-5`. En los dos casos
 * reales sacó los totales exactos en 12 de 12 corridas, igual que `gemini-3.8-flash`, y cuesta entre
 * la mitad y un tercio (precios oficiales: platform.claude.com/docs/en/about-claude/pricing,
 * consultada el 2026-11-03). Va como el motor de tarifarios (`proveedores/motor.ts`): directo a
 * Anthropic si hay `ANTHROPIC_API_KEY`, si no por el AI Gateway con OIDC.
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
  /** En Claude incluye el razonamiento; en Gemini va aparte en `pensamientoTokens`. */
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
  /** Solo para Gemini. Claude toma `ANTHROPIC_API_KEY` del entorno o el gateway. */
  apiKey?: string
  presupuestoPensamiento?: number
  timeoutMs?: number
}

export function armarBorrador(args: Args): Promise<ResultadoArmado> {
  return MODELO_ASISTENTE.startsWith('gemini') ? armarConGemini(args) : armarConClaude(args)
}

/** Directo a Anthropic si hay llave; si no, el gateway (`claude-haiku-5-5` → `anthropic/claude-haiku-5.5`). */
function modeloClaude(entorno: Record<string, string | undefined> = process.env): LanguageModel {
  return entorno.ANTHROPIC_API_KEY?.trim()
    ? anthropic(MODELO_ASISTENTE)
    : `anthropic/${MODELO_ASISTENTE.replace(/-(\d+)-(\d+)$/, '-$1.$2')}`
}

async function armarConClaude(args: Args): Promise<ResultadoArmado> {
  const modelo = modeloClaude()
  const t0 = Date.now()
  const r = await generateText({
    model: modelo,
    instructions: sistemaDelAsistente(args.manual),
    output: Output.object({ schema: jsonSchema<BorradorCotizacion>(ESQUEMA_BORRADOR_JSON) }),
    maxOutputTokens: 32_000,
    maxRetries: 1,
    abortSignal: AbortSignal.timeout(args.timeoutMs ?? 300_000),
    messages: [{
      role: 'user',
      content: partesDelCaso(args.solicitud, args.pantallazos).map(p =>
        'texto' in p
          ? { type: 'text' as const, text: p.texto }
          : { type: 'file' as const, data: p.imagen.base64, mediaType: p.imagen.mime, filename: p.imagen.nombre }),
    }],
  })
  const ms = Date.now() - t0
  if (r.finishReason !== 'stop') throw new Error(`El modelo terminó con ${r.finishReason}`)
  const u = r.usage
  return {
    borrador: r.output,
    uso: {
      promptTokens: u.inputTokens ?? 0,
      salidaTokens: u.outputTokens ?? 0,
      pensamientoTokens: 0,
      totalTokens: u.totalTokens ?? 0,
    },
    ms,
    modelo: r.response?.modelId || MODELO_ASISTENTE,
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
