import 'server-only'
import { cache } from 'react'
import { createClient } from './server'

/**
 * La fila de `profiles` del usuario de la sesion, UNA vez por render.
 *
 * Motivo (medido 2026-10-02 en los logs de Supabase: ~4.500 lecturas de `/profiles` en
 * ~2 h): cada render de `(app)/layout.tsx` leia la MISMA fila tres veces en paralelo,
 * cada una con sus columnas — el layout (nombre, rol, workspace), `getWorkspace` (rol,
 * plataforma, slug del workspace) y `getPlatformAdminState` (home workspace,
 * plataforma). Mas la del middleware, cuatro por carga de pagina. Aqui se pide la union
 * de columnas una vez y los tres la comparten via `cache()`, como `getCachedUser`.
 *
 * Mismo cliente autenticado (mismo RLS) que usaban los tres. Fuera de un render (una
 * ruta, un server action) `cache()` no memoiza y esto es una lectura normal, como antes.
 *
 * El slug va EMBEBIDO con la FK nombrada: `profiles` tiene DOS hacia `workspaces`
 * (`workspace_id` y `home_workspace_id`); sin nombrarla PostgREST responde PGRST201.
 */
export type PerfilDeSesion = {
  id: string
  workspace_id: string
  home_workspace_id: string | null
  role: string
  full_name: string | null
  platform_admin: boolean
  workspaces: { slug: string | null; name: string | null } | null
}

const COLUMNAS =
  'id, workspace_id, home_workspace_id, role, full_name, platform_admin, workspaces!profiles_workspace_id_fkey(slug, name)'

export const leerPerfilDeSesion = cache(async (userId: string): Promise<PerfilDeSesion | null> => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .select(COLUMNAS as any)
    .eq('id', userId)
    .single()
  return (data as unknown as PerfilDeSesion | null) ?? null
})
