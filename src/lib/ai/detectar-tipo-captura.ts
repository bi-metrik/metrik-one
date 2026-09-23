/**
 * ¿Qué componente del viaje muestra un pantallazo: un vuelo, un hotel, una actividad o un
 * traslado? (paso 1 del flujo de Noor, brief de captura del 2026-09-23).
 *
 * Existe para que la cotización tenga UNA sola zona de pegado: quien cotiza pega la captura
 * y ONE decide si es hotel o vuelo y crea la ranura con su nombre («Hotel en Cancún»). Antes
 * había que elegir primero «+ Hotel», que creaba una línea «HOTEL» vacía.
 *
 * ## Por qué es una llamada aparte y no la lectura completa
 *
 * La lectura pide un contrato distinto por tipo (`construirPrompt(ranura)`), así que para leer
 * hay que saber antes QUÉ se está leyendo. Leer con los cuatro contratos y quedarse con el que
 * pase costaría cuatro lecturas y cuatro esperas; esta pregunta es corta, no piensa casi nada
 * y devuelve también el lugar, que es lo que nombra la ranura.
 *
 * ## Lo que NO decide
 *
 * No acepta ni rechaza la captura: eso lo sigue haciendo la lectura, con su veredicto (un
 * listado, una grilla, una pantalla sin precio). Si esta llamada se equivoca de tipo, la
 * lectura con el contrato equivocado lo rechaza como «otra ranura» y la opción recién creada
 * se retira: el error cuesta una captura, no un dato mal guardado.
 *
 * La imagen no se persiste, igual que en la lectura.
 */

import { extraerConReintento, type ResultadoExtraccion } from './reintentar-extraccion'
import { esTipoRanura, type TipoRanura } from '@/lib/cotizaciones/ranuras-cotizacion'

const GEMINI_MODEL = 'gemini-2.5-flash'
/** Clasificar no necesita pensar mucho: el presupuesto bajo es lo que la hace rápida. */
const THINKING_BUDGET = 512
const MAX_OUTPUT_TOKENS = 4096
const TIMEOUT_MS = 20_000

const MIMES_SOPORTADOS: Record<string, string> = {
  'image/jpeg': 'image/jpeg',
  'image/jpg': 'image/jpeg',
  'image/png': 'image/png',
  'image/webp': 'image/webp',
}

export interface TipoDetectado {
  /** `null` = no es un componente de viaje reconocible (o es un paquete vuelo + hotel). */
  tipo: TipoRanura | null
  /** Hotel, actividad o traslado: dónde queda, tal como aparece. */
  lugar: string | null
  /** Vuelo: de dónde sale la ida y a dónde llega, tal como aparecen. */
  origen: string | null
  destino: string | null
}

export const PROMPT_DETECCION =
  'Eres el clasificador de capturas de pantalla de una agencia de viajes colombiana. La imagen es un ' +
  'pantallazo de un proveedor (aerolínea, Booking, Despegar, consolidador, operador turístico). Di qué ' +
  'componente del viaje cotiza, con UNA de estas palabras:\n' +
  '- vuelo: tiquetes aéreos. Se ve una aerolínea, una ruta (origen y destino, a veces con códigos de ' +
  'aeropuerto de tres letras), horarios o números de vuelo.\n' +
  '- hotel: alojamiento. Se ve el nombre de un hotel o resort, una habitación, fechas de entrada y salida ' +
  '(check-in, check-out) o un número de noches.\n' +
  '- actividad: un tour, una excursión, una entrada, una experiencia.\n' +
  '- traslado: transporte por tierra (aeropuerto a hotel, transfer, van privada).\n' +
  '- ninguno: no es la cotización de un componente de viaje, no se puede saber, o muestra un PAQUETE con ' +
  'vuelo y hotel juntos en un solo precio.\n\n' +
  'Además:\n' +
  '- lugar: para hotel, actividad o traslado, la ciudad o zona donde queda, tal como aparece en la ' +
  'pantalla. null si no aparece.\n' +
  '- origen y destino: solo para vuelo, la ciudad de salida y la de llegada de la IDA, tal como aparecen. ' +
  'null si no aparecen.\n' +
  'NUNCA inventes ni deduzcas lo que no está escrito en la imagen. Responde solo el JSON.'

const ESQUEMA = {
  type: 'OBJECT',
  properties: {
    tipo: { type: 'STRING', enum: ['vuelo', 'hotel', 'actividad', 'traslado', 'ninguno'] },
    lugar: { type: 'STRING', nullable: true },
    origen: { type: 'STRING', nullable: true },
    destino: { type: 'STRING', nullable: true },
  },
  required: ['tipo'],
}

/**
 * El esquema declara STRING y el modelo a veces devuelve la cadena «null» en vez de JSON null
 * (medido en la lectura de ranuras, `textoOVacio`). Esas cadenas no son un lugar.
 */
function textoOVacio(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  if (t === '' || /^(null|none|n\/a|ninguno|desconocido)$/i.test(t)) return null
  return t.length > 80 ? t.slice(0, 80) : t
}

/** De la respuesta cruda a lo que se usa. Puro, para probarlo sin el modelo. */
export function normalizarDeteccion(raw: unknown): TipoDetectado {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const tipoCrudo = typeof r.tipo === 'string' ? r.tipo.trim().toLowerCase() : ''
  const tipo = esTipoRanura(tipoCrudo) ? tipoCrudo : null
  return {
    tipo,
    lugar: tipo && tipo !== 'vuelo' ? textoOVacio(r.lugar) : null,
    origen: tipo === 'vuelo' ? textoOVacio(r.origen) : null,
    destino: tipo === 'vuelo' ? textoOVacio(r.destino) : null,
  }
}

async function unaLlamada(buffer: Buffer, mime: string, apiKey: string): Promise<ResultadoExtraccion<TipoDetectado>> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`
  try {
    const res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: PROMPT_DETECCION }] },
        contents: [{
          parts: [
            { text: '¿Qué componente del viaje muestra esta captura?' },
            { inline_data: { mime_type: mime, data: buffer.toString('base64') } },
          ],
        }],
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
    // R-P7: una respuesta cortada puede traer JSON que parsea. Solo vale un STOP.
    if (candidato?.finishReason && candidato.finishReason !== 'STOP') {
      return { data: null, error: `La detección terminó con motivo ${candidato.finishReason}` }
    }
    const partes = (candidato?.content?.parts ?? []) as { thought?: boolean; text?: string }[]
    const texto = partes.find(p => !p.thought && p.text?.trim().startsWith('{'))?.text ?? ''
    if (!texto) return { data: null, error: 'Gemini no devolvió respuesta' }
    return { data: normalizarDeteccion(JSON.parse(texto)) }
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return { data: null, error: 'La detección tardó demasiado' }
    }
    return { data: null, error: `Error detectando la captura: ${String(err).slice(0, 120)}` }
  }
}

/** Qué componente muestra la captura. Reintenta una vez ante un fallo transitorio. */
export async function detectarTipoDeCaptura(
  buffer: Buffer,
  mimeType: string,
  apiKey: string,
): Promise<ResultadoExtraccion<TipoDetectado>> {
  if (!apiKey) return { data: null, error: 'GEMINI_API_KEY no configurada en el servidor' }
  const mime = MIMES_SOPORTADOS[mimeType.toLowerCase()]
  if (!mime) return { data: null, error: `Tipo de imagen no soportado: ${mimeType}` }
  return extraerConReintento(() => unaLlamada(buffer, mime, apiKey), 'detectar-tipo')
}
