import { negocioCerrado, MENSAJE_NEGOCIO_CERRADO } from './motivo-cierre'

// Cast a untyped: las acciones que lo usan ya trabajan con clientes sin tipar.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

/**
 * ¿Hay que cortar por cierre? Devuelve el mensaje de bloqueo, o `null` si se puede
 * seguir.
 *
 * Es para las acciones de dinero que NO pasan por `guardEditarBloque` — ahí el
 * estado ya viaja en la misma consulta del bloque. El criterio es el mismo helper
 * (`negocioCerrado`), no un segundo predicado.
 *
 * ⚠️ Si el negocio no aparece, NO bloquea. Esta función responde una sola pregunta
 * ("¿está cerrado?") y no puede contestarla; decir "está cerrado" sobre un negocio
 * que no existe manda al operador a reabrir algo que no está. Quién existe lo
 * valida cada acción por su cuenta, y las que llaman a esto ya lo hacen.
 */
export async function bloqueoPorNegocioCerrado(
  supabase: unknown,
  workspaceId: string,
  negocioId: string,
): Promise<string | null> {
  const { data } = await db(supabase)
    .from('negocios')
    .select('estado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!data) return null
  return negocioCerrado((data as { estado: string | null }).estado) ? MENSAJE_NEGOCIO_CERRADO : null
}
