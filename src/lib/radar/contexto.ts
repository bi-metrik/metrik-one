import 'server-only'
import { cache } from 'react'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { createServiceClient } from '@/lib/supabase/server'
import { MODULOS } from '@/lib/modulos/catalogo'

/**
 * Quién opera el Radar. Es la puerta de TODA lectura y escritura del módulo, en este orden:
 *   1. hay sesión y workspace;
 *   2. el workspace tiene el módulo `radar_secop` encendido;
 *   3. hay un usuario REAL de la sesión al que atribuir lo que se marque.
 *
 * Más corto que el de Valida API porque el Radar no tiene un cliente externo que configurar: no
 * hay `config_extra` que leer ni un id que el navegador pudiera mandar. Lo que sí se copia es que
 * `modules` se lee con el cliente de servicio **acotado al id del workspace de la sesión** y
 * mirando el `error`: un `?? {}` convertiría «no pude leer» en «el módulo no está», que es otra
 * respuesta y abre la puerta a decidir con un dato que nunca llegó.
 *
 * El rol no se decide aquí: el Radar lo ven todos los roles del espacio (es una herramienta de
 * priorización, no un dato financiero) y quién EDITA los temas lo decide la acción.
 */

export type ContextoRadar =
  | { tipo: 'sin_sesion' }
  | { tipo: 'sin_modulo' }
  | { tipo: 'error_lectura' }
  | { tipo: 'sin_usuario' }
  | { tipo: 'ok'; workspaceId: string; usuarioId: string; role: string }

async function resolverContexto(): Promise<ContextoRadar> {
  const { workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { tipo: 'sin_sesion' }

  const { data, error: errorLectura } = await createServiceClient()
    .from('workspaces')
    .select('modules')
    .eq('id', workspaceId)
    .maybeSingle()
  if (errorLectura) {
    console.error('[radar] no se pudo leer el workspace:', errorLectura.message)
    return { tipo: 'error_lectura' }
  }

  const modules = (data as { modules?: Record<string, unknown> | null } | null)?.modules ?? null
  if (modules?.[MODULOS.radar_secop.clave] !== true) return { tipo: 'sin_modulo' }

  // El usuario REAL de la sesión, no el impersonado por «Ver como»: lo que se marque como seguido
  // queda a nombre de quien de verdad lo marcó.
  const { user } = await getCachedUser()
  if (!user?.id) return { tipo: 'sin_usuario' }

  return { tipo: 'ok', workspaceId, usuarioId: user.id, role: role ?? 'read_only' }
}

/** Una sola resolución por request aunque la pidan la página y varias acciones. */
export const contextoRadar = cache(resolverContexto)
