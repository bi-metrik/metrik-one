import 'server-only'

/**
 * El soporte de un pago: el comprobante que el usuario adjunta cuando registra plata
 * que entró.
 *
 * Vive aparte de `actions/pagos-externos.ts` porque ya son DOS las superficies que lo
 * necesitan: el panel de pagos externos de /conciliacion, donde es obligatorio, y el
 * modal de "Registrar pago" del FAB, donde es opcional. Copiarlo habría dejado dos
 * comprobaciones de path y dos caminos a Drive que se separan al primer arreglo.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { createSubfolderPath, uploadFileToDrive, setFilePublicByLink } from '@/lib/google-drive'

/** Bucket que ya usa el producto para documentos de negocio. No se inventa otro. */
const BUCKET = 've-documentos'

/** Lo que el navegador acepta subir como comprobante. */
export const TIPOS_SOPORTE_PAGO = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

export interface SoporteSubidoInput {
  /** Path dentro del bucket `ve-documentos`. Lo sube el navegador, como los documentos. */
  storage_path: string
  file_name: string
  mime_type?: string
}

/**
 * Empuja el soporte del navegador (ya en Storage) a la carpeta del negocio en Drive.
 * Misma mecanica que `pushDocumentoBloqueToDrive`: no se inventa una via nueva.
 *
 * Si Drive falla, el soporte NO se pierde: queda la URL publica de Storage y la fila
 * lo declara como pendiente de archivar. Perder el registro del pago porque Drive no
 * respondio seria peor que archivarlo despues.
 */
export async function archivarSoporte(
  supabase: unknown,
  workspaceId: string,
  negocioId: string,
  entrada: SoporteSubidoInput,
  subcarpeta: string | null,
  userId: string,
): Promise<Record<string, unknown> | null> {
  const storagePath = entrada.storage_path
  // El path llega del navegador y abajo se lee con el cliente de servicio, que NO pasa
  // por RLS. Sin esta comprobacion, un path apuntado a otro workspace terminaria
  // archivado como soporte propio. La policy del bucket exige el mismo prefijo.
  if (!storagePath.startsWith(`${workspaceId}/`) || storagePath.includes('..')) {
    console.warn('[pagos-externos] soporte con path fuera del workspace, descartado')
    return null
  }

  const admin = createServiceClient()
  const fileName = entrada.file_name || storagePath.split('/').pop() || 'soporte'
  const mimeType = entrada.mime_type || mimeDesdeNombre(fileName)

  const { data: publicData } = admin.storage.from(BUCKET).getPublicUrl(storagePath)
  const base: Record<string, unknown> = {
    url: publicData?.publicUrl ?? '',
    file_name: fileName,
    mime_type: mimeType,
    storage_path: storagePath,
    drive_file_id: null,
    subido_por: userId,
    subido_en: new Date().toISOString(),
  }
  if (!base.url) return null

  const { data: negRaw } = await db(supabase)
    .from('negocios')
    .select('carpeta_url, codigo')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const carpetaUrl = (negRaw as { carpeta_url: string | null } | null)?.carpeta_url ?? null
  const folderId = carpetaUrl?.match(/folders\/([-\w]+)/)?.[1] ?? null
  if (!folderId) return base // sin carpeta del negocio: queda en Storage, declarado.

  try {
    const { data: fileData, error: dlErr } = await admin.storage.from(BUCKET).download(storagePath)
    if (dlErr || !fileData) return base
    const buffer = Buffer.from(await fileData.arrayBuffer())
    const targetFolderId = await createSubfolderPath(subcarpeta, folderId, workspaceId)
    const subido = await uploadFileToDrive(buffer, fileName, mimeType, targetFolderId, workspaceId)
    await setFilePublicByLink(subido.fileId, workspaceId)
    return { ...base, url: subido.webViewLink, drive_file_id: subido.fileId }
  } catch (err) {
    console.warn(
      '[pagos-externos] soporte quedo en Storage, Drive no respondio:',
      err instanceof Error ? err.message : String(err),
    )
    return base
  }
}

function mimeDesdeNombre(fileName: string): string {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    pdf: 'application/pdf',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
  }
  return map[ext] ?? 'application/octet-stream'
}
