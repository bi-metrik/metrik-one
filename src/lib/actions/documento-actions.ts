'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { getServerKey } from '@/lib/server-keys'
import { extractFieldsFromDocument, type CampoExtraccion, type CampoResultado } from '@/lib/ai/extract-fields'
import { createDriveFolder, uploadFileToDrive, setFilePublicByLink } from '@/lib/google-drive'

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

// ── 1. Upload documento a Drive ──────────────────────────────────────────────

export async function uploadDocumento(
  negocioBloqueId: string,
  negocioId: string,
  formData: FormData,
): Promise<{
  success: boolean
  drive_url?: string
  campos?: Record<string, CampoResultado>
  error?: string
}> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const file = formData.get('file') as File | null
  if (!file) return { success: false, error: 'No se proporcionó archivo' }

  const admin = createServiceClient()

  try {
    // ── 1. Upload temporal a Supabase Storage ──────────────────────────────
    const ext = file.name.split('.').pop()?.toLowerCase() || 'pdf'
    const tempPath = `${workspaceId}/negocios/${negocioId}/${negocioBloqueId}/documento.${ext}`
    const arrayBuf = await file.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)
    const mimeType = file.type || mimeTypeFromName(file.name)

    const { error: uploadError } = await admin.storage
      .from(BUCKET)
      .upload(tempPath, buffer, {
        contentType: mimeType,
        upsert: true,
      })

    if (uploadError) {
      return { success: false, error: `Error subiendo archivo: ${uploadError.message}` }
    }

    // ── 2. Leer config del bloque (label, campos_extraccion) ───────────────
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

    // ── 3. Obtener drive_folder_id del workspace ───────────────────────────
    const { data: workspace } = await db(supabase)
      .from('workspaces')
      .select('drive_folder_id')
      .eq('id', workspaceId)
      .single()

    const driveFolderId = workspace?.drive_folder_id as string | null

    let driveUrl: string | null = null
    let driveFileId: string | null = null

    if (driveFolderId) {
      // ── 4. Crear carpeta del negocio en Drive ────────────────────────────
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
      const negocioFolderId = await createDriveFolder(folderName, driveFolderId)

      // ── 5. Subir archivo a Drive ─────────────────────────────────────────
      const driveFileName = `${label}.${ext}`
      const result = await uploadFileToDrive(buffer, driveFileName, mimeType, negocioFolderId)
      driveFileId = result.fileId
      driveUrl = result.webViewLink

      // ── 6. Hacer accesible por link ──────────────────────────────────────
      await setFilePublicByLink(driveFileId)

      // ── 7. Borrar archivo temporal de Supabase Storage ───────────────────
      await admin.storage.from(BUCKET).remove([tempPath])
    } else {
      // Sin Drive configurado: guardar URL de Supabase Storage
      const { data: publicData } = admin.storage.from(BUCKET).getPublicUrl(tempPath)
      driveUrl = publicData.publicUrl
    }

    // ── 8. Guardar en negocio_bloques.data ─────────────────────────────────
    const currentData = (bloqueData?.data as Record<string, unknown>) ?? {}
    const newData: Record<string, unknown> = {
      ...currentData,
      drive_url: driveUrl,
      drive_file_id: driveFileId,
      file_name: file.name,
      mime_type: mimeType,
      uploaded_at: new Date().toISOString(),
    }

    // ── 9. Extracción AI si hay campos configurados ────────────────────────
    let camposResult: Record<string, CampoResultado> | null = null

    if (camposExtraccion.length > 0) {
      const apiKey = getServerKey('gemini')
      if (apiKey) {
        const extraction = await extractFieldsFromDocument(buffer, mimeType, camposExtraccion, apiKey)
        if (extraction.data) {
          camposResult = extraction.data
          newData.campos = camposResult
        } else if (extraction.error) {
          console.error('[documento-actions] AI extraction error:', extraction.error)
          // No fallar el upload por error de AI — el archivo ya está en Drive
        }
      }
    }

    // ── 10. Determinar si el bloque está completo ──────────────────────────
    let isComplete = true

    if (camposExtraccion.length > 0 && camposResult) {
      // Verificar que todos los campos required tengan valor
      const requiredCampos = camposExtraccion.filter(c => c.required)
      isComplete = requiredCampos.every(c => camposResult![c.slug]?.value !== null)
    }
    // Sin campos AI → completo con solo tener el archivo

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

    // ── 11. Revalidar ─────────────────────────────────────────────────────
    revalidatePath(`/negocios/${negocioId}`)

    return {
      success: true,
      drive_url: driveUrl ?? undefined,
      campos: camposResult ?? undefined,
    }
  } catch (err) {
    console.error('[documento-actions] Error:', err)
    return { success: false, error: `Error: ${String(err).slice(0, 120)}` }
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
