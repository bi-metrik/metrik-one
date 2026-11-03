import 'server-only'

/**
 * El lado de Supabase y del modelo de la calificación diaria (ver `calificacion.ts`). Cliente de SERVICIO: las tablas
 * son server-only y no están en los tipos generados.
 *
 * El juez es Claude Haiku 5.5 por el punto único del modelo (`fetchModelo`). El pedido se arma con la forma de Gemini
 * (así habla `fetchModelo`) pero SIN llave de Gemini a propósito: el juez no tiene respaldo en otro proveedor, porque
 * el texto de las conversaciones de un cliente solo sale hacia el proveedor que su contrato cubre. Si Haiku falla, la
 * conversación queda sin calificar ese día y el resumen lo dice.
 */
import { fetchModelo, MODELO_HAIKU } from '@/lib/ai/modelo-llm'
import { haikuActivo, modeloQueRespondio } from '../../../supabase/functions/_shared/llm-anthropic.ts'
import { COLUMNAS_CHATWOOT, COLUMNAS_WA, leerPaginado, type FilaChatwoot, type FilaWa } from './conversaciones'
import { ESQUEMA_JUEZ, calificaConTexto, type FichaLeida, type Juez, type PuertoCalificacion } from './calificacion'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** Las filas del día de las dos tablas de conversación (filtro por fecha de creación, en orden). */
export async function filasDelDiaSupabase(db: Db, desde: string, hasta: string): Promise<{ wa: FilaWa[]; chatwoot: FilaChatwoot[] }> {
  const [wa, chatwoot] = await Promise.all([
    leerPaginado<FilaWa>((a, b) =>
      db.from('wa_conversacion').select(COLUMNAS_WA).gte('created_at', desde).lt('created_at', hasta)
        .order('created_at', { ascending: true }).order('id', { ascending: true }).range(a, b)),
    leerPaginado<FilaChatwoot>((a, b) =>
      db.from('chatwoot_conversacion').select(COLUMNAS_CHATWOOT).gte('created_at', desde).lt('created_at', hasta)
        .order('created_at', { ascending: true }).order('id', { ascending: true }).range(a, b)),
  ])
  return { wa, chatwoot }
}

export function puertoCalificacionSupabase(db: Db): PuertoCalificacion {
  return {
    filasDelDia: (desde, hasta) => filasDelDiaSupabase(db, desde, hasta),
    async conTexto(ids) {
      if (!ids.length) return new Set()
      const { data, error } = await db.from('workspaces').select('id, config_extra').in('id', ids)
      if (error) throw new Error(`workspaces: ${error.message}`)
      return new Set(((data ?? []) as Array<{ id: string; config_extra: unknown }>).filter((w) => calificaConTexto(w.config_extra)).map((w) => w.id))
    },
    async fichas(workspaceId, ids) {
      const { data, error } = await db.from('bot_reglamentos').select('id, fichas').eq('workspace_id', workspaceId).in('id', ids)
      if (error) throw new Error(`bot_reglamentos: ${error.message}`)
      return new Map(((data ?? []) as Array<{ id: string; fichas: unknown }>).map((r) => [r.id, Array.isArray(r.fichas) ? (r.fichas as FichaLeida[]) : []]))
    },
    async yaCalificadas(fecha) {
      const filas = await leerPaginado<{ workspace_id: string; conversacion: string }>((a, b) =>
        db.from('asistente_calificaciones').select('workspace_id, conversacion').eq('fecha', fecha).order('id').range(a, b))
      return new Set(filas.map((f) => `${f.workspace_id}|${f.conversacion}`))
    },
    async guardar(fila) {
      const { error } = await db.from('asistente_calificaciones').insert(fila)
      if (!error) return 'guardada'
      if (error.code === '23505') return 'duplicada'
      throw new Error(`asistente_calificaciones: ${error.code ?? ''} ${error.message}`)
    },
    async precios() {
      const { data, error } = await db.from('bot_modelo_precios').select('modelo, usd_millon_entrada, usd_millon_salida, usd_millon_cache')
      if (error) throw new Error(`bot_modelo_precios: ${error.message}`)
      return ((data ?? []) as Array<{ modelo: string; usd_millon_entrada: number; usd_millon_salida: number; usd_millon_cache: number | null }>).map((p) => ({
        modelo: p.modelo,
        entrada: Number(p.usd_millon_entrada),
        salida: Number(p.usd_millon_salida),
        cache: p.usd_millon_cache == null ? null : Number(p.usd_millon_cache),
      }))
    },
  }
}

// La URL solo le dice a `fetchModelo` que es un `generateContent`; el pedido va a Haiku 5.5 (sin llave de Gemini).
const URL_PEDIDO = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent'

/** El juez de producción: Haiku 5.5 con salida JSON, sin respaldo. Nunca lanza. */
export const juezHaiku: Juez = async ({ sistema, usuario }) => {
  // Sin Haiku (proveedor en Gemini o sin llave) el texto no sale: `fetchModelo` lo mandaría a Google.
  if (!haikuActivo()) return { ok: false, error: 'Haiku no está activo (LLM_PROVEEDOR o ANTHROPIC_API_KEY): sin juez' }
  try {
    const res = await fetchModelo(URL_PEDIDO, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: sistema }] },
        contents: [{ role: 'user', parts: [{ text: usuario }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 2048, responseMimeType: 'application/json', responseSchema: ESQUEMA_JUEZ },
      }),
      signal: AbortSignal.timeout(60_000),
    })
    const datos = await res.json().catch(() => null)
    if (!res.ok) return { ok: false, error: `juez ${res.status}: ${String(datos?.error?.message ?? '').slice(0, 200)}` }
    const texto = datos?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? ''
    if (!texto) return { ok: false, error: 'juez sin texto' }
    const u = datos?.usageMetadata ?? {}
    return {
      ok: true,
      texto,
      modelo: modeloQueRespondio(datos, MODELO_HAIKU),
      entrada: Number(u.promptTokenCount ?? 0),
      salida: Number(u.candidatesTokenCount ?? 0),
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
