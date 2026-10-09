import 'server-only'
import { createServiceClient } from '@/lib/supabase/server'
import { leerSecretosWorkspace, secretoConRespaldo } from '@/lib/secretos/workspace'
import { pruebaDeConfig, saldoDePruebaVencida, saldoDesdeCuentaConsumo, type PruebaValida, type SaldoBolsa } from './corte-bolsa'

export const VALIDA_API_BASE = process.env.VALIDA_API_BASE || 'https://api.valida.metrikone.co'

/**
 * La llave de Valida del espacio y, si nació por el registro autogestionado, su prueba.
 *
 * SIN respaldo a la llave global de MeTRIK. Hasta el 2026-09-16 caía a `VALIDA_API_KEY`: un
 * workspace sin llave propia consultaba a cargo de MeTRIK, y sus reportes quedaban bajo la llave de
 * MeTRIK, donde `descargarPDFConsultaValida` los devolvía a cualquiera que tuviera un id. Sin llave,
 * la consulta falla a la vista. Vault primero; `config_extra` solo mientras dure el traslado.
 */
export async function credencialValida(workspaceId: string): Promise<{ llave: string | null; prueba: PruebaValida | null }> {
  const svc = createServiceClient()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (svc.from('workspaces') as any)
    .select('config_extra')
    .eq('id', workspaceId)
    .single()
  const config = (data?.config_extra ?? null) as Record<string, unknown> | null
  const llave = secretoConRespaldo(await leerSecretosWorkspace(workspaceId), config, 'valida_api_key')
  return { llave: llave ?? null, prueba: pruebaDeConfig(config) }
}

const TIMEOUT_SALDO_MS = 4_000

/**
 * Saldo de la bolsa del espacio, para el contador de `/valida`. null = no aplica o no se pudo leer:
 * la página carga igual y sin contador (un espacio con plan mensual o la licencia de los CDA no tiene
 * bolsa, y Valida responde otra modalidad).
 *
 * Una prueba ya vencida no se puede leer (su llave dejó de existir para Valida y responde 401), así
 * que con la fecha de la prueba vencida se devuelve el corte sin llamar.
 */
export async function leerSaldoValida(workspaceId: string, ahora: Date = new Date()): Promise<SaldoBolsa | null> {
  const { llave, prueba } = await credencialValida(workspaceId)
  if (prueba && Date.parse(prueba.vence_en) <= ahora.getTime()) return saldoDePruebaVencida(prueba)
  if (!llave) return null
  try {
    const res = await fetch(`${VALIDA_API_BASE}/api/v1/cuenta/consumo`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${llave}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(TIMEOUT_SALDO_MS),
    })
    if (!res.ok) return null
    return saldoDesdeCuentaConsumo(await res.json().catch(() => null), ahora)
  } catch {
    return null
  }
}
