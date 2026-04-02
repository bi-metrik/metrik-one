/**
 * tenant-rules — Motor de Reglas Condicionales [98H] §4
 *
 * Helper del lado del servidor (Next.js) para invocar evaluarReglas
 * via llamada HTTP a la Edge Function de Supabase.
 *
 * La Edge Function usa service role, por lo que puede leer/escribir
 * sin restricciones de RLS durante la evaluación.
 *
 * Uso típico en un Server Action:
 *
 *   await checkTenantRules(workspaceId, 'proyecto', 'status_change', {
 *     ...proyectoActual,
 *     estado_nuevo: nuevoEstado,
 *     estado_anterior: estadoActual,
 *   })
 *   // Si hay un gate activo, lanza BlockTransitionError y el
 *   // UPDATE de estado no se ejecuta.
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const EVALUAR_REGLAS_URL = `${SUPABASE_URL}/functions/v1/evaluar-reglas`

// Re-exportar para que los callers puedan hacer instanceof
export class BlockTransitionError extends Error {
  constructor(
    message: string,
    public readonly ruleId: string,
    public readonly ruleName: string,
  ) {
    super(message)
    this.name = 'BlockTransitionError'
  }
}

/**
 * Evalúa las tenant_rules activas para un tenant/entidad/evento.
 *
 * @throws BlockTransitionError si alguna regla con acción block_transition
 *         tiene sus condiciones cumplidas. El caller DEBE capturar esto
 *         y abortar el cambio de estado.
 */
export async function checkTenantRules(
  tenantId: string,
  entidad: 'oportunidad' | 'proyecto' | 'contacto' | 'empresa',
  evento: 'create' | 'update' | 'status_change' | 'handoff',
  registro: Record<string, unknown>,
  registroAnterior?: Record<string, unknown>,
): Promise<void> {
  const res = await fetch(EVALUAR_REGLAS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      apikey: SUPABASE_ANON_KEY,
    },
    body: JSON.stringify({ tenantId, entidad, evento, registro, registroAnterior }),
  })

  if (res.status === 422) {
    // La Edge Function detectó un gate activo
    const body = await res.json() as {
      blocked: boolean
      mensaje_error: string
      rule_id: string
      rule_name: string
    }
    throw new BlockTransitionError(body.mensaje_error, body.rule_id, body.rule_name)
  }

  if (!res.ok) {
    // Error inesperado en la evaluación — loguear pero no bloquear
    // para no romper el flujo del usuario por un error de infraestructura.
    console.error('[tenant-rules] Error evaluando reglas:', res.status, await res.text())
  }
}
