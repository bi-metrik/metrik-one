import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { VALIDA_API_BASE } from './credencial-servidor'
import type { Severidad, ValidaConsultaInput, ValidaResultado } from '@/lib/actions/valida-consultas'

/**
 * La consulta a Valida y su registro en el historial, compartidos por la consulta puntual
 * (`consultarValida`) y el trabajador del cargue masivo (`lote-servidor.ts`). Un solo camino para
 * los dos es lo que garantiza que una fila del lote dé EXACTAMENTE lo que daba antes: el mismo
 * endpoint, el mismo cuerpo, la misma fila en `valida_consultas`.
 */

/**
 * Tope de la llamada a la API de Valida. Sin el, una API colgada dejaba colgado el server
 * action y, con el, la fila del cargue masivo. Al agotarse la consulta se guarda como error
 * (`valida_tiempo_agotado`).
 */
export const TIMEOUT_VALIDA_MS = 30_000

export type RespuestaValida =
  | { ok: true; data: ValidaResultado }
  | { ok: false; error: string; status?: number; retryAfterS?: number }

/**
 * `POST /api/v1/validate`. `claveIdempotencia` (solo el cargue masivo) va en `Idempotency-Key`:
 * Valida repite la respuesta guardada sin cobrar otra vez. El cuerpo es el mismo con o sin ella.
 */
export async function llamarValida(
  apiKey: string,
  input: ValidaConsultaInput,
  opts: { claveIdempotencia?: string; timeoutMs?: number } = {},
): Promise<RespuestaValida> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    }
    if (opts.claveIdempotencia) headers['Idempotency-Key'] = opts.claveIdempotencia
    const res = await fetch(`${VALIDA_API_BASE}/api/v1/validate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(input),
      cache: 'no-store',
      signal: AbortSignal.timeout(opts.timeoutMs ?? TIMEOUT_VALIDA_MS),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      // Retry-After en segundos (429 rate_limit y 402 de bolsa con cobro en curso).
      const espera = Number(res.headers?.get?.('retry-after'))
      return {
        ok: false,
        error: body.error ?? `HTTP ${res.status}`,
        status: res.status,
        ...(Number.isFinite(espera) && espera >= 0 ? { retryAfterS: espera } : {}),
      }
    }
    const data = (await res.json()) as ValidaResultado
    return { ok: true, data }
  } catch (err) {
    if (err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')) {
      return { ok: false, error: 'valida_tiempo_agotado' }
    }
    return { ok: false, error: err instanceof Error ? err.message : 'error_desconocido' }
  }
}

/** La fila que queda en `valida_consultas` (el historial). */
export function filaDeConsulta(opts: {
  workspaceId: string
  userId: string | null
  negocioId: string | null
  loteId: string | null
  tipo: 'puntual' | 'masiva_item'
  input: ValidaConsultaInput
  resultado: RespuestaValida
}): Record<string, unknown> {
  const isError = !opts.resultado.ok
  const data = opts.resultado.ok ? opts.resultado.data : null
  return {
    workspace_id: opts.workspaceId,
    negocio_id: opts.negocioId,
    lote_id: opts.loteId,
    tipo: opts.tipo,
    tipo_persona: opts.input.tipo,
    nombre_consultado: opts.input.nombre || null,
    documento_tipo: opts.input.documento?.tipo ?? null,
    documento_numero: opts.input.documento?.numero ?? null,
    valida_consulta_id: data?.consulta_id ?? null,
    severidad: (isError ? 'error' : data!.severidad) as Severidad,
    total_matches: data?.total_matches ?? 0,
    matches: data?.matches ?? null,
    hash_reporte: data?.hash_reporte ?? null,
    created_by: opts.userId,
  }
}

export async function persistirConsulta(
  opts: Parameters<typeof filaDeConsulta>[0] & { loteFilaId?: string | null },
): Promise<{ ok: true; id: string } | { ok: false; error: string; code?: string }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const row = filaDeConsulta(opts)
  if (opts.loteFilaId) row.lote_fila_id = opts.loteFilaId

  const { data: ins, error } = await svc.from('valida_consultas').insert(row).select('id').single()

  if (error) return { ok: false, error: error.message, code: error.code }
  return { ok: true, id: ins.id }
}

/**
 * Recalcula el score SARLAFT del negocio si tiene datos configurados. Silencioso: no afecta la
 * consulta. La consulta puntual lo corre después de cada consulta; el lote, una vez por negocio y
 * turno (el score se calcula con la ÚLTIMA consulta del negocio, así que el resultado es el mismo).
 */
export async function recalcularScoreNegocio(workspaceId: string, negocioId: string): Promise<void> {
  try {
    const { calcularScoreNegocio, persistirScore } = await import('@/lib/valida/calculo-score')
    const calc = await calcularScoreNegocio({ workspaceId, negocioId })
    if (calc.ok) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const svc = createServiceClient() as any
      const { data: datos } = await svc
        .from('valida_sarlaft_datos_negocio')
        .select('universo')
        .eq('negocio_id', negocioId)
        .maybeSingle()
      if (datos) {
        await persistirScore({ workspaceId, negocioId, universo: datos.universo, resultado: calc.resultado })
      }
    }
  } catch {
    // Re-cálculo silencioso — no afecta el flujo principal de la consulta
  }
}
