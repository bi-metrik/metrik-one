'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { getServerKey } from '@/lib/server-keys'
import { extractFieldsFromDocument, type CampoExtraccion, type CampoResultado } from '@/lib/ai/extract-fields'
import { createDriveFolder, uploadFileToDrive, setFilePublicByLink, deleteDriveFile, downloadDriveFile } from '@/lib/google-drive'

const BUCKET = 've-documentos'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

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

// ── 1. Procesar documento ya subido a Storage ─────────────────────────────────

/**
 * Server action: procesa un documento que ya fue subido a Supabase Storage
 * desde el cliente. Lee el archivo, sube a Drive, extrae AI, actualiza bloque.
 */
export async function procesarDocumento(
  negocioBloqueId: string,
  negocioId: string,
  storagePath: string,
  fileName: string,
  oldDriveFileId?: string,
): Promise<{
  success: boolean
  drive_url?: string
  campos?: Record<string, CampoResultado>
  error?: string
}> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const admin = createServiceClient()
  const mimeType = mimeTypeFromName(fileName)
  const ext = fileName.split('.').pop()?.toLowerCase() || 'pdf'

  try {
    // ── 1. Descargar archivo de Storage ──────────────────────────────────
    console.log(`[documento] Step 1: downloading ${fileName} from Storage...`)
    const { data: fileData, error: dlError } = await admin.storage
      .from(BUCKET)
      .download(storagePath)

    if (dlError || !fileData) {
      console.error('[documento] Step 1 FAILED:', dlError?.message)
      return { success: false, error: `Error leyendo archivo: ${dlError?.message ?? 'no data'}` }
    }

    const arrayBuf = await fileData.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)
    console.log(`[documento] Step 1 OK: ${(buffer.length / 1024).toFixed(0)}KB`)

    // ── 2. Leer config del bloque (label, campos_extraccion) ────────────
    const { data: bloqueData } = await db(supabase)
      .from('negocio_bloques')
      .select(`
        data,
        bloque_config_id,
        bloque_configs(config_extra)
      `)
      .eq('id', negocioBloqueId)
      .single()

    const configExtra = (bloqueData?.bloque_configs as Record<string, unknown>)?.config_extra as Record<string, unknown> ?? {}
    const label = (configExtra.label as string) ?? 'Documento'
    const camposExtraccion = (configExtra.campos_extraccion ?? []) as CampoExtraccion[]

    // ── 3. Obtener drive_folder_id del workspace ────────────────────────
    const { data: workspace } = await db(supabase)
      .from('workspaces')
      .select('drive_folder_id')
      .eq('id', workspaceId)
      .single()

    const driveFolderId = workspace?.drive_folder_id as string | null
    console.log(`[documento] Step 3 OK: drive_folder_id=${driveFolderId ? 'yes' : 'none'}`)

    let driveUrl: string | null = null
    let driveFileId: string | null = null

    if (driveFolderId) {
      // ── 4. Crear carpeta del negocio en Drive ─────────────────────────
      const { data: negocio } = await db(supabase)
        .from('negocios')
        .select('codigo')
        .eq('id', negocioId)
        .eq('workspace_id', workspaceId)
        .single()

      if (!negocio) {
        return { success: false, error: 'Negocio no encontrado en este workspace' }
      }

      const folderName = (negocio.codigo as string) ?? negocioId
      console.log(`[documento] Step 4: creating Drive folder "${folderName}"...`)
      const negocioFolderId = await createDriveFolder(folderName, driveFolderId)
      console.log(`[documento] Step 4 OK: folder=${negocioFolderId}`)

      // ── 4b. Eliminar archivo anterior de Drive si existe ────────────────
      if (oldDriveFileId) {
        try {
          await deleteDriveFile(oldDriveFileId)
          console.log(`[documento] Step 4b OK: old file ${oldDriveFileId} deleted`)
        } catch (delErr) {
          console.warn('[documento] Step 4b WARN: could not delete old file:', delErr)
          // Continue — don't fail the upload because of a delete failure
        }
      }

      // ── 5. Subir archivo a Drive ──────────────────────────────────────
      const driveFileName = `${label}.${ext}`
      console.log(`[documento] Step 5: uploading "${driveFileName}" to Drive...`)
      const result = await uploadFileToDrive(buffer, driveFileName, mimeType, negocioFolderId)
      driveFileId = result.fileId
      driveUrl = result.webViewLink
      console.log(`[documento] Step 5 OK: fileId=${driveFileId}`)

      // ── 6. Hacer accesible por link ───────────────────────────────────
      await setFilePublicByLink(driveFileId)
      console.log('[documento] Step 6 OK: permissions set')

      // ── 7. Borrar archivo temporal de Supabase Storage ────────────────
      await admin.storage.from(BUCKET).remove([storagePath])
      console.log('[documento] Step 7 OK: temp file removed')
    } else {
      // Sin Drive configurado: guardar URL de Supabase Storage
      const { data: publicData } = admin.storage.from(BUCKET).getPublicUrl(storagePath)
      driveUrl = publicData.publicUrl
    }

    // ── 8. Guardar en negocio_bloques.data ──────────────────────────────
    const currentData = (bloqueData?.data as Record<string, unknown>) ?? {}
    const newData: Record<string, unknown> = {
      ...currentData,
      drive_url: driveUrl,
      drive_file_id: driveFileId,
      file_name: fileName,
      mime_type: mimeType,
      uploaded_at: new Date().toISOString(),
    }

    // ── 9. Extracción AI si hay campos configurados ─────────────────────
    let camposResult: Record<string, CampoResultado> | null = null

    if (camposExtraccion.length > 0) {
      console.log(`[documento] Step 9: AI extraction (${camposExtraccion.length} campos)...`)
      const apiKey = getServerKey('gemini')
      if (apiKey) {
        const extraction = await extractFieldsFromDocument(buffer, mimeType, camposExtraccion, apiKey)
        if (extraction.data) {
          camposResult = extraction.data
          newData.campos = camposResult
          console.log('[documento] Step 9 OK: AI extraction done')
        } else if (extraction.error) {
          console.error('[documento] Step 9 WARN:', extraction.error)
        }
      } else {
        console.warn('[documento] Step 9 SKIP: no gemini API key')
      }
    }

    // ── 10. Determinar si el bloque está completo ───────────────────────
    let isComplete = true

    if (camposExtraccion.length > 0) {
      if (!camposResult) {
        // Extracción AI falló o no hubo key: NO marcar completo, el usuario
        // debe llenar manualmente los campos requeridos.
        isComplete = false
      } else {
        const requiredCampos = camposExtraccion.filter(c => c.required)
        isComplete = requiredCampos.every(c => camposResult![c.slug]?.value !== null)
      }
    }

    if (isComplete) {
      await db(supabase)
        .from('negocio_bloques')
        .update({
          data: newData,
          estado: 'completo',
          completado_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('id', negocioBloqueId)
    } else {
      await db(supabase)
        .from('negocio_bloques')
        .update({
          data: newData,
          updated_at: new Date().toISOString(),
        })
        .eq('id', negocioBloqueId)
    }

    // ── 11. Revalidar ───────────────────────────────────────────────────
    revalidatePath(`/negocios/${negocioId}`)
    console.log('[documento] DONE — all steps completed')

    return {
      success: true,
      drive_url: driveUrl ?? undefined,
      campos: camposResult ?? undefined,
    }
  } catch (err) {
    console.error('[documento-actions] Error:', err)
    return { success: false, error: `Error: ${String(err).slice(0, 200)}` }
  }
}

// ── 1b. Reprocesar AI sobre documento ya subido a Drive ─────────────────────

/**
 * Re-ejecuta la extracción AI sobre el archivo ya guardado en Drive.
 * Útil cuando la AI falló la primera vez, cambió la API key o se ajustó
 * la configuración de campos_extraccion.
 */
export async function reprocesarDocumento(
  negocioBloqueId: string,
  negocioId: string,
): Promise<{
  success: boolean
  campos?: Record<string, CampoResultado>
  error?: string
}> {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  try {
    // 1. Leer bloque + config
    const { data: bloqueData } = await db(supabase)
      .from('negocio_bloques')
      .select('data, bloque_configs(config_extra)')
      .eq('id', negocioBloqueId)
      .single()

    if (!bloqueData) return { success: false, error: 'Bloque no encontrado' }

    const currentData = (bloqueData.data as Record<string, unknown>) ?? {}
    const driveFileId = currentData.drive_file_id as string | undefined
    const fileName = (currentData.file_name as string) ?? 'documento.pdf'

    if (!driveFileId) {
      return { success: false, error: 'No hay archivo en Drive para reprocesar' }
    }

    const configExtra = (bloqueData.bloque_configs as Record<string, unknown>)?.config_extra as Record<string, unknown> ?? {}
    const camposExtraccion = (configExtra.campos_extraccion ?? []) as CampoExtraccion[]

    if (camposExtraccion.length === 0) {
      return { success: false, error: 'Este bloque no tiene campos de extracción configurados' }
    }

    // 2. API key Gemini
    const apiKey = getServerKey('gemini')
    if (!apiKey) return { success: false, error: 'API key de Gemini no configurada' }

    // 3. Descargar archivo de Drive
    console.log(`[reprocesar] Downloading ${driveFileId} from Drive...`)
    const buffer = await downloadDriveFile(driveFileId)
    const mimeType = mimeTypeFromName(fileName)

    // 4. Extraer con AI
    console.log(`[reprocesar] AI extraction (${camposExtraccion.length} campos)...`)
    const extraction = await extractFieldsFromDocument(buffer, mimeType, camposExtraccion, apiKey)
    if (!extraction.data) {
      return { success: false, error: extraction.error ?? 'Error en extracción AI' }
    }

    // 5. Merge con data existente preservando campos manuales
    const existingCampos = (currentData.campos as Record<string, CampoResultado>) ?? {}
    const mergedCampos: Record<string, CampoResultado> = { ...extraction.data }
    for (const [slug, campo] of Object.entries(existingCampos)) {
      if (campo?.manual && campo.value) {
        mergedCampos[slug] = campo
      }
    }

    // 6. Determinar completitud
    const requiredCampos = camposExtraccion.filter(c => c.required)
    const isComplete = requiredCampos.every(c => mergedCampos[c.slug]?.value !== null && mergedCampos[c.slug]?.value !== undefined)

    const now = new Date().toISOString()
    const newData = { ...currentData, campos: mergedCampos }

    await db(supabase)
      .from('negocio_bloques')
      .update({
        data: newData,
        ...(isComplete ? { estado: 'completo', completado_at: now } : { estado: 'pendiente', completado_at: null }),
        updated_at: now,
      })
      .eq('id', negocioBloqueId)

    revalidatePath(`/negocios/${negocioId}`)

    return { success: true, campos: mergedCampos }
  } catch (err) {
    console.error('[reprocesar-documento] Error:', err)
    return { success: false, error: `Error: ${String(err).slice(0, 200)}` }
  }
}

// ── 2. Actualizar campo manualmente ──────────────────────────────────────────

export async function actualizarCampoDocumento(
  negocioBloqueId: string,
  negocioId: string,
  slug: string,
  value: string,
  camposExtraccion: CampoExtraccion[],
): Promise<{ success: boolean; isComplete?: boolean; error?: string }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Validar que slug existe en camposExtraccion
  const slugValido = camposExtraccion.some(c => c.slug === slug)
  if (!slugValido) return { success: false, error: 'Campo no válido' }

  const { data: bloque } = await db(supabase)
    .from('negocio_bloques')
    .select('data')
    .eq('id', negocioBloqueId)
    .single()

  const currentData = (bloque?.data as Record<string, unknown>) ?? {}
  const campos = (currentData.campos as Record<string, CampoResultado>) ?? {}

  // Update the specific field
  campos[slug] = { value: value || null, confidence: 1.0, manual: true }
  currentData.campos = campos

  // Check completeness
  const requiredCampos = camposExtraccion.filter(c => c.required)
  const isComplete = !!currentData.drive_url &&
    requiredCampos.every(c => campos[c.slug]?.value !== null)

  if (isComplete) {
    await db(supabase)
      .from('negocio_bloques')
      .update({
        data: currentData,
        estado: 'completo',
        completado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', negocioBloqueId)
  } else {
    await db(supabase)
      .from('negocio_bloques')
      .update({
        data: currentData,
        updated_at: new Date().toISOString(),
      })
      .eq('id', negocioBloqueId)
  }

  revalidatePath(`/negocios/${negocioId}`)

  return { success: true, isComplete: !!isComplete }
}
