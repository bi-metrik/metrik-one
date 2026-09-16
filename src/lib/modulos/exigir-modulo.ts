import 'server-only'
import { cache } from 'react'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { createServiceClient } from '@/lib/supabase/server'
import { soportePasaGate, type ContextoGate } from './gate'
import { cumpleRequisitoModulo, type RequisitoModulo } from './requisito'

/**
 * Puerta de módulo para server actions. Ver `requisito.ts` para el criterio.
 *
 * Se lee con el cliente de SERVICIO, acotado por el workspace de la sesión:
 *   - `workspaces.modules` del workspace activo (el de `getWorkspace`, que ya aplica "Ver como");
 *   - `profiles.platform_admin` de la persona que de verdad tiene la sesión, no de la
 *     impersonada: es el mismo criterio del middleware, que mira la sesión real. Y, como en el
 *     middleware, el soporte solo pasa en su propio espacio (`soportePasaGate`).
 *
 * ⚠️ A diferencia del middleware, aquí un fallo de lectura CIERRA. El middleware deja pasar
 * porque no es la frontera de aislamiento y un corte de red no puede rebotar a todo el
 * producto; aquí la acción protege llaves globales que se cobran (Valida, ePayco) y
 * credenciales compartidas (Drive), y el lado seguro de un control es frenar.
 *
 * Deduplicado por request con `cache()`: varias acciones en el mismo render leen una vez.
 */

export type ResultadoModulo =
  | { ok: true; workspaceId: string }
  | { ok: false; error: 'no_autenticado' | 'modulo_no_activo' | 'lectura_fallida' }

/** Texto para el usuario. Los códigos de arriba son para las pruebas y los logs. */
export const MENSAJE_MODULO_NO_ACTIVO = 'Este espacio no tiene activo el módulo que usa esta acción.'

type Contexto =
  | { tipo: 'ok'; workspaceId: string; gate: ContextoGate }
  | { tipo: 'sin_sesion' }
  | { tipo: 'error' }

async function leerContexto(): Promise<Contexto> {
  const { workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { tipo: 'sin_sesion' }
  const { user } = await getCachedUser()
  if (!user) return { tipo: 'sin_sesion' }

  const svc = createServiceClient()
  const [ws, perfil] = await Promise.all([
    svc.from('workspaces').select('modules').eq('id', workspaceId).maybeSingle(),
    svc.from('profiles').select('platform_admin, workspace_id, home_workspace_id').eq('id', user.id).maybeSingle(),
  ])
  if (ws.error || perfil.error || !ws.data) {
    console.error(
      '[exigir-modulo] no se pudo leer el workspace o el perfil; la acción se cierra:',
      ws.error?.message ?? perfil.error?.message ?? 'workspace sin fila',
    )
    return { tipo: 'error' }
  }

  const fila = perfil.data as
    | { platform_admin?: boolean | null; workspace_id?: string | null; home_workspace_id?: string | null }
    | null
  return {
    tipo: 'ok',
    workspaceId,
    gate: {
      modules: ((ws.data as { modules?: Record<string, boolean> | null }).modules ?? null),
      platformAdmin: soportePasaGate({
        platformAdmin: fila?.platform_admin,
        workspaceId: fila?.workspace_id,
        homeWorkspaceId: fila?.home_workspace_id,
      }),
      modoVitrina: false,
    },
  }
}

const contextoDeRequest = cache(leerContexto)

export async function exigirModulo(req: RequisitoModulo): Promise<ResultadoModulo> {
  const ctx = await contextoDeRequest()
  if (ctx.tipo === 'sin_sesion') return { ok: false, error: 'no_autenticado' }
  if (ctx.tipo === 'error') return { ok: false, error: 'lectura_fallida' }
  if (!cumpleRequisitoModulo(req, ctx.gate)) return { ok: false, error: 'modulo_no_activo' }
  return { ok: true, workspaceId: ctx.workspaceId }
}

export { REQUISITO } from './requisito'
