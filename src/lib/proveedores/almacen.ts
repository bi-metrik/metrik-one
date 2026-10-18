import 'server-only'

/**
 * Los archivos de los proveedores (tarifarios y certificados bancarios) en el bucket privado
 * `fotos-catalogo`, prefijo `<ws>/proveedores/`. Solo el servidor, con el cliente de servicio, y
 * solo después de que la acción revisó la sesión, el workspace y el permiso (como las fotos).
 *
 * La subida va DIRECTA del navegador al bucket con una URL firmada de subida (un PDF de 20 MB no
 * cabe en el cuerpo de una función de Vercel). Después la acción confirma que el archivo existe,
 * lo que pesa y su tipo antes de registrarlo.
 */
import { randomBytes } from 'node:crypto'

import { createServiceClient } from '@/lib/supabase/server'
import { BUCKET_PROVEEDORES, BYTES_MAXIMOS_ARCHIVO, MIME_ARCHIVO, referenciaDeArchivo, rutaDeArchivo, rutaValida, type ClaseArchivo } from './archivos'

function bucket() {
  return createServiceClient().storage.from(BUCKET_PROVEEDORES)
}

/** Una URL firmada para que el navegador suba UN archivo a una ruta nueva de ese proveedor. */
export async function urlDeSubida(workspaceId: string, proveedorId: string, clase: ClaseArchivo, ext: string): Promise<{ ok: true; ruta: string; token: string } | { ok: false; error: string }> {
  const ruta = rutaDeArchivo(workspaceId, proveedorId, clase, randomBytes(16).toString('hex'), ext)
  const { data, error } = await bucket().createSignedUploadUrl(ruta)
  if (error || !data?.token) return { ok: false, error: 'No se pudo preparar la subida. Vuelve a intentarlo.' }
  return { ok: true, ruta, token: data.token }
}

/**
 * El archivo que el navegador dice haber subido: SOLO si la ruta es de ese workspace, proveedor y
 * clase, existe, pesa lo permitido y es PDF o imagen. Devuelve su referencia `one://`.
 */
export async function confirmarSubida(
  workspaceId: string,
  proveedorId: string,
  clase: ClaseArchivo,
  rutaPedida: unknown,
): Promise<{ ok: true; ref: string; bytes: number | null; mime: string | null } | { ok: false; error: string }> {
  const ruta = rutaValida(rutaPedida, workspaceId, proveedorId, clase)
  if (!ruta) return { ok: false, error: 'No encontramos el archivo subido. Vuelve a subirlo.' }
  const { data, error } = await bucket().info(ruta)
  if (error || !data) return { ok: false, error: 'No encontramos el archivo subido. Vuelve a subirlo.' }
  const bytes = typeof data.size === 'number' ? data.size : null
  const mime = (data.contentType ?? (data.metadata as { mimetype?: string } | undefined)?.mimetype ?? null)?.toLowerCase() ?? null
  if ((bytes !== null && bytes > BYTES_MAXIMOS_ARCHIVO) || (mime && !MIME_ARCHIVO[mime])) {
    await borrarArchivo(workspaceId, proveedorId, clase, ruta)
    return { ok: false, error: 'Sube un PDF o una imagen de hasta 20 MB.' }
  }
  return { ok: true, ref: referenciaDeArchivo(ruta), bytes, mime }
}

/** Enlace firmado corto para abrir el archivo. `null` si la referencia no es de ese proveedor. */
export async function enlaceDeArchivo(workspaceId: string, proveedorId: string, clase: ClaseArchivo, ref: unknown, segundos = 300): Promise<string | null> {
  const ruta = rutaValida(ref, workspaceId, proveedorId, clase)
  if (!ruta) return null
  const { data, error } = await bucket().createSignedUrl(ruta, segundos)
  return error || !data?.signedUrl ? null : data.signedUrl
}

/** Borra el archivo. Best-effort: un huérfano no le hace daño a nadie. */
export async function borrarArchivo(workspaceId: string, proveedorId: string, clase: ClaseArchivo, ref: unknown): Promise<void> {
  const ruta = rutaValida(ref, workspaceId, proveedorId, clase)
  if (!ruta) return
  try {
    await bucket().remove([ruta])
  } catch (e) {
    console.warn('[proveedores] no se pudo borrar un archivo:', e instanceof Error ? e.message : e)
  }
}
