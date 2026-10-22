import 'server-only'

import { createServiceClient } from '@/lib/supabase/server'
import { puedeAsignarResponsable, type ActorAsignarResponsable } from './asignar-responsable'

/**
 * `puedeAsignarResponsable` con la lectura de `workspaces.config_extra` incluida.
 *
 * La usan los guards de `agregarResponsable`/`quitarResponsable` y la lista de
 * negocios. `config_extra` es server-only: se lee con el cliente de servicio, acotado
 * al workspace de la sesión, igual que en el detalle (`vista-negocio.tsx`), para que
 * pantalla y guard miren por el mismo camino.
 *
 * Si el rol ya pasa (owner/admin/supervisor), no se lee la base. Si la lectura falla,
 * solo pasa el rol: un error nunca abre el permiso.
 */
export async function puedeAsignarResponsableEnWorkspace(
  workspaceId: string | null | undefined,
  actor: ActorAsignarResponsable,
): Promise<boolean> {
  if (puedeAsignarResponsable(actor, null)) return true
  if (!workspaceId || !actor.staffId) return false

  try {
    const { data, error } = await createServiceClient()
      .from('workspaces')
      .select('config_extra')
      .eq('id', workspaceId)
      .maybeSingle()
    if (error) {
      console.error('[asignar-responsable] no se pudo leer config_extra:', error.message)
      return false
    }
    const config = (data as { config_extra?: unknown } | null)?.config_extra ?? null
    return puedeAsignarResponsable(actor, config)
  } catch (e) {
    console.error('[asignar-responsable] no se pudo leer config_extra:', e)
    return false
  }
}
