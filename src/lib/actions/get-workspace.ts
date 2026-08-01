'use server'

import { getWorkspaceCached } from './get-workspace-impl'

/**
 * Helper compartido para obtener workspace_id del usuario autenticado.
 * La logica vive en `get-workspace-impl.ts`, deduplicada por request.
 */
export async function getWorkspace() {
  return getWorkspaceCached()
}
