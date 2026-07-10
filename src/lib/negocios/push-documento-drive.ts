// ============================================================
// pushDocumentoBloqueToDrive — helper idempotente compartido
//
// Empuja a Google Drive un documento que quedó atascado en Supabase
// Storage porque el negocio no tenía carpeta de Drive al momento de
// subirlo. Lo organiza dentro de la carpeta del negocio, en su
// subcarpeta canónica (`config_extra.drive_subfolder`), con su nombre
// definido (`config_extra.label`), y borra el temporal de Storage.
//
// Reproduce fielmente la mecánica de push que ya vive en
// `documento-actions.ts` (pasos 4a-7 de procesarDocumento). No refactoriza
// ese flujo de upload (está entrelazado con extracción AI, cross-check,
// etc.); replica solo la parte de push, aceptando una pequeña duplicación
// a cambio de no arriesgar el path de carga en vivo.
//
// Idempotente:
//  - Si el bloque ya está en Drive (drive_file_id seteado o drive_url
//    es drive.google.com) → { pushed:false, reason:'ya_en_drive' }.
//  - Si el negocio no tiene carpeta_url → { pushed:false, reason:'sin_carpeta' }
//    (el reconciliador de carpetas lo resolverá primero).
//  - Si drive_url no es una URL de Storage → { pushed:false, reason:'sin_storage' }.
//
// Recibe un client Supabase ya construido (authed o service role) →
// sirve tanto para el backfill como para el cron reconciliador.
//
// Server-only — NEVER import from client components.
// ============================================================

import {
  createSubfolderPath,
  uploadFileToDrive,
  setFilePublicByLink,
} from '@/lib/google-drive'

const BUCKET = 've-documentos'

export interface PushDocumentoResult {
  pushed: boolean
  drive_url?: string
  reason?: 'ya_en_drive' | 'sin_carpeta' | 'sin_storage' | 'sin_url' | 'no_encontrado' | 'error'
}

function mimeTypeFromName(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  }
  return map[ext] ?? 'application/pdf'
}

/**
 * Deriva el storage path (relativo al bucket) desde una URL pública de
 * Supabase Storage. Ambas formas de URL pública contienen el bucket:
 *   .../storage/v1/object/public/ve-documentos/<path>
 *   .../storage/v1/object/ve-documentos/<path>
 * Devuelve null si la URL no pertenece al bucket.
 */
function storagePathFromUrl(url: string): string | null {
  const marker = `/${BUCKET}/`
  const idx = url.indexOf(marker)
  if (idx === -1) return null
  const raw = url.slice(idx + marker.length)
  // Quitar querystring/fragmento y decodificar (nombres con espacios/acentos).
  const clean = raw.split('?')[0].split('#')[0]
  try {
    return decodeURIComponent(clean)
  } catch {
    return clean
  }
}

/**
 * Empuja un bloque `documento` atascado en Storage a la carpeta de Drive
 * del negocio, con su nombre y subcarpeta definidos.
 *
 * @param supabase  client Supabase ya construido (authed o service role)
 * @param workspaceId  workspace del negocio (para resolver OAuth per-workspace)
 * @param negocioBloqueId  id de la instancia del bloque (negocio_bloques.id)
 */
export async function pushDocumentoBloqueToDrive(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
  negocioBloqueId: string,
): Promise<PushDocumentoResult> {
  // ── 0. Leer el bloque + config + negocio ──
  const { data: bloqueRaw, error: bloqueErr } = await supabase
    .from('negocio_bloques')
    .select('id, negocio_id, data, bloque_configs(config_extra), negocios(carpeta_url)')
    .eq('id', negocioBloqueId)
    .single()

  if (bloqueErr || !bloqueRaw) {
    console.error(
      `[pushDocumentoBloqueToDrive] no se pudo leer bloque ${negocioBloqueId}:`,
      bloqueErr?.message ?? 'no encontrado',
    )
    return { pushed: false, reason: 'no_encontrado' }
  }

  const bloque = bloqueRaw as {
    id: string
    negocio_id: string
    data: Record<string, unknown> | null
    bloque_configs: { config_extra: Record<string, unknown> | null } | null
    negocios: { carpeta_url: string | null } | null
  }

  const data = (bloque.data ?? {}) as Record<string, unknown>
  const configExtra = (bloque.bloque_configs?.config_extra ?? {}) as Record<string, unknown>

  const driveUrl = data.drive_url as string | undefined
  const driveFileId = data.drive_file_id as string | null | undefined

  // ── 1. Idempotencia: ya en Drive ──
  if (driveFileId) {
    return { pushed: false, drive_url: driveUrl, reason: 'ya_en_drive' }
  }
  if (typeof driveUrl === 'string' && driveUrl.includes('drive.google.com')) {
    return { pushed: false, drive_url: driveUrl, reason: 'ya_en_drive' }
  }
  if (!driveUrl) {
    // Bloque sin archivo (nunca se cargó nada) → nada que empujar.
    return { pushed: false, reason: 'sin_url' }
  }

  // ── 2. Sólo empujamos si la URL apunta a Storage ──
  const storagePath = storagePathFromUrl(driveUrl)
  if (!storagePath) {
    return { pushed: false, drive_url: driveUrl, reason: 'sin_storage' }
  }

  // ── 3. El negocio debe tener carpeta (el reconciliador de carpetas la crea antes) ──
  const carpetaUrl = bloque.negocios?.carpeta_url ?? null
  const negocioFolderId = carpetaUrl?.match(/folders\/([-\w]+)/)?.[1] ?? null
  if (!negocioFolderId) {
    return { pushed: false, reason: 'sin_carpeta' }
  }

  // ── 4. Resolver nombre + mime ──
  // NO inventar nombres: si no hay label, usar el file_name original.
  const fileName = (data.file_name as string) || storagePath.split('/').pop() || 'documento.pdf'
  const ext = fileName.split('.').pop()?.toLowerCase() || 'pdf'
  const mimeType = (data.mime_type as string) || mimeTypeFromName(fileName)
  const label = (configExtra.label as string | undefined)?.trim()
  const driveFileName = label ? `${label}.${ext}` : fileName

  try {
    // ── 5. Descargar el archivo del bucket ──
    const { data: fileData, error: dlError } = await supabase.storage
      .from(BUCKET)
      .download(storagePath)

    if (dlError || !fileData) {
      console.error(
        `[pushDocumentoBloqueToDrive] descarga de Storage falló (${storagePath}):`,
        dlError?.message ?? 'no data',
      )
      return { pushed: false, reason: 'error' }
    }

    const buffer = Buffer.from(await fileData.arrayBuffer())

    // ── 6. Resolver subcarpeta canónica y subir a Drive ──
    const subfolderPath = (configExtra.drive_subfolder as string | undefined) ?? null
    const targetFolderId = await createSubfolderPath(subfolderPath, negocioFolderId, workspaceId)

    const result = await uploadFileToDrive(buffer, driveFileName, mimeType, targetFolderId, workspaceId)

    // ── 7. Hacer accesible por link (tolera 403 en Shared Drives) ──
    await setFilePublicByLink(result.fileId, workspaceId)

    // ── 8. Actualizar negocio_bloques.data ──
    const newData: Record<string, unknown> = {
      ...data,
      drive_url: result.webViewLink,
      drive_file_id: result.fileId,
    }
    await supabase
      .from('negocio_bloques')
      .update({ data: newData, updated_at: new Date().toISOString() })
      .eq('id', negocioBloqueId)

    // ── 9. Borrar el temporal de Storage ──
    try {
      await supabase.storage.from(BUCKET).remove([storagePath])
    } catch (rmErr) {
      // El archivo ya está en Drive y la data quedó actualizada; el temporal
      // huérfano no rompe nada. No fallamos el push por esto.
      console.warn(
        `[pushDocumentoBloqueToDrive] no se pudo borrar temporal ${storagePath}:`,
        rmErr instanceof Error ? rmErr.message : rmErr,
      )
    }

    return { pushed: true, drive_url: result.webViewLink }
  } catch (err) {
    console.error(
      `[pushDocumentoBloqueToDrive] error empujando bloque ${negocioBloqueId}:`,
      err instanceof Error ? err.message : String(err),
    )
    return { pushed: false, reason: 'error' }
  }
}
