import 'server-only'

/**
 * Los archivos del catálogo de fotos, en el bucket PRIVADO `fotos-catalogo` del proyecto de ONE
 * (migración `20261014221500_fotos_catalogo.sql`). Solo el servidor, con el cliente de servicio,
 * y solo después de que la acción revisó la sesión y el workspace: como `almacenamiento/one.ts`.
 *
 * Cada foto se guarda ya preparada para el documento: JPEG, a lo sumo `ANCHO_GUARDADO` px de ancho.
 * La huella del contenido va en el nombre: la misma foto subida dos veces es un solo archivo.
 */
import { createHash } from 'node:crypto'
import sharp from 'sharp'

import { createServiceClient } from '@/lib/supabase/server'
import type { TipoFoto } from './clave'
import { BUCKET_CATALOGO, referenciaDeCatalogo, rutaDeCatalogo, rutaDeReferencia } from './referencia-catalogo'

/** El tope del bucket (`file_size_limit` de la migración). */
export const BYTES_MAXIMOS_CATALOGO = 5_000_000
/** Lo que pesa de más una foto que llega para guardarse (antes de reducirla). */
export const BYTES_MAXIMOS_ENTRADA = 15_000_000
export const ANCHO_GUARDADO = 1600

export interface FotoPreparada {
  buffer: Buffer
  ancho: number
  alto: number
}

/** La foto lista para guardar: girada según su EXIF, a `ANCHO_GUARDADO` px y JPEG. `null` si no es una imagen. */
export async function prepararFoto(datos: Buffer): Promise<FotoPreparada | null> {
  if (datos.length === 0 || datos.length > BYTES_MAXIMOS_ENTRADA) return null
  try {
    const { data, info } = await sharp(datos)
      .rotate()
      .resize({ width: ANCHO_GUARDADO, withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer({ resolveWithObject: true })
    if (data.length > BYTES_MAXIMOS_CATALOGO || !info.width || !info.height) return null
    return { buffer: data, ancho: info.width, alto: info.height }
  } catch {
    return null
  }
}

function bucket() {
  return createServiceClient().storage.from(BUCKET_CATALOGO)
}

/** Guarda la foto (ya preparada) y devuelve su referencia `one://fotos-catalogo/…`. Lanza si no pudo. */
export async function guardarEnCatalogo(workspaceId: string, tipo: TipoFoto, foto: FotoPreparada): Promise<string> {
  const huella = createHash('sha256').update(foto.buffer).digest('hex').slice(0, 32)
  const ruta = rutaDeCatalogo(workspaceId, tipo, huella)
  const { error } = await bucket().upload(ruta, foto.buffer, { contentType: 'image/jpeg', upsert: true })
  if (error) throw new Error(`No se pudo guardar la foto: ${error.message}`)
  return referenciaDeCatalogo(ruta)
}

/** Los bytes de una foto del catálogo de ESE workspace; `null` si la referencia no es suya o no se pudo leer. */
export async function bytesDeCatalogo(workspaceId: string, ref: string): Promise<Buffer | null> {
  const ruta = rutaDeReferencia(ref, workspaceId)
  if (!ruta) return null
  try {
    const { data, error } = await bucket().download(ruta)
    if (error || !data) return null
    return Buffer.from(await data.arrayBuffer())
  } catch {
    return null
  }
}

/** Un enlace firmado corto para verla en la pantalla. */
export async function enlaceDeCatalogo(workspaceId: string, ref: string, segundos = 300): Promise<string | null> {
  const ruta = rutaDeReferencia(ref, workspaceId)
  if (!ruta) return null
  try {
    const { data, error } = await bucket().createSignedUrl(ruta, segundos)
    return error ? null : data?.signedUrl ?? null
  } catch {
    return null
  }
}

/** Borra el archivo. Best-effort: un archivo huérfano no le hace daño a nadie. */
export async function borrarDeCatalogo(workspaceId: string, ref: string | null | undefined): Promise<void> {
  const ruta = rutaDeReferencia(ref, workspaceId)
  if (!ruta) return
  try {
    await bucket().remove([ruta])
  } catch (e) {
    console.warn('[fotos-catalogo] no se pudo borrar un archivo:', e instanceof Error ? e.message : e)
  }
}
