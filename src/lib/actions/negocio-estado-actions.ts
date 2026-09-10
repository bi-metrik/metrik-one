'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { negocioCerrado } from '@/lib/negocios/motivo-cierre'

// Cast a untyped: mismo patron que el resto de acciones de este directorio.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

/**
 * ¿El negocio esta cerrado? Una sola pregunta, para superficies que solo tienen el
 * id — hoy el FAB, que del contexto solo conoce el `pathname`.
 *
 * ⚠️ Ante error, negocio de otro workspace o sesion sin workspace devuelve `false`
 * (NO cerrado). Es el mismo criterio que `negocioPuedeRecibirCobro`: esto decide si
 * se APAGA un boton, y un boton que se apaga porque no se pudo leer el estado
 * ensena a desconfiar de la pantalla. La barrera real vive en el servidor
 * (`guardEditarBloque`, `registrarPagoEnNegocio`, horas y gastos), que si corta.
 */
export async function negocioDeContextoCerrado(
  negocioId: string,
): Promise<{ cerrado: boolean }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { cerrado: false }
  const { data } = await db(supabase)
    .from('negocios')
    .select('estado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!data) return { cerrado: false }
  return { cerrado: negocioCerrado((data as { estado: string | null }).estado) }
}
