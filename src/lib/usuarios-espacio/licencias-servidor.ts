import 'server-only'
import type { createClient } from '@/lib/supabase/server'
import { designacionDelEspacio } from '@/lib/valida-api/terminos-servidor'
import { licenciasDelEspacio, type LicenciasDelEspacio } from './reglas'

type ClienteSesion = Awaited<ReturnType<typeof createClient>>

/**
 * Las licencias del espacio para `/config` y `/mi-negocio`: los perfiles contra `max_seats`, sin
 * contar a la persona designada del contrato (administrador sin costo, la misma regla que
 * `/suscripcion`). Si la designación no se puede leer, cuentan todos: es lo de antes y nunca deja
 * pasar a alguien de más.
 */
export async function leerLicenciasDelEspacio(supabase: ClienteSesion, workspaceId: string): Promise<LicenciasDelEspacio> {
  const [perfiles, ws, designacion] = await Promise.all([
    supabase.from('profiles').select('id').eq('workspace_id', workspaceId),
    supabase.from('workspaces').select('max_seats').eq('id', workspaceId).single(),
    designacionDelEspacio(workspaceId),
  ])
  if (perfiles.error) console.error('[licencias] perfiles del espacio:', perfiles.error.message)
  return licenciasDelEspacio({
    perfiles: perfiles.data ?? [],
    maxSeats: ws.data?.max_seats,
    designadoId: designacion === 'error' ? null : designacion.designadoId,
  })
}
