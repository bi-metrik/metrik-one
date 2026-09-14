'use server'

// ============================================================
// Subida directa desde el navegador al almacenamiento externo del workspace.
//
// El navegador NUNCA recibe la llave: recibe una URL firmada de subida para UNA ruta
// pendiente dentro del prefijo del negocio (`negocios/<id>/_pendientes/...`) y hace el
// PUT directo al proyecto del cliente. Así el archivo no pasa ni un segundo por el
// bucket público de ONE (`ve-documentos`) ni por los 4,5 MB de cuerpo de una función.
// Confirmar la subida la mueve a su nombre definitivo (`procesarDocumento`).
//
// ⚠️ 'use server': solo funciones async exportadas. Nada de constantes ni re-export de
// tipos (PR #452).
// ============================================================

import { getWorkspace } from '@/lib/actions/get-workspace'
import { guardEditarBloque } from '@/lib/permissions/guard-negocio'
import { almacenamientoExternoDe } from '@/lib/almacenamiento/supabase-externo'
import { esRutaPendienteDe, parsearReferencia, rutaPendiente } from '@/lib/almacenamiento/referencia'

const EXTENSIONES_PERMITIDAS = new Set(['pdf', 'jpg', 'jpeg', 'png', 'webp'])

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

type Resultado<T> = ({ ok: true } & T) | { ok: false; error: string }

/** El bloque existe, es del negocio indicado y el negocio es del workspace de la sesión. */
async function bloqueDelNegocio(
  supabase: unknown,
  workspaceId: string,
  negocioBloqueId: string,
  negocioId: string,
): Promise<boolean> {
  const { data } = await db(supabase)
    .from('negocio_bloques')
    .select('negocio_id, negocios!inner(workspace_id)')
    .eq('id', negocioBloqueId)
    .maybeSingle()
  const negocio = (data?.negocio_id as string | undefined)?.toLowerCase()
  const ws = (data?.negocios as { workspace_id?: string } | null)?.workspace_id
  return negocio === negocioId.toLowerCase() && ws === workspaceId
}

export async function prepararSubidaExterna(
  negocioBloqueId: string,
  negocioId: string,
  extension: string,
): Promise<Resultado<{ signedUrl: string; referencia: string }>> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }

  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) return { ok: false, error: guard.error ?? 'Sin permiso' }

  const ext = extension.toLowerCase().replace(/^\./, '')
  if (!EXTENSIONES_PERMITIDAS.has(ext)) return { ok: false, error: 'Solo PDF, JPG, PNG o WebP' }

  if (!(await bloqueDelNegocio(supabase, workspaceId, negocioBloqueId, negocioId))) {
    return { ok: false, error: 'Bloque no encontrado en este negocio' }
  }

  try {
    const almacenamiento = await almacenamientoExternoDe(workspaceId)
    if (!almacenamiento) {
      return { ok: false, error: 'Este espacio guarda sus archivos en Google Drive' }
    }
    const path = rutaPendiente(negocioId, negocioBloqueId, ext, Date.now())
    const { signedUrl, referencia } = await almacenamiento.urlSubida(path)
    return { ok: true, signedUrl, referencia }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/** Borra una subida pendiente que el usuario canceló antes de confirmar. */
export async function descartarSubidaExterna(
  negocioBloqueId: string,
  negocioId: string,
  referencia: string,
): Promise<Resultado<object>> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: 'No autenticado' }

  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) return { ok: false, error: guard.error ?? 'Sin permiso' }

  // Solo se descarta lo PENDIENTE de este negocio: nunca un archivo ya confirmado.
  const partes = parsearReferencia(referencia)
  if (!partes || !esRutaPendienteDe(partes.path, negocioId)) {
    return { ok: false, error: 'Referencia no descartable' }
  }
  if (!(await bloqueDelNegocio(supabase, workspaceId, negocioBloqueId, negocioId))) {
    return { ok: false, error: 'Bloque no encontrado en este negocio' }
  }

  try {
    const almacenamiento = await almacenamientoExternoDe(workspaceId)
    if (!almacenamiento) return { ok: false, error: 'Este espacio guarda sus archivos en Google Drive' }
    await almacenamiento.borrar(referencia)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
