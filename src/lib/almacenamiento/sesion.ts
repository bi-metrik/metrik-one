import 'server-only'

// Dependencias REALES de `resolverAccesoNegocio` / `resolverApertura`: la sesión del
// usuario (con "Ver como"), el negocio leído con el cliente de la sesión (RLS) más el
// filtro explícito por workspace, y el mismo guard de visibilidad del detalle.
// Las comparten el endpoint que abre archivos y la vista del repositorio.

import { getWorkspace } from '@/lib/actions/get-workspace'
import { guardVerNegocio } from '@/lib/permissions/guard-negocio'
import type { DependenciasAcceso } from './abrir'
import type { DependenciasArchivoCobro, FilaCobroArchivo } from './archivo-de-cobro'

export function dependenciasDeSesion(): DependenciasAcceso {
  let supabaseSesion: unknown = null
  return {
    async workspaceDeSesion() {
      const ws = await getWorkspace()
      supabaseSesion = ws.supabase
      return ws.error ? null : ws.workspaceId
    },
    async negocioEsDelWorkspace(negocioId, workspaceId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabaseSesion as any)
        .from('negocios')
        .select('id')
        .eq('id', negocioId)
        .eq('workspace_id', workspaceId)
        .maybeSingle()
      return !!data
    },
    async puedeVerNegocio(negocioId) {
      return (await guardVerNegocio(negocioId)).ok
    },
  }
}

/**
 * Dependencias REALES de `resolverArchivoDeCobro`: la sesión (con "Ver como") y el cobro
 * leído con el cliente de la sesión (RLS) MÁS el filtro explícito por workspace.
 *
 * El filtro explícito no sobra teniendo RLS: es la misma cinta y tirantes que ya usa
 * `negocioEsDelWorkspace` de arriba, y es lo único que impide que un cambio de policy
 * convierta esta ruta en un lector de cobros ajenos.
 */
export function dependenciasDeCobro(): DependenciasArchivoCobro {
  let supabaseSesion: unknown = null
  return {
    async workspaceDeSesion() {
      const ws = await getWorkspace()
      supabaseSesion = ws.supabase
      return ws.error ? null : ws.workspaceId
    },
    async cobroDelWorkspace(cobroId, workspaceId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabaseSesion as any)
        .from('cobros')
        .select('soporte, siigo_recibo')
        .eq('id', cobroId)
        .eq('workspace_id', workspaceId)
        .maybeSingle()
      return (data ?? null) as FilaCobroArchivo | null
    },
  }
}
