'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { getServerKey } from '@/lib/server-keys'
import { extractFieldsFromDocument, type CampoExtraccion, type CampoResultado } from '@/lib/ai/extract-fields'
import { createDriveFolder, createSubfolderPath, uploadFileToDrive, setFilePublicByLink, deleteDriveFile, downloadDriveFile } from '@/lib/google-drive'

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

// ── Extracción AI con reintento ante fallo transitorio ──────────────────────
// Gemini puede fallar transitoriamente (timeout, 429/5xx, JSON malformado). Un
// solo intento dejaba el bloque en 'pendiente' silenciosamente y bloqueaba el
// gate aunque el documento sí estuviera cargado. Reintentamos una vez con un
// pequeño backoff. NO reintentamos si el contenido fue bloqueado por Gemini
// (falla permanente, no transitoria).
const EXTRACTION_MAX_ATTEMPTS = 2

async function extractWithRetry(
  buffer: Buffer,
  mimeType: string,
  campos: CampoExtraccion[],
  apiKey: string,
  tag: string,
): Promise<{ data: Record<string, CampoResultado> | null; error?: string }> {
  let last: { data: Record<string, CampoResultado> | null; error?: string } = { data: null }
  for (let attempt = 1; attempt <= EXTRACTION_MAX_ATTEMPTS; attempt++) {
    last = await extractFieldsFromDocument(buffer, mimeType, campos, apiKey)
    if (last.data) return last
    if (last.error?.startsWith('Contenido bloqueado')) return last // permanente
    if (attempt < EXTRACTION_MAX_ATTEMPTS) {
      console.warn(`[${tag}] Extracción AI falló (intento ${attempt}/${EXTRACTION_MAX_ATTEMPTS}): ${last.error}. Reintentando...`)
      await new Promise(r => setTimeout(r, 600))
    }
  }
  return last
}

// ── Cross-check: validacion cruzada contra datos extraidos de otros bloques ──
// Cuando config_extra.cross_check.checks esta definido, despues de la extraccion
// AI comparamos los campos extraidos del documento contra los datos persistidos
// en bloques de etapas anteriores (RUT, Factura, etc). Devolvemos un detalle de
// cada match. El gate del bloque solo se cumple si todas las comparaciones pasan.

export type CrossCheckMatchMode = 'exact' | 'tokens' | 'subset' | 'id_prefix'

export type CrossCheckSpec = {
  slug: string
  label: string
  source_etapa_orden: number
  source_bloque_nombre: string
  source_field?: string
  source_fields?: string[]
  source_field_alternatives?: string[]
  join?: string
  match_mode?: CrossCheckMatchMode
}

export type CrossCheckResult = {
  slug: string
  label: string
  expected: string
  extracted: string
  ok: boolean
  mode?: CrossCheckMatchMode
}

function normalizeText(v: unknown): string {
  return String(v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizeId(v: unknown): string {
  return String(v ?? '').replace(/\D/g, '')
}

function tokensOf(s: string): string[] {
  return normalizeText(s).split(/\s+/).filter(Boolean)
}

function compareValues(expected: string, extracted: string, mode: CrossCheckMatchMode = 'exact'): boolean {
  if (!expected || !extracted) return false
  if (mode === 'tokens') {
    const a = tokensOf(expected).sort()
    const b = tokensOf(extracted).sort()
    return a.length > 0 && a.length === b.length && a.every((t, i) => t === b[i])
  }
  if (mode === 'subset') {
    const a = new Set(tokensOf(expected))
    const b = new Set(tokensOf(extracted))
    if (a.size === 0 || b.size === 0) return false
    const bInA = [...b].every(t => a.has(t))
    const aInB = [...a].every(t => b.has(t))
    return bInA || aInB
  }
  if (mode === 'id_prefix') {
    const a = normalizeId(expected)
    const b = normalizeId(extracted)
    if (a.length < 6 || b.length < 6) return false
    return a === b || a.startsWith(b) || b.startsWith(a)
  }
  return normalizeText(expected) === normalizeText(extracted)
}

async function runCrossCheck(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  negocioId: string,
  checks: CrossCheckSpec[],
  camposExtraidos: Record<string, CampoResultado>,
): Promise<{ passed: boolean; results: CrossCheckResult[] }> {
  if (checks.length === 0) return { passed: true, results: [] }

  // Cargar bloques de etapas previas relevantes (solo las que aparecen en checks)
  const ordenesNecesarias = Array.from(new Set(checks.map(c => c.source_etapa_orden)))
  const { data: srcBloques } = await db(supabase)
    .from('negocio_bloques')
    .select('data, bloque_configs!inner(nombre, etapas_negocio!inner(orden))')
    .eq('negocio_id', negocioId)

  // Mapear por (etapa_orden::nombre_lower) -> data
  const dataPorBloque = new Map<string, Record<string, unknown>>()
  for (const row of ((srcBloques ?? []) as Record<string, unknown>[])) {
    const cfg = row.bloque_configs as { nombre?: string; etapas_negocio?: { orden?: number } } | undefined
    const orden = cfg?.etapas_negocio?.orden
    const nombre = cfg?.nombre
    if (typeof orden !== 'number' || !nombre || !ordenesNecesarias.includes(orden)) continue
    const key = `${orden}::${nombre.trim().toLowerCase()}`
    const data = (row.data as Record<string, unknown>) ?? {}
    // Algunos bloques (documento) anidan campos extraidos en data.campos[slug].value
    const flat: Record<string, unknown> = { ...data }
    const camposAnidados = (data.campos as Record<string, { value?: unknown }>) ?? null
    if (camposAnidados) {
      for (const [slug, c] of Object.entries(camposAnidados)) {
        if (flat[slug] === undefined) flat[slug] = c?.value
      }
    }
    dataPorBloque.set(key, flat)
  }

  const results: CrossCheckResult[] = []
  for (const check of checks) {
    const key = `${check.source_etapa_orden}::${check.source_bloque_nombre.trim().toLowerCase()}`
    const srcData = dataPorBloque.get(key) ?? {}
    const extractedRaw = String(camposExtraidos[check.slug]?.value ?? '')

    // Resolver expected: source_fields (concat), source_field_alternatives
    // (probar cada uno y elegir el primero que de match, o el primero no vacio),
    // o source_field.
    let expectedRaw = ''
    let ok = false
    const mode: CrossCheckMatchMode = check.match_mode ?? 'exact'

    if (check.source_fields && check.source_fields.length > 0) {
      const join = check.join ?? ' '
      expectedRaw = check.source_fields.map(f => String(srcData[f] ?? '')).filter(s => s).join(join)
      ok = compareValues(expectedRaw, extractedRaw, mode)
    } else if (check.source_field_alternatives && check.source_field_alternatives.length > 0) {
      // Probar cada alternativa; pasar si CUALQUIERA matchea
      const candidates = check.source_field_alternatives
        .map(f => String(srcData[f] ?? ''))
        .filter(s => s)
      const matched = candidates.find(c => compareValues(c, extractedRaw, mode))
      expectedRaw = matched ?? candidates[0] ?? ''
      ok = !!matched
    } else if (check.source_field) {
      expectedRaw = String(srcData[check.source_field] ?? '')
      ok = compareValues(expectedRaw, extractedRaw, mode)
    }

    results.push({
      slug: check.slug,
      label: check.label,
      expected: expectedRaw,
      extracted: extractedRaw,
      ok,
      mode,
    })
  }

  return { passed: results.every(r => r.ok), results }
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
  extraction_status?: 'ok' | 'failed' | 'no_key'
  extraction_error?: string
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
      const negocioFolderId = await createDriveFolder(folderName, driveFolderId, workspaceId)
      console.log(`[documento] Step 4 OK: folder=${negocioFolderId}`)

      // ── 4a. Resolver subfolder canonico segun config_extra.drive_subfolder ──
      const subfolderPath = (configExtra.drive_subfolder as string | undefined) ?? null
      const targetFolderId = await createSubfolderPath(subfolderPath, negocioFolderId, workspaceId)
      if (subfolderPath) console.log(`[documento] Step 4a OK: subfolder "${subfolderPath}" -> ${targetFolderId}`)

      // ── 4b. Eliminar archivo anterior de Drive si existe ────────────────
      if (oldDriveFileId) {
        try {
          await deleteDriveFile(oldDriveFileId, workspaceId)
          console.log(`[documento] Step 4b OK: old file ${oldDriveFileId} deleted`)
        } catch (delErr) {
          console.warn('[documento] Step 4b WARN: could not delete old file:', delErr)
          // Continue — don't fail the upload because of a delete failure
        }
      }

      // ── 5. Subir archivo a Drive ──────────────────────────────────────
      const driveFileName = `${label}.${ext}`
      console.log(`[documento] Step 5: uploading "${driveFileName}" to Drive...`)
      const result = await uploadFileToDrive(buffer, driveFileName, mimeType, targetFolderId, workspaceId)
      driveFileId = result.fileId
      driveUrl = result.webViewLink
      console.log(`[documento] Step 5 OK: fileId=${driveFileId}`)

      // ── 6. Hacer accesible por link ───────────────────────────────────
      await setFilePublicByLink(driveFileId, workspaceId)
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
    let extraccionStatus: 'ok' | 'failed' | 'no_key' | null = null
    let extraccionError: string | null = null

    if (camposExtraccion.length > 0) {
      console.log(`[documento] Step 9: AI extraction (${camposExtraccion.length} campos)...`)
      const apiKey = getServerKey('gemini')
      if (apiKey) {
        const extraction = await extractWithRetry(buffer, mimeType, camposExtraccion, apiKey, 'documento')
        if (extraction.data) {
          camposResult = extraction.data
          newData.campos = camposResult
          extraccionStatus = 'ok'
          console.log('[documento] Step 9 OK: AI extraction done')
        } else {
          extraccionStatus = 'failed'
          extraccionError = extraction.error ?? 'Extracción AI falló'
          console.error('[documento] Step 9 WARN:', extraccionError)
        }
      } else {
        extraccionStatus = 'no_key'
        console.warn('[documento] Step 9 SKIP: no gemini API key')
      }
      // Persistir estado de extracción para que la UI muestre el banner correcto
      // (failed → reintentar/manual). Limpia errores viejos cuando vuelve a OK.
      newData._extraction_status = extraccionStatus
      if (extraccionError) newData._extraction_error = extraccionError
      else delete newData._extraction_error
    }

    // ── 9b. Cross-check contra datos de otros bloques ───────────────────
    const crossCheckSpec = configExtra.cross_check as { checks?: CrossCheckSpec[] } | undefined
    if (crossCheckSpec?.checks && crossCheckSpec.checks.length > 0 && camposResult) {
      const cc = await runCrossCheck(supabase, negocioId, crossCheckSpec.checks, camposResult)
      newData._cross_check = cc
      console.log(`[documento] Step 9b cross_check: passed=${cc.passed} (${cc.results.filter(r => !r.ok).map(r => r.slug).join(',')})`)
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

    // Cross-check bloquea gate si no pasa
    const ccData = newData._cross_check as { passed: boolean } | undefined
    if (ccData && !ccData.passed) {
      isComplete = false
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
      extraction_status: extraccionStatus ?? undefined,
      extraction_error: extraccionError ?? undefined,
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
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

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
    const buffer = await downloadDriveFile(driveFileId, workspaceId)
    const mimeType = mimeTypeFromName(fileName)

    // 4. Extraer con AI (con reintento ante fallo transitorio)
    console.log(`[reprocesar] AI extraction (${camposExtraccion.length} campos)...`)
    const extraction = await extractWithRetry(buffer, mimeType, camposExtraccion, apiKey, 'reprocesar')
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
    let isComplete = requiredCampos.every(c => mergedCampos[c.slug]?.value !== null && mergedCampos[c.slug]?.value !== undefined)

    // 6b. Cross-check contra datos de otros bloques
    const crossCheckSpec = configExtra.cross_check as { checks?: CrossCheckSpec[] } | undefined
    let ccResult: { passed: boolean; results: CrossCheckResult[] } | null = null
    if (crossCheckSpec?.checks && crossCheckSpec.checks.length > 0) {
      ccResult = await runCrossCheck(supabase, negocioId, crossCheckSpec.checks, mergedCampos)
      if (!ccResult.passed) isComplete = false
    }

    const now = new Date().toISOString()
    const newData: Record<string, unknown> = { ...currentData, campos: mergedCampos, _extraction_status: 'ok' }
    delete newData._extraction_error
    if (ccResult) newData._cross_check = ccResult

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
