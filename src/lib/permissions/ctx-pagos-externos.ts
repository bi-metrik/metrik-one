import 'server-only'

import { getWorkspace } from '@/lib/actions/get-workspace'
import {
  puedeGestionarPagosExternos,
  type Area,
  type Role,
  type UserContext,
} from './can-edit'

/**
 * Contexto autorizado para operar pagos que NO entraron por la pasarela.
 *
 * El criterio NO vive aqui: vive en `puedeGestionarPagosExternos` (can-edit.ts), y de
 * ahi lo consumen tanto este guard como la pantalla. Este modulo solo resuelve la
 * sesion y aplica esa unica funcion.
 */
export interface CtxPagosExternos {
  ok: true
  supabase: unknown
  workspaceId: string
  /** profiles.id — el que va a `cobros.created_by` y `cobros.anulado_por`. */
  userId: string
  /** staff.id — el que va a `activity_log.autor_id`. Son tablas distintas. */
  staffId: string | null
  user: UserContext
}

export async function ctxPagosExternos(): Promise<
  CtxPagosExternos | { ok: false; error: string }
> {
  const { supabase, workspaceId, userId, staffId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId || !userId) {
    return { ok: false, error: error ?? 'No autenticado' }
  }
  const user: UserContext = {
    id: staffId ?? '',
    role: (role ?? 'read_only') as Role,
    areas: (areas ?? []) as Area[],
  }
  if (!puedeGestionarPagosExternos(user)) {
    return {
      ok: false,
      error: 'Solo el area financiera (o administracion) puede registrar, corregir o anular pagos fuera de la pasarela.',
    }
  }
  return { ok: true, supabase, workspaceId, userId, staffId, user }
}
