'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { guardVerNegocio } from '@/lib/permissions/guard-negocio'
import {
  enviosDelBloque,
  type ConfigBloqueAvisos,
  type EnvioVista,
  type FilaAvisoCliente,
} from '@/lib/avisos-cliente/envios-del-bloque'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

/**
 * Los correos al cliente de la etapa donde vive el bloque `avisos_cliente`.
 *
 * Se lee desde el componente (no lo arma `getNegocioDetalle`) para que el bloque diga lo mismo
 * en la etapa actual y en el historial de etapas previas, donde el servidor no inyecta datos.
 * Lectura con la sesión: `avisos_cliente` tiene RLS por workspace y grant de SELECT a
 * `authenticated`; nadie escribe desde aquí.
 */
export async function leerEnviosDelBloque(
  negocioId: string,
  bloqueConfigId: string,
): Promise<{ envios: EnvioVista[]; queSeEnvio: string | null; error: string | null }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { envios: [], queSeEnvio: null, error: 'No autenticado' }
  const guard = await guardVerNegocio(negocioId)
  if (!guard.ok) return { envios: [], queSeEnvio: null, error: guard.error ?? 'Sin acceso' }

  const db = supabase as Cliente
  const { data: cfg } = await db
    .from('bloque_configs')
    .select('etapa_id, workspace_id, config_extra')
    .eq('id', bloqueConfigId)
    .maybeSingle()
  const fila = cfg as { etapa_id: string; workspace_id: string; config_extra: Record<string, unknown> | null } | null
  if (!fila || fila.workspace_id !== workspaceId) {
    return { envios: [], queSeEnvio: null, error: 'Bloque no encontrado' }
  }
  const config = (fila.config_extra ?? {}) as ConfigBloqueAvisos

  const { data: avisos, error: errAvisos } = await db
    .from('avisos_cliente')
    .select('id, canal, estado, destino, copia_a, motivo, titulo, created_at, entregado_at, queja_at, bloque_config_id')
    .eq('workspace_id', workspaceId)
    .eq('negocio_id', negocioId)
    .eq('etapa_id', fila.etapa_id)
    .order('created_at', { ascending: false })
    .limit(50)
  if (errAvisos) {
    console.error('[leerEnviosDelBloque]', errAvisos.message)
    return { envios: [], queSeEnvio: null, error: 'No se pudieron leer los envíos' }
  }

  return {
    envios: enviosDelBloque((avisos ?? []) as FilaAvisoCliente[], config),
    queSeEnvio: typeof config.que_se_envio === 'string' && config.que_se_envio.trim() ? config.que_se_envio.trim() : null,
    error: null,
  }
}
