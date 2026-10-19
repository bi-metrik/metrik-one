/**
 * El motor de extracción de tarifarios dentro de ONE (Mauricio, 2026-10-19, punto 6): manda TODOS
 * los archivos de un proveedor (los tarifarios; las certificaciones bancarias viven en otra tabla y
 * no viajan) en UNA llamada al modelo, con la instrucción vigente, y revisa la salida con
 * `revisarExtraccion` antes de que nadie la guarde.
 *
 * El modelo va por Vercel AI Gateway con el SDK `ai`: un id «anthropic/…» se resuelve solo contra
 * el gateway y en Vercel se autentica con OIDC (sin llave en el repo). El id sale de la lista
 * oficial del gateway (`https://ai-gateway.vercel.sh/v1/models`, consultada el 2026-10-19):
 * `anthropic/claude-haiku-5.5` (lee PDF e imagen, ventana de 1 M, salida de hasta 128 k).
 *
 * Las pruebas le pasan un modelo simulado (`MockLanguageModelV4` de `ai/test`): nunca llaman al de
 * verdad.
 */
import { generateText, type LanguageModel } from 'ai'

import { revisarExtraccion, type ExtraccionRevisada } from './extraccion'

export const MODELO_EXTRACCION = 'anthropic/claude-haiku-5.5'

/**
 * Lo que se manda por corrida. La API del modelo recibe hasta 32 MB por petición y los archivos
 * viajan en base64 (un tercio más): 24 MB de archivos es el techo seguro.
 */
export const BYTES_MAXIMOS_CORRIDA = 24_000_000
/** La salida más larga que se pide. Un tarifario de cadena grande puede no caber: sale «cortada». */
export const TOKENS_MAXIMOS_SALIDA = 64_000

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

export async function correrMotor(p: {
  archivos: readonly ArchivoParaMotor[]
  instruccion: string
  hoy: string
  modelo?: LanguageModel
  senal?: AbortSignal
}): Promise<ResultadoMotor> {
  const modelo = p.modelo ?? MODELO_EXTRACCION
  if (p.archivos.length === 0) return { ok: false, error: 'Este proveedor no tiene tarifarios con archivo: sube al menos uno.' }
  const bytes = p.archivos.reduce((s, a) => s + a.datos.byteLength, 0)
  if (bytes > BYTES_MAXIMOS_CORRIDA) {
    return { ok: false, error: `Los tarifarios pesan ${(bytes / 1e6).toFixed(1)} MB y el motor recibe hasta ${BYTES_MAXIMOS_CORRIDA / 1e6} MB por corrida. Quita los que estén reemplazados.` }
  }
  const lista = p.archivos.map((a, i) => `${i + 1}. ${a.nombre}`).join('\n')
  let texto: string
  let fin: string
  try {
    const r = await generateText({
      model: modelo,
      instructions: p.instruccion,
      maxOutputTokens: TOKENS_MAXIMOS_SALIDA,
      abortSignal: p.senal,
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
  } catch (e) {
    console.error('[motor-extraccion] el modelo falló:', e instanceof Error ? e.message : e)
    return { ok: false, error: 'El motor no respondió. Vuelve a intentarlo en un rato.' }
  }
  if (fin === 'length') return { ok: false, error: 'La extracción salió cortada: el tarifario es más largo de lo que el motor alcanza a escribir en una corrida.' }
  const json = jsonDeRespuesta(texto)
  if (!json) return { ok: false, error: 'El motor no devolvió un JSON.' }
  const revisada = revisarExtraccion(json, { hoy: p.hoy })
  if (!revisada.ok) return { ok: false, error: `El motor devolvió una extracción con errores: ${revisada.error}`, errores: revisada.errores }
  return { ok: true, extraccion: revisada.extraccion, modelo: idDe(modelo) }
}
