'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createDriveFolder, uploadFileToDrive } from '@/lib/google-drive'
import { revalidatePath } from 'next/cache'

const SUBFOLDER_PILA = 'PILA'

type ActionResult<T = void> =
  | { success: true; data?: T }
  | { success: false; error: string }

export type PlanillaPilaRow = {
  id: string
  anio: number
  mes: number
  file_drive_url: string
  monto_aportado: number | null
  uploaded_at: string
}

/**
 * Lista planillas PILA cargadas en el workspace para un anio dado.
 */
export async function listPlanillasPila(anio: number): Promise<PlanillaPilaRow[]> {
  const { supabase, workspaceId } = await getWorkspace()
  if (!workspaceId) return []

  const { data } = await supabase
    .from('planillas_pila_periodo')
    .select('id, anio, mes, file_drive_url, monto_aportado, uploaded_at')
    .eq('workspace_id', workspaceId)
    .eq('anio', anio)
    .order('mes', { ascending: true })

  return (data as PlanillaPilaRow[] | null) ?? []
}

/**
 * Sube una planilla PILA a Drive y registra en planillas_pila_periodo.
 *
 * Idempotente: si ya existe para ese (workspace, anio, mes), reemplaza.
 *
 * Estructura Drive:
 *   {workspace_root}/PILA/{anio}/PILA-{anio}-{mes}.pdf
 */
export async function uploadPlanillaPila(formData: FormData): Promise<ActionResult> {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  if (role !== 'owner' && role !== 'admin') {
    return { success: false, error: 'Solo owner o admin pueden cargar PILA' }
  }

  const anio = parseInt(String(formData.get('anio') ?? ''), 10)
  const mes = parseInt(String(formData.get('mes') ?? ''), 10)
  const montoRaw = formData.get('monto_aportado')
  const file = formData.get('file') as File | null

  if (!anio || anio < 2026 || anio > 2100) return { success: false, error: 'Anio inválido' }
  if (!mes || mes < 1 || mes > 12) return { success: false, error: 'Mes inválido' }
  if (!file) return { success: false, error: 'Falta archivo' }

  // Validar mime type
  const mime = file.type
  if (mime !== 'application/pdf' && !mime.startsWith('image/')) {
    return { success: false, error: 'Solo PDF o imágenes' }
  }

  // Validar tamaño (max 10MB)
  if (file.size > 10 * 1024 * 1024) {
    return { success: false, error: 'Archivo demasiado grande (máx 10MB)' }
  }

  const monto = montoRaw ? Number(montoRaw) : null
  if (monto !== null && (isNaN(monto) || monto < 0)) {
    return { success: false, error: 'Monto inválido' }
  }

  // Resolver workspace drive_folder_id
  const { data: ws } = await supabase
    .from('workspaces')
    .select('drive_folder_id')
    .eq('id', workspaceId)
    .single()
  const wsRootFolderId = (ws as { drive_folder_id: string | null } | null)?.drive_folder_id
  if (!wsRootFolderId) {
    return { success: false, error: 'Workspace no tiene drive_folder_id configurado' }
  }

  try {
    // Subcarpeta PILA/anio
    const pilaFolderId = await createDriveFolder(SUBFOLDER_PILA, wsRootFolderId, workspaceId)
    const anioFolderId = await createDriveFolder(String(anio), pilaFolderId, workspaceId)

    const ext = mime === 'application/pdf' ? 'pdf' : (file.name.split('.').pop() ?? 'png')
    const fileName = `PILA-${anio}-${String(mes).padStart(2, '0')}.${ext}`

    const buffer = Buffer.from(await file.arrayBuffer())
    const uploaded = await uploadFileToDrive(buffer, fileName, mime, anioFolderId, workspaceId)

    // Upsert en planillas_pila_periodo
    const { data: existing } = await supabase
      .from('planillas_pila_periodo')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('anio', anio)
      .eq('mes', mes)
      .maybeSingle()

    if (existing) {
      await supabase
        .from('planillas_pila_periodo')
        .update({
          file_drive_id: uploaded.fileId,
          file_drive_url: uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.fileId}/view`,
          monto_aportado: monto,
          uploaded_at: new Date().toISOString(),
          uploaded_by: userId,
        })
        .eq('id', (existing as { id: string }).id)
    } else {
      await supabase.from('planillas_pila_periodo').insert({
        workspace_id: workspaceId,
        anio,
        mes,
        file_drive_id: uploaded.fileId,
        file_drive_url: uploaded.webViewLink ?? `https://drive.google.com/file/d/${uploaded.fileId}/view`,
        monto_aportado: monto,
        uploaded_by: userId,
      })
    }

    revalidatePath('/mi-negocio')
    return { success: true }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { success: false, error: `Error subiendo a Drive: ${msg}` }
  }
}

/**
 * Elimina referencia de planilla PILA (no borra el archivo en Drive, solo el link).
 */
export async function deletePlanillaPila(planillaId: string): Promise<ActionResult> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  if (role !== 'owner' && role !== 'admin') {
    return { success: false, error: 'Solo owner o admin pueden eliminar' }
  }

  const { error: delErr } = await supabase
    .from('planillas_pila_periodo')
    .delete()
    .eq('id', planillaId)
    .eq('workspace_id', workspaceId)

  if (delErr) return { success: false, error: delErr.message }

  revalidatePath('/mi-negocio')
  return { success: true }
}
