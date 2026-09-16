import 'server-only'

/**
 * Muro de calidad: la lectura con service_role y la puerta del muro publico por enlace.
 *
 * ⚠️ POR QUE ESTE ARCHIVO EXISTE. `getMuroPorWorkspace(workspaceId)` vivia exportada desde
 * `calidad/actions.ts`, que es `'use server'`: era una server action alcanzable por POST
 * sin sesion. Leia el muro con service_role para el workspace que le pasaran, y los tres
 * gates del muro publico (modulo, opt-in y token) solo los aplicaba la PAGINA. Con el id
 * de cualquier workspace se obtenia su muro sin enlace, sin opt-in y sin modulo.
 *
 * Ahora la validacion vive DENTRO de la funcion que lee: `getMuroPublico(token)` resuelve
 * el workspace por el token y aplica los tres gates antes de tocar la RPC. Y nada de este
 * modulo es invocable como accion: `server-only` impide importarlo desde un componente de
 * cliente, y sin `'use server'` no genera endpoint.
 */

import { createServiceClient } from '@/lib/supabase/server'
import type { MuroData } from './types'

/** Largo minimo del token del enlace; uno mas corto ni se consulta. */
export const MURO_TOKEN_LARGO_MINIMO = 8

/**
 * Lee el muro de un workspace con service_role. La RPC `get_calidad_muro` no devuelve
 * `cliente_ref` ni columnas monetarias por construccion.
 *
 * ⚠️ NO valida nada: quien la llama tiene que haber resuelto antes que el workspace es
 * legitimo (la sesion en `getMuro`, el token en `getMuroPublico`). Nunca re-exportarla
 * desde un archivo `'use server'`: eso reabre exactamente el hueco que este modulo cierra.
 */
export async function leerMuroDeWorkspace(workspaceId: string, fecha?: string): Promise<MuroData | null> {
  const svc = createServiceClient()
  // La RPC no esta en el database.ts generado (misma deuda que las tablas calidad_*).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (svc as any).rpc('get_calidad_muro', {
    p_workspace_id: workspaceId,
    ...(fecha ? { p_fecha: fecha } : {}),
  })
  if (error || !data) return null
  return data as MuroData
}

/**
 * Muro proyectable, publico por enlace y sin sesion. TRES gates, no uno:
 *   1. El token de la URL coincide con `config_extra.muro_token` (no adivinable).
 *   2. El workspace tiene `modules.calidad_llamadas`.
 *   3. El workspace declaro `config_extra.muro_publico`: tener el modulo NO alcanza.
 *
 * Cualquiera que falle devuelve `null`, sin pistas de si el workspace existe.
 */
export async function getMuroPublico(
  token: string,
): Promise<{ data: MuroData; nombreWorkspace: string } | null> {
  if (!token || token.length < MURO_TOKEN_LARGO_MINIMO) return null

  const svc = createServiceClient()
  const { data: ws } = await svc
    .from('workspaces')
    .select('id, name, modules, config_extra')
    .eq('config_extra->>muro_token', token)
    .maybeSingle()
  if (!ws) return null

  const modules = (ws as { modules: Record<string, boolean> | null }).modules
  const configExtra = (ws as { config_extra: Record<string, unknown> | null }).config_extra ?? {}
  if (!modules?.calidad_llamadas) return null
  if ((configExtra as { muro_publico?: boolean }).muro_publico !== true) return null

  const data = await leerMuroDeWorkspace(ws.id as string)
  if (!data) return null
  return { data, nombreWorkspace: ws.name as string }
}
