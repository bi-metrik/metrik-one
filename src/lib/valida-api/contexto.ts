import 'server-only'
import { cache } from 'react'
import { headers } from 'next/headers'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { createServiceClient } from '@/lib/supabase/server'
import { actorValido, type ActorOne } from './firma'
import { clienteOperable } from './reglas'

/**
 * Quién opera el módulo Valida API y sobre qué cliente de Valida.
 *
 * Es la puerta de TODA acción del módulo, y en este orden:
 *   1. hay sesión y workspace;
 *   2. el workspace tiene el módulo `valida_api` Y un `config_extra.valida_cliente_id` válido
 *      (`clienteOperable`): el cliente lo pone el servidor, nunca el navegador (§5.3);
 *   3. hay un actor atribuible (uuid + correo), que viaja firmado a Valida.
 *
 * El rol NO se decide aquí: cada acción pide el suyo con `reglas.ts`, porque no todas exigen lo
 * mismo (el consumo lo ven todos; las llaves, owner y admin).
 *
 * `config_extra` es server-only: se lee con el cliente de servicio, **acotado por el id del
 * workspace de la sesión** y mirando el `error` (un `?? {}` convertiría una falla de lectura en
 * «el módulo no está», que es otra respuesta).
 */

export type ContextoValidaApi =
  | { tipo: 'sin_sesion' }
  | { tipo: 'sin_modulo' }
  | { tipo: 'error_lectura' }
  | { tipo: 'sin_actor' }
  | {
      tipo: 'ok'
      workspaceId: string
      userId: string
      role: string
      clienteId: string
      actor: ActorOne
    }

async function resolverContexto(): Promise<ContextoValidaApi> {
  const { workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { tipo: 'sin_sesion' }

  const { data, error: errorLectura } = await createServiceClient()
    .from('workspaces')
    .select('modules, config_extra')
    .eq('id', workspaceId)
    .maybeSingle()
  if (errorLectura) {
    console.error('[valida-api] no se pudo leer el workspace:', errorLectura.message)
    return { tipo: 'error_lectura' }
  }

  const fila = data as { modules?: Record<string, unknown> | null; config_extra?: unknown } | null
  const clienteId = clienteOperable(fila?.modules ?? null, fila?.config_extra ?? null)
  if (!clienteId) return { tipo: 'sin_modulo' }

  const { user } = await getCachedUser()
  // `userId` de getWorkspace puede ser el de una persona impersonada ("Ver como"); el actor que
  // queda en la bitácora de Valida tiene que ser quien de verdad está operando: la sesión real.
  const actor = actorValido(user?.id, user?.email)
  if (!actor) return { tipo: 'sin_actor' }

  return { tipo: 'ok', workspaceId, userId, role: role ?? 'read_only', clienteId, actor }
}

/**
 * Deduplicado por request con `cache()` de React: la página y cada acción que llama durante el
 * mismo render leen el workspace UNA vez, no cinco. Mismo patrón que `getWorkspaceCached`.
 */
export const contextoValidaApi = cache(resolverContexto)

/** IP y navegador de la petición, para la constancia de aceptación. */
export async function origenPeticion(): Promise<{ ip: string | null; userAgent: string | null }> {
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || null
  return { ip, userAgent: h.get('user-agent') }
}
