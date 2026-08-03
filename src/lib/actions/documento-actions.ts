'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { guardEditarBloque } from '@/lib/permissions/guard-negocio'
import { createServiceClient } from '@/lib/supabase/server'
import { getServerKey } from '@/lib/server-keys'
import { extractFieldsFromDocument, type CampoExtraccion, type CampoResultado } from '@/lib/ai/extract-fields'
import { nitSinDv, calcularDvNit } from '@/lib/dian/nit'
import { createSubfolderPath, uploadFileToDrive, setFilePublicByLink, deleteDriveFile, downloadDriveFile } from '@/lib/google-drive'
import { documentoVigenteEn } from '@/lib/documentos/vigencia'
import { montosCoinciden } from '@/lib/negocios/monto-cop'
import { TOLERANCIA_SALDO_COP } from '@/lib/upme/modelo-dinero'
import { registrarCorrecciones, contextoCorreccion, esCausaValida, type CausaCorreccion } from '@/lib/correcciones/registrar'

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

export type CrossCheckMatchMode = 'exact' | 'tokens' | 'subset' | 'id_prefix' | 'overlap' | 'vigencia' | 'monto'

// Fuente de datos para un check: una etapa + bloque + cómo resolver el valor
// esperado (un campo, varios concatenados, o varias alternativas de campo).
export type CrossCheckSource = {
  // Referencia ESTABLE al bloque fuente por su slug (atado a la identidad del
  // bloque, no a su posición ni a su nombre editable). Prioritario sobre el par
  // (source_etapa_orden, source_bloque_nombre), que queda como fallback legacy
  // para refs aún no migradas. Ver docs/specs/2026-05-26_block-references-by-slug.md
  source_bloque_slug?: string
  source_etapa_orden: number
  source_bloque_nombre: string
  source_field?: string
  source_fields?: string[]
  source_field_alternatives?: string[]
  join?: string
}

export type CrossCheckSpec = CrossCheckSource & {
  slug: string
  label: string
  match_mode?: CrossCheckMatchMode
  // Fuentes alternativas: cuando el bloque fuente principal no aplica al negocio
  // (p.ej. RUT en persona natural vs. Certificado de existencia en jurídica),
  // se prueba cada alternativa. El check pasa si la principal O alguna alternativa
  // valida; el valor esperado del reporte sale de la primera fuente con dato.
  source_alternatives?: CrossCheckSource[]
  // Solo para match_mode 'vigencia': días que el documento sigue siendo válido
  // desde su fecha de expedición. Default 30.
  vigencia_dias?: number
  // Solo para match_mode 'monto': margen en pesos dentro del cual dos importes se
  // consideran el mismo. Default `TOLERANCIA_SALDO_COP` ($1.000, el piso de
  // materialidad ya vigente en los gates de saldo). Comparar dinero al peso exacto
  // convierte cada redondeo legítimo en una alerta, y una alerta que salta siempre
  // deja de leerse.
  tolerancia_cop?: number
  // Si el valor EXTRAÍDO del documento viene vacío, el check pasa (no aplica).
  // Ej.: el 2º beneficiario del Concepto UPME — solo se valida si el certificado
  // lista un segundo solicitante.
  optional?: boolean
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

function compareValues(
  expected: string,
  extracted: string,
  mode: CrossCheckMatchMode = 'exact',
  opts?: { vigencia_dias?: number; tolerancia_cop?: number },
): boolean {
  // El dinero se compara como NÚMERO y con margen, nunca como texto: "$ 701.812"
  // y "701812" son el mismo monto, y "350906.00" no son 35 millones. Ver `monto-cop.ts`.
  if (mode === 'monto') {
    return montosCoinciden(expected, extracted, opts?.tolerancia_cop ?? TOLERANCIA_SALDO_COP)
  }
  // La vigencia se evalúa ANTES del guard de vacíos: en una seccional que no exige
  // cita no hay fecha objetivo, y ahí el check no aplica en vez de fallar. Solo un
  // vencimiento comprobado marca el check como no cumplido.
  if (mode === 'vigencia') {
    // `extracted` = fecha de expedición del documento; `expected` = fecha objetivo
    // (la cita). El documento debe seguir vigente ESE día, no el día que se carga:
    // un certificado bancario de hace tres semanas sirve hoy y no sirve para una
    // cita del mes entrante.
    return documentoVigenteEn(extracted, expected, opts?.vigencia_dias) !== false
  }
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
  if (mode === 'overlap') {
    // Tolerante a palabras extra: pasa si comparten al menos un token alfabético
    // significativo (≥3 letras, excluye años/números). Útil para línea/modelo,
    // donde el certificado UPME replica la factura con descripción más larga
    // (ej. "Escape 2025" vs "Escape Platinum 2025").
    const sig = (s: string) => new Set(tokensOf(s).filter(t => t.length >= 3 && !/^\d+$/.test(t)))
    const a = sig(expected)
    const b = sig(extracted)
    if (a.size === 0 || b.size === 0) return false
    return [...a].some(t => b.has(t))
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

  // Cargar bloques de etapas previas relevantes (las de cada check + sus alternativas)
  const ordenesNecesarias = Array.from(new Set(
    checks.flatMap(c => [c.source_etapa_orden, ...(c.source_alternatives ?? []).map(a => a.source_etapa_orden)]),
  ))
  const { data: srcBloques } = await db(supabase)
    .from('negocio_bloques')
    .select('data, bloque_configs!inner(nombre, slug, etapas_negocio!inner(orden))')
    .eq('negocio_id', negocioId)

  // Dos índices sobre los mismos datos:
  //  - dataPorBloque: por (etapa_orden::nombre_lower) — fallback legacy
  //  - dataPorSlug:   por slug estable del bloque — vía preferida (refs migradas)
  const dataPorBloque = new Map<string, Record<string, unknown>>()
  const dataPorSlug = new Map<string, Record<string, unknown>>()
  for (const row of ((srcBloques ?? []) as Record<string, unknown>[])) {
    const cfg = row.bloque_configs as { nombre?: string; slug?: string; etapas_negocio?: { orden?: number } } | undefined
    const orden = cfg?.etapas_negocio?.orden
    const nombre = cfg?.nombre
    const slug = cfg?.slug
    if (typeof orden !== 'number' || !nombre) continue
    const data = (row.data as Record<string, unknown>) ?? {}
    // Algunos bloques (documento) anidan campos extraidos en data.campos[slug].value
    const flat: Record<string, unknown> = { ...data }
    const camposAnidados = (data.campos as Record<string, { value?: unknown }>) ?? null
    if (camposAnidados) {
      for (const [s, c] of Object.entries(camposAnidados)) {
        if (flat[s] === undefined) flat[s] = c?.value
      }
    }
    // El slug es estable y único por línea → siempre indexable.
    if (slug) dataPorSlug.set(slug, flat)
    // El índice legacy solo carga los órdenes que algún check pide por nombre.
    if (ordenesNecesarias.includes(orden)) {
      dataPorBloque.set(`${orden}::${nombre.trim().toLowerCase()}`, flat)
    }
  }

  // Resuelve el valor esperado de UNA fuente (campo único, varios concatenados, o
  // alternativas de campo) contra su srcData ya cargado.
  const resolveFromSource = (
    src: CrossCheckSource,
    srcData: Record<string, unknown>,
    extractedRaw: string,
    mode: CrossCheckMatchMode,
    opts?: { vigencia_dias?: number; tolerancia_cop?: number },
  ): { expected: string; ok: boolean } => {
    if (src.source_fields && src.source_fields.length > 0) {
      const join = src.join ?? ' '
      const expected = src.source_fields.map(f => String(srcData[f] ?? '')).filter(s => s).join(join)
      return { expected, ok: compareValues(expected, extractedRaw, mode, opts) }
    }
    if (src.source_field_alternatives && src.source_field_alternatives.length > 0) {
      // Probar cada alternativa de campo; pasar si CUALQUIERA matchea
      const candidates = src.source_field_alternatives.map(f => String(srcData[f] ?? '')).filter(s => s)
      const matched = candidates.find(c => compareValues(c, extractedRaw, mode, opts))
      return { expected: matched ?? candidates[0] ?? '', ok: !!matched }
    }
    if (src.source_field) {
      const expected = String(srcData[src.source_field] ?? '')
      return { expected, ok: compareValues(expected, extractedRaw, mode, opts) }
    }
    return { expected: '', ok: false }
  }

  const results: CrossCheckResult[] = []
  for (const check of checks) {
    const extractedRaw = String(camposExtraidos[check.slug]?.value ?? '')
    const mode: CrossCheckMatchMode = check.match_mode ?? 'exact'

    // Check opcional sin valor extraído (ej. 2º beneficiario ausente en el
    // certificado) → no aplica, pasa sin comparar.
    if (check.optional && !extractedRaw) {
      results.push({ slug: check.slug, label: check.label, expected: '', extracted: '', ok: true, mode })
      continue
    }

    // Fuente principal + alternativas: cuando el bloque fuente principal no aplica
    // al negocio (p.ej. RUT vacío en jurídica), se prueba el Certificado de
    // existencia. Pasa si la principal O alguna alternativa valida.
    const sources: CrossCheckSource[] = [check, ...(check.source_alternatives ?? [])]
    let expectedRaw = ''
    let ok = false
    for (const src of sources) {
      // Vía preferida: slug estable. Fallback legacy: (etapa_orden::nombre).
      const srcData =
        (src.source_bloque_slug ? dataPorSlug.get(src.source_bloque_slug) : undefined) ??
        dataPorBloque.get(`${src.source_etapa_orden}::${src.source_bloque_nombre.trim().toLowerCase()}`) ??
        {}
      const r = resolveFromSource(src, srcData, extractedRaw, mode, { vigencia_dias: check.vigencia_dias, tolerancia_cop: check.tolerancia_cop })
      if (r.ok) { expectedRaw = r.expected; ok = true; break }
      // Recordar el primer valor esperado no vacío para el reporte si nada matchea
      if (!expectedRaw && r.expected) expectedRaw = r.expected
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

/**
 * Normalizaciones deterministas post-extracción (config-driven, opt-in por campo
 * vía `campos_extraccion[].normalizar`). Muta `campos` en sitio.
 *
 * Orden importa: primero `nit_sin_dv` (limpia el NIT base quitando el DV pegado),
 * luego `dv_desde_nit` (recalcula el DV por módulo 11 sobre el NIT ya limpio). Así
 * el DV nunca depende de la lectura inestable de la IA en las casillas 5/6.
 */
function aplicarNormalizaciones(
  campos: CampoExtraccion[],
  resultado: Record<string, CampoResultado>,
): void {
  // Pasada 1: nit_sin_dv (deja el NIT base sin el DV pegado).
  for (const campo of campos) {
    if (campo.normalizar === 'nit_sin_dv') {
      const cr = resultado[campo.slug]
      if (cr?.value) cr.value = nitSinDv(cr.value)
    }
  }
  // Pasada 2: dv_desde_nit (recalcula el DV desde el NIT base ya normalizado).
  for (const campo of campos) {
    if (campo.normalizar === 'dv_desde_nit') {
      const nitSlug = campo.normalizar_desde ?? 'nit'
      const nitVal = resultado[nitSlug]?.value ?? null
      const dvCalc = calcularDvNit(nitVal)
      if (dvCalc != null) {
        const cr = resultado[campo.slug]
        if (cr) cr.value = dvCalc
        else resultado[campo.slug] = { value: dvCalc, confidence: 1, manual: false }
      }
    }
  }
}

// ── Instancias heredadas: copias de solo lectura ─────────────────────────────
//
// Un bloque cuyo `config_extra.source_etapa_orden` está definido es una COPIA de
// solo lectura del bloque de esa etapa de origen. Escribir sobre él falla EN
// SILENCIO, por dos vías:
//   (a) el render sobrescribe el `data` de la copia con el del origen
//       (negocio-v2-actions, herencia readonly de documento) → la corrección
//       desaparece de pantalla al recargar;
//   (b) `resolverCamposFuente` indexa los bloques por slug y estas copias tienen
//       `slug = null` → el valor corregido nunca llega al PDF del formulario.
// Por eso se rechaza con un mensaje que apunta a la etapa de origen, en vez de
// dejar que el usuario "corrija" en el vacío.
async function bloqueHeredadoError(
  supabase: unknown,
  negocioBloqueId: string,
): Promise<string | null> {
  const { data } = await db(supabase)
    .from('negocio_bloques')
    .select('bloque_configs(config_extra)')
    .eq('id', negocioBloqueId)
    .single()

  const cfg =
    ((data?.bloque_configs as { config_extra?: Record<string, unknown> } | null)?.config_extra ??
      {}) as Record<string, unknown>
  const srcOrden = cfg.source_etapa_orden
  if (typeof srcOrden !== 'number') return null

  return `Este bloque es una copia de solo lectura de la etapa ${srcOrden}. Corrige el documento en su etapa de origen.`
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

  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) return { success: false, error: guard.error ?? 'Sin permiso' }

  const heredado = await bloqueHeredadoError(supabase, negocioBloqueId)
  if (heredado) return { success: false, error: heredado }

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

    // ── 4. Resolver la carpeta CANONICA del negocio desde negocios.carpeta_url
    //    (la que crea crearNegocio y usa la propuesta economica). Antes se
    //    re-creaba una carpeta por `codigo` a secas bajo el root del workspace →
    //    como crearNegocio la nombra "{codigo} - {cliente}", no la encontraba y
    //    creaba una carpeta HUERFANA distinta; por eso solo la propuesta caia en
    //    la carpeta real y los documentos quedaban dispersos. Ahora se resuelve
    //    el folder id desde carpeta_url, igual que la propuesta. ──
    let negocioFolderId: string | null = null
    if (driveFolderId) {
      const { data: negocio } = await db(supabase)
        .from('negocios')
        .select('codigo, carpeta_url')
        .eq('id', negocioId)
        .eq('workspace_id', workspaceId)
        .single()

      if (!negocio) {
        return { success: false, error: 'Negocio no encontrado en este workspace' }
      }

      const carpetaUrl = negocio.carpeta_url as string | null
      if (carpetaUrl) {
        negocioFolderId = carpetaUrl.match(/folders\/([-\w]+)/)?.[1] ?? null
      }
      if (!negocioFolderId) {
        console.warn(`[documento] negocio ${negocioId} sin carpeta_url usable — se guarda en Storage, no en Drive`)
      }
    }

    if (negocioFolderId) {
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
      // Sin Drive (no configurado o negocio sin carpeta_url): guardar URL de Storage
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
          // Normalización determinista post-extracción (config-driven). Ej.:
          // nit_sin_dv deja el NIT base sin el DV pegado por la extracción;
          // dv_desde_nit recalcula el DV por módulo 11 desde el NIT base.
          aplicarNormalizaciones(camposExtraccion, camposResult)
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
    const crossCheckSpec = configExtra.cross_check as { checks?: CrossCheckSpec[]; solo_alerta?: boolean } | undefined
    const crossCheckSoloAlerta = crossCheckSpec?.solo_alerta === true
    if (crossCheckSpec?.checks && crossCheckSpec.checks.length > 0 && camposResult) {
      const cc = await runCrossCheck(supabase, negocioId, crossCheckSpec.checks, camposResult)
      // solo_alerta: el cross-check detecta y reporta la discrepancia (panel), pero NO
      // bloquea el gate. El operador corrige si aplica. Sin el flag, comportamiento gate.
      newData._cross_check = { ...cc, solo_alerta: crossCheckSoloAlerta }
      console.log(`[documento] Step 9b cross_check: passed=${cc.passed} solo_alerta=${crossCheckSoloAlerta} (${cc.results.filter(r => !r.ok).map(r => r.slug).join(',')})`)
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

    // Cross-check bloquea el gate si no pasa, SALVO en modo solo_alerta (la
    // discrepancia se reporta en el panel pero no impide completar el bloque).
    const ccData = newData._cross_check as { passed: boolean; solo_alerta?: boolean } | undefined
    if (ccData && !ccData.passed && !ccData.solo_alerta) {
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

  // Guard de permiso (mismo criterio que actualizarCampoDocumento): manda el área.
  // Reprocesar sobrescribe todos los campos extraídos, así que es una corrección
  // con otro nombre y no puede tener una puerta más ancha que corregir a mano.
  // Antes NO tenía guard alguno; después de S2 tuvo el fallback por rol que se
  // eliminó el 2026-07-29 aquí y en `actualizarCampoDocumento`.
  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) {
    return { success: false, error: guard.error ?? 'Tu área no permite reprocesar este documento' }
  }

  const heredado = await bloqueHeredadoError(supabase, negocioBloqueId)
  if (heredado) return { success: false, error: heredado }

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

    // 4b. Normalización determinista post-extracción (config-driven, ver procesarDocumento)
    aplicarNormalizaciones(camposExtraccion, extraction.data)

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
    const crossCheckSpec = configExtra.cross_check as { checks?: CrossCheckSpec[]; solo_alerta?: boolean } | undefined
    const crossCheckSoloAlerta = crossCheckSpec?.solo_alerta === true
    let ccResult: { passed: boolean; results: CrossCheckResult[] } | null = null
    if (crossCheckSpec?.checks && crossCheckSpec.checks.length > 0) {
      ccResult = await runCrossCheck(supabase, negocioId, crossCheckSpec.checks, mergedCampos)
      // solo_alerta: reporta pero no bloquea (ver procesarDocumento).
      if (!ccResult.passed && !crossCheckSoloAlerta) isComplete = false
    }

    const now = new Date().toISOString()
    const newData: Record<string, unknown> = { ...currentData, campos: mergedCampos, _extraction_status: 'ok' }
    delete newData._extraction_error
    if (ccResult) newData._cross_check = { ...ccResult, solo_alerta: crossCheckSoloAlerta }

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
  // Solo viaja cuando el bloque es de una etapa ya superada: es una corrección, y
  // entonces la causa es obligatoria (ver `actualizarBloqueData`, mismo criterio).
  correccion?: { causa?: string; sesion_id?: string },
): Promise<{ success: boolean; isComplete?: boolean; error?: string }> {
  const { supabase, workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Validar que slug existe en camposExtraccion
  const slugValido = camposExtraccion.some(c => c.slug === slug)
  if (!slugValido) return { success: false, error: 'Campo no válido' }

  // Guard de permiso: EL ÁREA MANDA, sin importar el rol (decisión de Mauricio,
  // 2026-07-29). `guardEditarBloque` resuelve área + stage + responsable y es la
  // única barrera: un supervisor corrige los bloques del stage que cubre su área,
  // esté el negocio en esa etapa o ya la haya superado.
  //
  // Antes había aquí un fallback `puedeCorregirDocumentos(role)` que se saltaba el
  // área por completo: bastaba ser owner/admin/supervisor para corregir un bloque
  // de cualquier área. Por eso una supervisora comercial podía corregir documentos
  // de operaciones. Se elimina, junto con el path histórico `editar_extraidos`
  // (verificado contra prod el 2026-07-29: CERO bloques lo tienen encendido en
  // ningún workspace, era código muerto).
  //
  // Consecuencia asumida: quien tiene área asignada queda restringido a ella,
  // incluido `admin`. Es la misma regla que ya aplica `can-edit.ts` desde el
  // 2026-06-04 para la edición normal; ahora la corrección no la contradice.
  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) {
    return { success: false, error: guard.error ?? 'Tu área no permite corregir este campo' }
  }

  const heredado = await bloqueHeredadoError(supabase, negocioBloqueId)
  if (heredado) return { success: false, error: heredado }

  // Nombre del editor para la marca de trazabilidad (snapshot).
  let editorNombre = 'Usuario'
  if (userId) {
    const { data: prof } = await db(supabase)
      .from('profiles')
      .select('full_name')
      .eq('id', userId)
      .single()
    editorNombre = (prof?.full_name as string | null) ?? 'Usuario'
  }

  const { data: bloque } = await db(supabase)
    .from('negocio_bloques')
    .select('data')
    .eq('id', negocioBloqueId)
    .single()

  const currentData = (bloque?.data as Record<string, unknown>) ?? {}
  const campos = (currentData.campos as Record<string, CampoResultado>) ?? {}

  // ── Corrección hacia atrás: causa obligatoria ─────────────────────────────
  // Editar el campo de un documento mientras se trabaja su etapa es trabajo normal.
  // Hacerlo cuando el negocio ya avanzó es una corrección, y sin causa el registro
  // no distingue un error real de un cambio legítimo del cliente.
  const ctxCorr = await contextoCorreccion(supabase, negocioBloqueId)
  const esCorreccion = ctxCorr?.esPostAvance === true
  if (esCorreccion && (!esCausaValida(correccion?.causa) || !correccion?.sesion_id)) {
    return { success: false, error: 'Indica por qué se corrige antes de guardar' }
  }
  const valorPrevio = campos[slug]?.value ?? null

  // Update the specific field — marca de edición manual (quién + cuándo).
  campos[slug] = {
    value: value || null,
    confidence: 1.0,
    manual: true,
    edicion: {
      editado_por_id: userId ?? '',
      editado_por_nombre: editorNombre,
      editado_en: new Date().toISOString(),
    },
  }
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

  // Traza de la corrección (valor previo, valor nuevo, causa, área dueña del bloque).
  // Nunca bloquea: el dato corregido es el trabajo, el registro es la traza.
  if (esCorreccion) {
    await registrarCorrecciones({
      supabase,
      workspaceId,
      userId,
      userNombre: editorNombre,
      negocioBloqueId,
      campos: [{ slug, antes: valorPrevio, despues: value || null }],
      causa: correccion!.causa as CausaCorreccion,
      sesionId: correccion!.sesion_id as string,
    })
  }

  revalidatePath(`/negocios/${negocioId}`)

  return { success: true, isComplete: !!isComplete }
}

// ── Pantallazo pegado → Supabase Storage (campo imagen_clipboard de BloqueDatos) ──
// El valor persistido del campo es la URL pública, NUNCA el data URL. Guardar el
// PNG en base64 dentro de `negocio_bloques.data` hacía que cada lectura del bloque
// arrastrara cientos de kB: la lista de negocios movía 22 MB por carga para pintar
// cuatro campos de texto, y era el 32% del tiempo total de base de datos.
// Postgres además descomprime el jsonb completo aunque se pida una sola clave, así
// que proyectar menos campos no evitaba el costo: la imagen tenía que salir de ahí.
// Los valores legacy (`data:image/...`) se siguen renderizando igual — el <img> no
// distingue entre data URL y URL, así que este cambio es retrocompatible.
export async function subirImagenClipboard(
  negocioBloqueId: string,
  fieldSlug: string,
  dataUrl: string,
): Promise<{ success: true; url: string } | { success: false; error: string }> {
  const { workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) return { success: false, error: guard.error ?? 'Sin permiso' }

  const m = /^data:(image\/[a-z0-9.+-]+);base64,([\s\S]+)$/i.exec(dataUrl)
  if (!m) return { success: false, error: 'Imagen inválida' }
  const mimeType = m[1].toLowerCase()
  const buffer = Buffer.from(m[2], 'base64')

  const admin = createServiceClient()
  const { data: bloque } = await db(admin)
    .from('negocio_bloques')
    .select('negocio_id')
    .eq('id', negocioBloqueId)
    .single()
  const negocioId = bloque?.negocio_id as string | undefined
  if (!negocioId) return { success: false, error: 'Bloque no encontrado' }

  const ext = mimeType.split('/')[1]?.replace(/\+.*$/, '') ?? 'png'
  // El slug viene de config; se sanea para que no arrastre nada al path de Storage.
  const safeSlug = fieldSlug.replace(/[^a-z0-9_-]/gi, '_')
  const storagePath = `${workspaceId}/negocios/${negocioId}/${negocioBloqueId}/${safeSlug}.${ext}`

  const { error: upErr } = await admin.storage
    .from(BUCKET)
    .upload(storagePath, buffer, { contentType: mimeType, upsert: true })
  if (upErr) return { success: false, error: upErr.message }

  const { data: publicData } = admin.storage.from(BUCKET).getPublicUrl(storagePath)
  // `upsert` reescribe el mismo path: sin este sufijo, al reemplazar el pantallazo
  // el navegador seguiría mostrando el anterior desde su caché.
  return { success: true, url: `${publicData.publicUrl}?v=${Date.now()}` }
}

// ── Extracción AI desde un pantallazo pegado (campo imagen_clipboard de BloqueDatos) ──
// A diferencia de procesarDocumento (bloques tipo 'documento' que suben a Storage+Drive),
// aquí la imagen llega como data URL pegada del portapapeles en un bloque tipo 'datos'.
// El archivo NO se persiste: solo se extrae UN campo de texto hermano (ej. el número de
// radicado desde el pantallazo de la UPME/DIAN) y se devuelve al cliente para autollenar
// el campo destino — editable y con alerta de revisión. La descripción para la IA se lee
// de la config del bloque (server-side), no del cliente, para que no sea manipulable.
export async function extraerCampoDesdeImagen(
  negocioBloqueId: string,
  fieldSlug: string,
  dataUrl: string,
): Promise<
  | { success: true; targetSlug: string; value: string | null; confidence: number; alertaRevision: boolean }
  | { success: false; error: string }
> {
  const { workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) return { success: false, error: guard.error ?? 'Sin permiso' }

  // La config (campos + mapeo de extracción) vive server-side: el cliente solo
  // identifica el campo de imagen y manda el pantallazo.
  const admin = createServiceClient()
  const { data: bloqueData } = await db(admin)
    .from('negocio_bloques')
    .select('bloque_configs(config_extra)')
    .eq('id', negocioBloqueId)
    .single()

  const configExtra = (bloqueData?.bloque_configs as Record<string, unknown>)?.config_extra as Record<string, unknown> ?? {}
  const fields = (configExtra.fields ?? []) as Array<Record<string, unknown>>
  const field = fields.find(f => f.slug === fieldSlug && f.tipo === 'imagen_clipboard')
  const extrae = field?.extrae as { target_slug?: string; descripcion_ai?: string; alerta_revision?: boolean } | undefined

  if (!extrae?.target_slug || !extrae?.descripcion_ai) {
    return { success: false, error: 'Este campo no tiene extracción configurada' }
  }

  // data URL → mime + buffer
  const m = /^data:([^;]+);base64,([\s\S]+)$/.exec(dataUrl)
  if (!m) return { success: false, error: 'Imagen inválida' }
  const buffer = Buffer.from(m[2], 'base64')

  const apiKey = getServerKey('gemini')
  if (!apiKey) return { success: false, error: 'API key de Gemini no configurada' }

  const targetField = fields.find(f => f.slug === extrae.target_slug)
  const campos: CampoExtraccion[] = [{
    slug: extrae.target_slug,
    label: (targetField?.label as string) ?? 'Campo',
    tipo: 'texto',
    required: true,
    descripcion_ai: extrae.descripcion_ai,
  }]

  const result = await extractWithRetry(buffer, m[1], campos, apiKey, 'imagen-clipboard')
  if (!result.data) return { success: false, error: result.error ?? 'No se pudo extraer el dato' }

  const campo = result.data[extrae.target_slug]
  return {
    success: true,
    targetSlug: extrae.target_slug,
    value: campo?.value ?? null,
    confidence: campo?.confidence ?? 0,
    // Default true: un radicado siempre conviene verificarlo antes de confiar.
    alertaRevision: extrae.alerta_revision !== false,
  }
}
