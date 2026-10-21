/**
 * Los archivos de un proveedor (tarifarios y certificados bancarios) en el bucket PRIVADO
 * `fotos-catalogo`, con su propio prefijo: `<workspace>/proveedores/<proveedor>/<clase>/<huella>.<ext>`.
 * Puro.
 *
 * La referencia se guarda como `one://fotos-catalogo/<ruta>`. No se cruza con las fotos: la ruta de
 * una foto tiene 3 partes (`<ws>/<tipo>/<huella>.jpg`) y `rutaDeReferencia` de las fotos rechaza
 * esta (5 partes); y al revés, esta función rechaza la de una foto. Como las fotos, NO está en
 * `BUCKETS_ONE`: `/api/archivos/abrir` no la abre; solo sale firmada desde la acción que revisó el
 * workspace (y, para el certificado, el permiso financiero).
 */
import { BUCKET_CATALOGO } from '@/lib/fotos/referencia-catalogo'

export const BUCKET_PROVEEDORES = BUCKET_CATALOGO
const PREFIJO = `one://${BUCKET_PROVEEDORES}/`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export type ClaseArchivo = 'tarifarios' | 'cuentas'

/** Lo que se acepta subir: PDF o imagen. */
export const MIME_ARCHIVO: Record<string, string> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

/** El tope del bucket después de la migración (`file_size_limit`). */
export const BYTES_MAXIMOS_ARCHIVO = 20_000_000

export function extensionDeMime(mime: unknown): string | null {
  return typeof mime === 'string' ? MIME_ARCHIVO[mime.toLowerCase()] ?? null : null
}

export function rutaDeArchivo(workspaceId: string, proveedorId: string, clase: ClaseArchivo, huella: string, ext: string): string {
  return `${workspaceId.toLowerCase()}/proveedores/${proveedorId.toLowerCase()}/${clase}/${huella}.${ext}`
}

export function referenciaDeArchivo(ruta: string): string {
  return `${PREFIJO}${ruta}`
}

/**
 * La ruta (sin `one://bucket/`) SOLO si es de ese workspace, de ese proveedor y de esa clase, con la
 * forma que escribe ONE. Acepta la ruta sola o la referencia. Cualquier otra cosa → `null`.
 */
export function rutaValida(refORuta: unknown, workspaceId: string | null | undefined, proveedorId: string | null | undefined, clase: ClaseArchivo): string | null {
  if (typeof refORuta !== 'string' || !workspaceId || !proveedorId) return null
  const ruta = refORuta.startsWith(PREFIJO) ? refORuta.slice(PREFIJO.length) : refORuta
  const partes = ruta.split('/')
  if (partes.length !== 5) return null
  const [ws, seccion, prov, cl, archivo] = partes
  if (!UUID.test(ws) || ws !== workspaceId.toLowerCase()) return null
  if (seccion !== 'proveedores' || prov !== proveedorId.toLowerCase() || !UUID.test(prov) || cl !== clase) return null
  if (!/^[0-9a-f]{16,64}\.(pdf|jpg|png|webp)$/.test(archivo)) return null
  return ruta
}
