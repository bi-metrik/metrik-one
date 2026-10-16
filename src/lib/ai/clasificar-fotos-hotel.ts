/**
 * ¿Qué muestra cada foto candidata de un hotel: la fachada, una habitación, una zona común, o no
 * es un hotel? (Mauricio, 2026-10-16: «elegir por categoría», y fuera los monumentos, parques y
 * calles que la búsqueda de Commons traía como «foto del hotel»).
 *
 * Mismo modelo que lee las capturas de la cotización (`detectar-tipo-captura.ts`,
 * `gemini-2.5-flash`), con poco pensamiento: clasificar no razona mucho. Varias fotos van en UNA
 * llamada (hasta `FOTOS_POR_LLAMADA`), cada una precedida de su número; la respuesta es una lista
 * `{ n, categoria }`. Una foto que el modelo no nombró queda SIN clasificar (`null`): quien llama
 * decide (nunca se cuenta como «es un hotel» ni como «no lo es»).
 *
 * Las imágenes no se guardan.
 */
import { extraerConReintento, type ResultadoExtraccion } from './reintentar-extraccion'
import type { Clasificacion } from '@/lib/fotos/categoria'

export const MODELO_CLASIFICADOR_FOTOS = 'gemini-2.5-flash'
const THINKING_BUDGET = 256
const MAX_OUTPUT_TOKENS = 2048
const TIMEOUT_MS = 25_000
export const FOTOS_POR_LLAMADA = 12

const CLASES: readonly Clasificacion[] = ['fachada', 'habitacion', 'zonas_comunes', 'no_es_hotel']

export const PROMPT_CLASIFICADOR =
  'Eres el editor de fotos de una agencia de viajes colombiana. Vas a ver fotos numeradas que podrían ' +
  'ser de un hotel. Para CADA foto di qué muestra, con UNA de estas palabras:\n' +
  '- fachada: el hotel por fuera. El edificio del hotel es el sujeto principal (su fachada, su entrada, ' +
  'el edificio visto desde la calle, desde el aire o desde la playa).\n' +
  '- habitacion: un cuarto de hotel por dentro: la cama, la suite, el baño o el balcón de la habitación.\n' +
  '- zonas_comunes: un espacio del hotel que usan todos los huéspedes: lobby, recepción, restaurante, bar, ' +
  'desayuno, piscina, terraza, spa, gimnasio, salones, jardín del hotel.\n' +
  '- no_es_hotel: no es una foto de un hotel. Un monumento, una torre, una iglesia, un parque, una calle o ' +
  'una plaza donde ningún edificio de hotel es el sujeto, una vista de la ciudad, un mapa, un plano, un ' +
  'logo, un documento, un retrato de una persona, un evento donde no se ve el hotel, comida suelta, un ' +
  'vehículo.\n' +
  'Si dudas entre fachada y no_es_hotel, elige no_es_hotel: es mejor perder una foto que mostrar una ' +
  'equivocada. NUNCA inventes. Responde solo el JSON, con una entrada por foto.'

const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    fotos: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          n: { type: 'INTEGER' },
          categoria: { type: 'STRING', enum: [...CLASES] },
        },
        required: ['n', 'categoria'],
        propertyOrdering: ['n', 'categoria'],
      },
    },
  },
  required: ['fotos'],
}

const MIMES: Record<string, string> = { 'image/jpeg': 'image/jpeg', 'image/jpg': 'image/jpeg', 'image/png': 'image/png', 'image/webp': 'image/webp' }

export interface FotoAClasificar {
  bytes: Buffer
  mime: string
}

/**
 * De la respuesta cruda a una clasificación por foto (en el orden en que se mandaron). Puro.
 * Números fuera de rango, repetidos o categorías desconocidas se ignoran: esa foto queda `null`.
 */
export function normalizarClasificacion(raw: unknown, cuantas: number): (Clasificacion | null)[] {
  const salida: (Clasificacion | null)[] = Array.from({ length: cuantas }, () => null)
  const lista = (raw && typeof raw === 'object' ? (raw as { fotos?: unknown }).fotos : null) ?? []
  if (!Array.isArray(lista)) return salida
  const vistos = new Set<number>()
  for (const x of lista) {
    const n = typeof x?.n === 'number' ? x.n : Number.NaN
    const c = typeof x?.categoria === 'string' ? x.categoria.trim().toLowerCase() : ''
    if (!Number.isInteger(n) || n < 1 || n > cuantas || vistos.has(n)) continue
    vistos.add(n)
    if ((CLASES as readonly string[]).includes(c)) salida[n - 1] = c as Clasificacion
  }
  return salida
}

async function unaLlamada(
  fotos: FotoAClasificar[],
  apiKey: string,
  contexto: string,
  f: typeof fetch,
): Promise<ResultadoExtraccion<(Clasificacion | null)[]>> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODELO_CLASIFICADOR_FOTOS}:generateContent?key=${apiKey}`
  const partes: unknown[] = [{ text: `${contexto}\nHay ${fotos.length} fotos.` }]
  fotos.forEach((foto, i) => {
    partes.push({ text: `Foto ${i + 1}:` })
    partes.push({ inline_data: { mime_type: foto.mime, data: foto.bytes.toString('base64') } })
  })
  try {
    const res = await f(url, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: PROMPT_CLASIFICADOR }] },
        contents: [{ parts: partes }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: MAX_OUTPUT_TOKENS,
          responseMimeType: 'application/json',
          responseSchema: ESQUEMA,
          thinkingConfig: { thinkingBudget: THINKING_BUDGET },
        },
      }),
    })
    if (!res.ok) return { data: null, error: `Error de Gemini (${res.status})` }
    const data = await res.json()
    if (data.promptFeedback?.blockReason) return { data: null, error: `Contenido bloqueado por Gemini: ${data.promptFeedback.blockReason}` }
    const candidato = data.candidates?.[0]
    if (candidato?.finishReason && candidato.finishReason !== 'STOP') return { data: null, error: `La clasificación terminó con motivo ${candidato.finishReason}` }
    const texto = ((candidato?.content?.parts ?? []) as { thought?: boolean; text?: string }[]).find((p) => !p.thought && p.text?.trim().startsWith('{'))?.text
    if (!texto) return { data: null, error: 'Gemini no devolvió respuesta' }
    return { data: normalizarClasificacion(JSON.parse(texto), fotos.length) }
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) return { data: null, error: 'La clasificación tardó demasiado' }
    return { data: null, error: `Error clasificando fotos: ${String(err).slice(0, 120)}` }
  }
}

/**
 * Clasifica las fotos, de a `FOTOS_POR_LLAMADA` por llamada (las tandas van en paralelo). Sin
 * llave, con un formato que el modelo no lee, o si la llamada falla dos veces, esas fotos quedan
 * `null`. Nunca lanza.
 */
export async function clasificarFotosDeHotel(
  fotos: FotoAClasificar[],
  a: { apiKey: string | undefined; hotel: string; ciudad: string | null; fetch?: typeof fetch },
): Promise<(Clasificacion | null)[]> {
  const salida: (Clasificacion | null)[] = Array.from({ length: fotos.length }, () => null)
  if (!a.apiKey || fotos.length === 0) return salida
  const contexto = `Las fotos se buscaron para el hotel «${a.hotel}»${a.ciudad ? ` en ${a.ciudad}` : ''}. No juzgues si es ese hotel: solo qué muestra cada foto.`
  const validas = fotos.map((foto, i) => ({ i, foto: { bytes: foto.bytes, mime: MIMES[foto.mime.toLowerCase()] ?? '' } })).filter((x) => x.foto.mime && x.foto.bytes.length > 0)
  const tandas: (typeof validas)[] = []
  for (let k = 0; k < validas.length; k += FOTOS_POR_LLAMADA) tandas.push(validas.slice(k, k + FOTOS_POR_LLAMADA))
  await Promise.all(
    tandas.map(async (tanda) => {
      const r = await extraerConReintento(() => unaLlamada(tanda.map((x) => x.foto), a.apiKey as string, contexto, a.fetch ?? fetch), 'clasificar-fotos-hotel')
      if (!r.data) {
        console.warn('[clasificar-fotos-hotel] sin clasificar:', r.error)
        return
      }
      r.data.forEach((c, j) => {
        salida[tanda[j].i] = c
      })
    }),
  )
  return salida
}
