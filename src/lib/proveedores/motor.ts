/**
 * El motor de extracción de tarifarios dentro de ONE (Mauricio, 2026-10-19, punto 6): manda TODOS
 * los archivos de un proveedor (los tarifarios; las certificaciones bancarias viven en otra tabla y
 * no viajan) en UNA llamada al modelo, con la instrucción vigente, y revisa la salida con
 * `revisarExtraccion` antes de que nadie la guarde.
 *
 * El modelo (Mauricio, 2026-10-19, tras el rechazo «Free tier users do not have access to this
 * model» del AI Gateway): con `ANTHROPIC_API_KEY` en el entorno va DIRECTO a la API de Anthropic con
 * `@ai-sdk/anthropic` (`claude-haiku-5-5`, id de la tabla oficial «Models overview»,
 * https://platform.claude.com/docs/en/about-claude/models/overview, consultada el 2026-10-19: ventana
 * de 1 M, salida de hasta 128 k, lee PDF e imagen). Sin la variable cae al gateway como antes
 * (`anthropic/claude-haiku-5.5`, autenticado con OIDC en Vercel).
 *
 * Las pruebas le pasan un modelo simulado (`MockLanguageModelV4` de `ai/test`): nunca llaman al de
 * verdad.
 */
import { anthropic } from '@ai-sdk/anthropic'
import { generateText, type LanguageModel } from 'ai'

import { revisarExtraccion, type ExtraccionRevisada } from './extraccion'

/** El id en la API de Anthropic (llamada directa). */
export const MODELO_ANTHROPIC = 'claude-haiku-5-5'
/** El id en el AI Gateway de Vercel (respaldo cuando no hay `ANTHROPIC_API_KEY`). */
export const MODELO_EXTRACCION = 'anthropic/claude-haiku-5.5'

/** El modelo de cada corrida: directo a Anthropic si hay llave; si no, el gateway. */
export function modeloDeExtraccion(entorno: Record<string, string | undefined> = process.env): LanguageModel {
  return entorno.ANTHROPIC_API_KEY?.trim() ? anthropic(MODELO_ANTHROPIC) : MODELO_EXTRACCION
}

/**
 * Lo que se manda por corrida. La API de Mensajes de Anthropic recibe hasta 32 MB por petición
 * (413 `request_too_large` si se pasa) y hasta 600 páginas de PDF con ventana de 1 M (doc oficial
 * «PDF support» y «API overview › Request size limits», consultadas el 2026-10-19). Los archivos
 * viajan en base64 (un tercio más): 24 MB de archivos es el techo seguro. Las páginas no se cuentan
 * aquí: si se pasan, la API lo rechaza y el error sale en llano.
 */
export const BYTES_MAXIMOS_CORRIDA = 24_000_000
/** La salida más larga que se pide. Un tarifario de cadena grande puede no caber: sale «cortada». */
export const TOKENS_MAXIMOS_SALIDA = 64_000
/**
 * Lo que espera al modelo antes de rendirse. La página de la ficha tiene `maxDuration = 800` (el tope
 * del plan Pro de Vercel): 12 minutos dejan margen para bajar los archivos y guardar, y así una
 * corrida larga termina con «tiempo agotado» en pantalla en vez de que Vercel mate la función.
 */
const MS_MAXIMOS_MODELO = 720_000

export interface ArchivoParaMotor {
  nombre: string
  mime: string
  datos: Uint8Array
}

export type ResultadoMotor =
  | { ok: true; extraccion: ExtraccionRevisada; modelo: string }
  | { ok: false; error: string; errores?: string[] }

/** El JSON de la respuesta del modelo, sin cercas de código ni texto alrededor. */
export function jsonDeRespuesta(texto: string): string | null {
  const sinCerca = texto.replace(/```(?:json)?/gi, '')
  const i = sinCerca.indexOf('{')
  const j = sinCerca.lastIndexOf('}')
  return i >= 0 && j > i ? sinCerca.slice(i, j + 1) : null
}

const idDe = (m: LanguageModel): string => (typeof m === 'string' ? m : m.modelId)

interface FalloDelModelo {
  name?: unknown
  message?: unknown
  statusCode?: unknown
  responseBody?: unknown
  lastError?: unknown
  cause?: unknown
}

/**
 * El fallo del modelo en llano. Lee el código HTTP y el texto del error del proveedor (Anthropic
 * directo o el gateway; tras un reintento el SDK lo envuelve en `RetryError.lastError`). Nunca
 * muestra el texto crudo del proveedor: solo lo clasifica.
 */
export function mensajeDeFalloDelModelo(e: unknown): string {
  let f = (e ?? {}) as FalloDelModelo
  for (let i = 0; i < 3 && f && typeof f === 'object' && f.lastError && typeof f.lastError === 'object'; i++) f = f.lastError as FalloDelModelo
  const estado = typeof f.statusCode === 'number' ? f.statusCode : null
  const texto = [f.name, f.message, f.responseBody, (f.cause as FalloDelModelo | undefined)?.name, (f.cause as FalloDelModelo | undefined)?.message]
    .filter((x): x is string => typeof x === 'string')
    .join(' ')
    .toLowerCase()
  if (/aborterror|timeouterror|timed? ?out|timeout_error|aborted/.test(texto) || estado === 408 || estado === 504) {
    return 'El motor tardó demasiado y se cortó (tiempo agotado). Vuelve a intentarlo; si se repite, quita los tarifarios que estén reemplazados.'
  }
  // Antes que el saldo: el rechazo del gateway («Free tier users do not have access…») trae un enlace de «top-up».
  if (estado === 403 || /do not have access|does not have access|not have permission|permission_error|free tier/.test(texto)) {
    return 'La cuenta del motor no tiene acceso a este modelo. Hay que revisar la cuenta antes de volver a intentarlo.'
  }
  if (estado === 402 || /credit balance|billing|insufficient (funds|credits)|top-up|spend (limit|cap)/.test(texto)) {
    return 'El motor no tiene saldo: la cuenta del modelo se quedó sin créditos. Hay que recargarla antes de volver a intentarlo.'
  }
  if (estado === 401 || /authentication_error|invalid x-api-key|api key|unauthorized/.test(texto)) {
    return 'La llave del motor no es válida o no está configurada. Hay que revisarla antes de volver a intentarlo.'
  }
  if (estado === 413 || /request_too_large|too large|too many pages|maximum of \d+ pdf pages/.test(texto)) {
    return 'Los tarifarios son demasiado grandes para una sola corrida (peso o páginas). Quita los que estén reemplazados.'
  }
  if (estado === 429 || /rate_limit/.test(texto)) {
    return 'El motor llegó a su límite de uso por ahora. Vuelve a intentarlo en unos minutos.'
  }
  if (estado === 529 || estado === 503 || /overloaded/.test(texto)) {
    return 'El servicio del modelo está saturado en este momento. Vuelve a intentarlo en unos minutos.'
  }
  return 'El motor no respondió. Vuelve a intentarlo en un rato.'
}

export async function correrMotor(p: {
  archivos: readonly ArchivoParaMotor[]
  instruccion: string
  hoy: string
  modelo?: LanguageModel
  senal?: AbortSignal
  /** Solo para pruebas: el tope de espera al modelo. */
  msMaximos?: number
}): Promise<ResultadoMotor> {
  const modelo = p.modelo ?? modeloDeExtraccion()
  if (p.archivos.length === 0) return { ok: false, error: 'Este proveedor no tiene tarifarios con archivo: sube al menos uno.' }
  const bytes = p.archivos.reduce((s, a) => s + a.datos.byteLength, 0)
  if (bytes > BYTES_MAXIMOS_CORRIDA) {
    return { ok: false, error: `Los tarifarios pesan ${(bytes / 1e6).toFixed(1)} MB y el motor recibe hasta ${BYTES_MAXIMOS_CORRIDA / 1e6} MB por corrida. Quita los que estén reemplazados.` }
  }
  const lista = p.archivos.map((a, i) => `${i + 1}. ${a.nombre}`).join('\n')
  let texto: string
  let fin: string
  let usado: string
  const tope = AbortSignal.timeout(p.msMaximos ?? MS_MAXIMOS_MODELO)
  try {
    const r = await generateText({
      model: modelo,
      instructions: p.instruccion,
      maxOutputTokens: TOKENS_MAXIMOS_SALIDA,
      // Un reintento como mucho: cada corrida cuesta y un tiempo agotado puede haber cobrado.
      maxRetries: 1,
      abortSignal: p.senal ? AbortSignal.any([p.senal, tope]) : tope,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: `Archivos del proveedor (${p.archivos.length}), en este orden:\n${lista}\n\nDevuelve SOLO el JSON del esquema.` },
            ...p.archivos.map((a) => ({ type: 'file' as const, data: a.datos, mediaType: a.mime, filename: a.nombre })),
          ],
        },
      ],
    })
    texto = r.text
    fin = r.finishReason
    usado = r.response?.modelId || idDe(modelo)
  } catch (e) {
    console.error(`[motor-extraccion] el modelo falló (${idDe(modelo)}):`, e instanceof Error ? e.message : e)
    return { ok: false, error: mensajeDeFalloDelModelo(e) }
  }
  if (fin === 'length') return { ok: false, error: 'La extracción salió cortada: el tarifario es más largo de lo que el motor alcanza a escribir en una corrida.' }
  const json = jsonDeRespuesta(texto)
  if (!json) return { ok: false, error: 'El motor no devolvió un JSON.' }
  const revisada = revisarExtraccion(json, { hoy: p.hoy })
  if (!revisada.ok) return { ok: false, error: `El motor devolvió una extracción con errores: ${revisada.error}`, errores: revisada.errores }
  return { ok: true, extraccion: revisada.extraccion, modelo: usado }
}
