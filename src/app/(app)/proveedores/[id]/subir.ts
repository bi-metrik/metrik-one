'use client'

import { BUCKET_PROVEEDORES, BYTES_MAXIMOS_ARCHIVO, extensionDeMime, type ClaseArchivo } from '@/lib/proveedores/archivos'
import { createClient } from '@/lib/supabase/client'
import { pedirSubida } from '../actions'

/**
 * Sube UN archivo del proveedor directo al bucket con la URL firmada que da el servidor (un PDF de
 * 20 MB no cabe en el cuerpo de una acción). Devuelve la ruta para registrarlo, o el error en llano.
 */
export async function subirArchivoProveedor(proveedorId: string, clase: ClaseArchivo, archivo: File): Promise<{ ok: true; ruta: string } | { ok: false; error: string }> {
  if (!extensionDeMime(archivo.type)) return { ok: false, error: 'Sube un PDF o una imagen (JPG, PNG).' }
  if (archivo.size > BYTES_MAXIMOS_ARCHIVO) return { ok: false, error: 'El archivo pesa más de 20 MB.' }
  const p = await pedirSubida(proveedorId, clase, archivo.type, archivo.size)
  if (!p.ok) return p
  const { error } = await createClient().storage.from(BUCKET_PROVEEDORES).uploadToSignedUrl(p.ruta, p.token, archivo, { contentType: archivo.type })
  if (error) return { ok: false, error: 'No se pudo subir el archivo. Revisa la conexión y vuelve a intentarlo.' }
  return { ok: true, ruta: p.ruta }
}
