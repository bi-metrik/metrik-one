/**
 * La referencia de un archivo del catálogo de fotos: `one://fotos-catalogo/<workspace>/<tipo>/<huella>.jpg`.
 * Puro. El bucket es privado y solo lo toca el servidor (`catalogo-almacen.ts`).
 *
 * ⚠️ No está en `BUCKETS_ONE` (`almacenamiento/referencia.ts`) a propósito: así `/api/archivos/abrir`
 * no la abre. Una foto del catálogo solo sale firmada desde la acción que ya revisó el workspace.
 */
import type { TipoFoto } from './clave'

export const BUCKET_CATALOGO = 'fotos-catalogo'
const PREFIJO = `one://${BUCKET_CATALOGO}/`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

export function rutaDeCatalogo(workspaceId: string, tipo: TipoFoto, huella: string): string {
  return `${workspaceId.toLowerCase()}/${tipo}/${huella}.jpg`
}

export function referenciaDeCatalogo(ruta: string): string {
  return `${PREFIJO}${ruta}`
}

/**
 * La ruta de una referencia, SOLO si es de ese workspace y tiene la forma de las que escribe ONE.
 * Cualquier otra cosa (otro workspace, `..`, otro bucket) es `null`.
 */
export function rutaDeReferencia(ref: unknown, workspaceId: string | null | undefined): string | null {
  if (typeof ref !== 'string' || !ref.startsWith(PREFIJO) || !workspaceId) return null
  const ruta = ref.slice(PREFIJO.length)
  const partes = ruta.split('/')
  if (partes.length !== 3) return null
  const [ws, tipo, archivo] = partes
  if (!UUID.test(ws) || ws !== workspaceId.toLowerCase()) return null
  if (tipo !== 'ciudad' && tipo !== 'hotel' && tipo !== 'actividad') return null
  if (!/^[0-9a-f]{16,64}\.jpg$/.test(archivo)) return null
  return ruta
}
