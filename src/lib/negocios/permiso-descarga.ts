import 'server-only'

import { puedeDescargarNegocios } from '@/lib/roles'

/**
 * ¿Este rol puede bajarse la lista de negocios EN ESTE workspace? (SOE-028)
 *
 * Fuente única del servidor para las tres superficies: el gate de
 * `POST /api/negocios/export`, el de `subirExportNegociosADrive` y la lista que decide
 * si pinta los botones. La regla vive en `puedeDescargarNegocios` (`roles.ts`); esto
 * solo le lleva `workspaces.config_extra`.
 *
 * Si el rol ya pasa por el default, no se lee la base. Si la lectura falla, se aplica el
 * default: un error nunca abre el permiso.
 */
export async function puedeDescargarNegociosDelWorkspace(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string | null | undefined,
  role: string | null | undefined,
): Promise<boolean> {
  if (puedeDescargarNegocios(role)) return true
  if (!supabase || !workspaceId || !role) return false

  try {
    const { data, error } = await supabase
      .from('workspaces')
      .select('config_extra')
      .eq('id', workspaceId)
      .maybeSingle()
    if (error) {
      console.error('[negocios-descarga] no se pudo leer config_extra:', error.message)
      return false
    }
    return puedeDescargarNegocios(role, data?.config_extra ?? null)
  } catch (e) {
    console.error('[negocios-descarga] no se pudo leer config_extra:', e)
    return false
  }
}
