// ============================================================
// ensureNegocioDriveFolder — helper idempotente compartido
//
// Garantiza que un negocio tenga carpeta en Google Drive, sin
// importar la ruta por la que nació (formulario, webhook de Meta,
// carga manual, backfill, cron). Reemplaza la lógica que vivía
// inline en `crearNegocio` (ruta del formulario) — ahora es una
// sola vía reutilizable por todos los orígenes.
//
// Idempotente: si el negocio ya tiene carpeta_url, no toca Drive.
//
// Recibe un client Supabase ya construido → sirve tanto para el
// cliente authed de crearNegocio como para el createServiceClient
// del backfill / cron reconciliador.
//
// Server-only — NEVER import from client components.
// ============================================================

import { createDriveFolder } from '@/lib/google-drive'

// Estructura canónica de subcarpetas — el operador y el cliente
// ven los compartimentos desde el primer día, aunque no haya archivos.
const CARPETAS_INICIALES = [
  '1. Legal',
  '2. Comercial',
  '3. UPME',
  '4. DIAN',
  '5. Otros',
]

export interface EnsureDriveFolderResult {
  created: boolean
  carpeta_url: string | null
  reason?: 'ya_tiene' | 'sin_parent' | 'error' | 'creada'
}

/**
 * Asegura la carpeta de Drive de un negocio.
 *
 * @param supabase  client Supabase ya construido (authed o service role)
 * @param workspaceId  workspace del negocio (para resolver OAuth per-workspace)
 * @param negocioId  id del negocio
 *
 * Comportamiento:
 * - Si el negocio ya tiene `carpeta_url` no-null → { created:false, reason:'ya_tiene' } (no toca Drive).
 * - Resuelve `drive_folder_id` padre: línea del negocio → fallback workspace.
 *   Si NO hay padre → registra activity_log `drive_folder_skipped` y retorna
 *   { created:false, carpeta_url:null, reason:'sin_parent' }.
 * - Crea la carpeta `${codigo} - ${clienteNombre}` + las 5 subcarpetas canónicas,
 *   setea `negocios.carpeta_url` y retorna { created:true, carpeta_url }.
 * - En error de Drive → registra activity_log `drive_folder_failed` y retorna
 *   { created:false, reason:'error' } (el error queda visible en el timeline).
 */
export async function ensureNegocioDriveFolder(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  workspaceId: string,
  negocioId: string,
): Promise<EnsureDriveFolderResult> {
  // ── 0. Leer el negocio (idempotencia + datos para el nombre) ──
  const { data: negocioRaw, error: negErr } = await supabase
    .from('negocios')
    .select('id, linea_id, carpeta_url, codigo, nombre, empresas(nombre), contactos(nombre)')
    .eq('id', negocioId)
    .single()

  if (negErr || !negocioRaw) {
    const msg = negErr?.message ?? 'negocio no encontrado'
    console.error(`[ensureNegocioDriveFolder] no se pudo leer negocio ${negocioId}:`, msg)
    return { created: false, carpeta_url: null, reason: 'error' }
  }

  const neg = negocioRaw as {
    id: string
    linea_id: string | null
    carpeta_url: string | null
    codigo: string | null
    nombre: string | null
    empresas: { nombre: string } | null
    contactos: { nombre: string } | null
  }

  // ── 1. Idempotencia: ya tiene carpeta → no tocar Drive ──
  if (neg.carpeta_url) {
    return { created: false, carpeta_url: neg.carpeta_url, reason: 'ya_tiene' }
  }

  // ── 2. Resolver drive_folder_id padre: línea → fallback workspace ──
  let driveFolderId: string | null = null

  if (neg.linea_id) {
    const { data: lineaDrive } = await supabase
      .from('lineas_negocio')
      .select('drive_folder_id')
      .eq('id', neg.linea_id)
      .single()
    driveFolderId = (lineaDrive as { drive_folder_id: string | null } | null)?.drive_folder_id ?? null
  }

  if (!driveFolderId) {
    const { data: wsData } = await supabase
      .from('workspaces')
      .select('drive_folder_id')
      .eq('id', workspaceId)
      .single()
    driveFolderId = (wsData as { drive_folder_id: string | null } | null)?.drive_folder_id ?? null
  }

  // Sin padre → NO crear (esto reemplaza el skip silencioso del código inline).
  if (!driveFolderId) {
    try {
      await supabase.from('activity_log').insert({
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        tipo: 'drive_folder_skipped',
        contenido: 'sin drive_folder_id padre (linea/workspace)',
      })
    } catch (logErr) {
      console.error('[ensureNegocioDriveFolder] no se pudo registrar drive_folder_skipped:', logErr)
    }
    return { created: false, carpeta_url: null, reason: 'sin_parent' }
  }

  // ── 3. Crear carpeta + subcarpetas + setear carpeta_url ──
  try {
    const codigo = neg.codigo ?? neg.id.slice(0, 8)
    const clienteNombre = neg.empresas?.nombre ?? neg.contactos?.nombre ?? neg.nombre ?? codigo
    const folderName = `${codigo} - ${clienteNombre}`

    const folderId = await createDriveFolder(folderName, driveFolderId, workspaceId)
    const folderUrl = `https://drive.google.com/drive/folders/${folderId}`

    for (const carpeta of CARPETAS_INICIALES) {
      try {
        await createDriveFolder(carpeta, folderId, workspaceId)
      } catch (err) {
        // No bloquea si una subcarpeta falla — la carpeta raíz ya existe.
        console.warn(
          `[ensureNegocioDriveFolder] no se pudo pre-crear "${carpeta}" (negocio=${negocioId}):`,
          err instanceof Error ? err.message : err,
        )
      }
    }

    await supabase
      .from('negocios')
      .update({ carpeta_url: folderUrl })
      .eq('id', negocioId)

    return { created: true, carpeta_url: folderUrl, reason: 'creada' }
  } catch (driveErr) {
    const msg = driveErr instanceof Error ? driveErr.message : String(driveErr)
    console.error(
      `[ensureNegocioDriveFolder] Error creando carpeta Drive (workspace=${workspaceId}, negocio=${negocioId}):`,
      msg,
    )
    try {
      await supabase.from('activity_log').insert({
        workspace_id: workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: negocioId,
        tipo: 'drive_folder_failed',
        contenido: `Error creando carpeta en Drive: ${msg.slice(0, 500)}`,
      })
    } catch (logErr) {
      console.error('[ensureNegocioDriveFolder] no se pudo registrar drive_folder_failed:', logErr)
    }
    return { created: false, carpeta_url: null, reason: 'error' }
  }
}
