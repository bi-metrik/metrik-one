'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { getServerKey } from '@/lib/server-keys'
import { parseVeDocuments } from '@/lib/ve/parse-ve-docs'
import { parseRut } from '@/lib/rut/parse-rut'
import { createSubfolderPath, uploadFileToDrive, setFilePublicByLink } from '@/lib/google-drive'

const BUCKET = 've-documentos'

// Cast a untyped para tablas nuevas no en database.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

// Slugs que disparan procesamiento AI
// - factura, cedula, soporte_upme → parseVeDocuments
// - rut → parseRut
const SLUGS_CON_AI = ['factura', 'cedula', 'soporte_upme', 'rut']

// Todos los campos extraibles de los 4 documentos de radicación
export interface CamposExtraidos {
  // Del vehículo (factura + cedula)
  nombre_propietario?: string
  numero_identificacion?: string
  marca?: string
  linea?: string
  modelo?: string
  tecnologia?: string
  tipo?: string
  numero_cus?: string
  // Datos fiscales del cliente (RUT)
  regimen_tributario_cliente?: string
  tipo_persona_cliente?: string
  telefono_propietario?: string
  municipio_propietario?: string
  correo_propietario?: string
  direccion_propietario?: string
}

// ── 1. Generar URL firmada de upload ──────────────────────────────────────────

export async function getUploadUrlDocumentoNegocio(
  negocioBloqueId: string,
  negocioId: string,
  slug: string,
  fileExtension: string,
): Promise<{ success: boolean; path?: string; token?: string; error?: string }> {
  const { workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const ext = fileExtension.toLowerCase().replace(/^\./, '') || 'pdf'
  const filePath = `${workspaceId}/negocios/${negocioId}/${negocioBloqueId}/${slug}.${ext}`

  const admin = createServiceClient()
  const { data, error: signError } = await admin.storage
    .from(BUCKET)
    .createSignedUploadUrl(filePath, { upsert: true })

  if (signError || !data) {
    return { success: false, error: signError?.message ?? 'Error generando URL de subida' }
  }

  return { success: true, path: filePath, token: data.token }
}

// ── 2. Confirmar upload y guardar URL en negocio_bloques.data ─────────────────

export async function confirmarUploadDocumentoNegocio(
  negocioBloqueId: string,
  slug: string,
  filePath: string,
): Promise<{ success: boolean; url?: string; error?: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const admin = createServiceClient()

  // Cargar bloque + config + negocio para resolver Drive destino
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bloqueRaw } = await (db(supabase) as any)
    .from('negocio_bloques')
    .select(`
      data, negocio_id,
      bloque_configs!inner(config_extra),
      negocios!inner(codigo, carpeta_url)
    `)
    .eq('id', negocioBloqueId)
    .single()

  if (!bloqueRaw) return { success: false, error: 'Bloque no encontrado' }

  const currentData = (bloqueRaw.data as Record<string, unknown>) ?? {}
  const currentDocs = (currentData.docs as Record<string, string>) ?? {}
  const configExtra = ((bloqueRaw.bloque_configs as { config_extra?: Record<string, unknown> }).config_extra ?? {}) as Record<string, unknown>
  const driveSubfolder = configExtra.drive_subfolder as string | undefined

  // Si el bloque tiene drive_subfolder definido → mover archivo a Drive y borrar de Storage.
  // Si no → comportamiento legacy (URL publica de Supabase Storage).
  let url: string

  if (driveSubfolder) {
    const negocio = bloqueRaw.negocios as { codigo: string | null; carpeta_url: string | null }
    const folderIdMatch = negocio.carpeta_url?.match(/folders\/([-\w]+)/)
    const negocioFolderId = folderIdMatch?.[1]
    if (!negocioFolderId) {
      return { success: false, error: 'Negocio sin carpeta Drive — no se puede mover archivo' }
    }

    // Resolver label del slot desde configExtra.documentos[slug]
    const docsConfig = (configExtra.documentos ?? []) as Array<{ slug: string; label: string }>
    const slotConfig = docsConfig.find(d => d.slug === slug)
    const slotLabel = slotConfig?.label ?? slug

    // Descargar archivo del bucket
    const { data: fileData, error: dlError } = await admin.storage.from(BUCKET).download(filePath)
    if (dlError || !fileData) {
      return { success: false, error: `Error descargando archivo temporal: ${dlError?.message ?? 'no data'}` }
    }
    const arrayBuf = await fileData.arrayBuffer()
    const buffer = Buffer.from(arrayBuf)
    const mimeType = fileData.type || mimeTypeFromUrl(filePath)
    const ext = filePath.split('.').pop()?.toLowerCase() ?? 'pdf'

    // Crear cadena de subcarpetas y subir
    const targetFolderId = await createSubfolderPath(driveSubfolder, negocioFolderId, workspaceId)
    const fileName = `${slotLabel}.${ext}`
    const up = await uploadFileToDrive(buffer, fileName, mimeType, targetFolderId, workspaceId)
    await setFilePublicByLink(up.fileId, workspaceId)
    url = up.webViewLink

    // Borrar archivo temporal de Storage
    await admin.storage.from(BUCKET).remove([filePath]).catch(err => {
      console.warn(`[ve-documentos] no se pudo borrar archivo temporal Storage:`, err)
    })
  } else {
    // Legacy: URL publica de Supabase Storage
    const { data: publicData } = admin.storage.from(BUCKET).getPublicUrl(filePath)
    url = publicData.publicUrl
  }

  const { error: updateError } = await db(supabase)
    .from('negocio_bloques')
    .update({
      data: { ...currentData, docs: { ...currentDocs, [slug]: url } },
      updated_at: new Date().toISOString(),
    })
    .eq('id', negocioBloqueId)

  if (updateError) return { success: false, error: updateError.message }
  return { success: true, url }
}

// ── 3. Procesar documento con IA ──────────────────────────────────────────────

function mimeTypeFromUrl(url: string): string {
  const p = url.split('?')[0].toLowerCase()
  if (p.endsWith('.pdf')) return 'application/pdf'
  if (p.endsWith('.png')) return 'image/png'
  if (p.endsWith('.webp')) return 'image/webp'
  if (p.endsWith('.jpg') || p.endsWith('.jpeg')) return 'image/jpeg'
  return 'application/pdf'
}

export async function procesarDocumentoNegocio(
  negocioBloqueId: string,
  slug: string,
): Promise<{ success: boolean; data?: CamposExtraidos; error?: string }> {
  if (!SLUGS_CON_AI.includes(slug)) {
    return { success: false, error: `'${slug}' no requiere procesamiento AI` }
  }

  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { data: bloque } = await db(supabase)
    .from('negocio_bloques')
    .select('data')
    .eq('id', negocioBloqueId)
    .single()

  const currentData = (bloque?.data as Record<string, unknown>) ?? {}
  const docs = (currentData.docs as Record<string, string>) ?? {}
  const url = docs[slug]
  if (!url) return { success: false, error: `Documento '${slug}' no cargado` }

  const apiKey = getServerKey('gemini')
  if (!apiKey) return { success: false, error: 'GEMINI_API_KEY no configurada' }

  let buffer: ArrayBuffer
  let mimeType: string
  try {
    const res = await fetch(url)
    if (!res.ok) return { success: false, error: `Error descargando (HTTP ${res.status})` }
    buffer = await res.arrayBuffer()
    const ct = res.headers.get('content-type') || ''
    mimeType = ct.split(';')[0].trim() || mimeTypeFromUrl(url)
  } catch (err) {
    return { success: false, error: `Error descargando: ${String(err).slice(0, 80)}` }
  }

  const campos: CamposExtraidos = {}

  // ── RUT: parser especializado ─────────────────────────────────────────────
  if (slug === 'rut') {
    const { data: rutData, error: parseError } = await parseRut(buffer, mimeType, apiKey)
    if (parseError || !rutData) {
      return { success: false, error: parseError ?? 'Error procesando RUT' }
    }

    const applyStr = (
      key: keyof CamposExtraidos,
      field: { value: string | null; confidence: number },
    ) => {
      if (field.value && field.confidence >= 0.6) campos[key] = field.value
    }

    // razon_social → nombre_propietario
    applyStr('nombre_propietario', rutData.razon_social)
    // nit → numero_identificacion (si no hay ya valor de cédula)
    if (rutData.nit.value && rutData.nit.confidence >= 0.6 && !currentData.numero_identificacion) {
      campos.numero_identificacion = rutData.nit.value
    }
    applyStr('regimen_tributario_cliente', rutData.regimen_tributario)
    applyStr('tipo_persona_cliente', rutData.tipo_persona)
    applyStr('telefono_propietario', rutData.telefono)
    applyStr('municipio_propietario', rutData.municipio)
    applyStr('correo_propietario', rutData.email_fiscal)
    applyStr('direccion_propietario', rutData.direccion_fiscal)
  }

  // ── Factura, cédula, soporte UPME: parser vehicular ───────────────────────
  else {
    const { data: veData, error: parseError } = await parseVeDocuments(
      [{ buffer, mimeType, slug }],
      apiKey,
    )
    if (parseError || !veData) {
      return { success: false, error: parseError ?? 'Error procesando documento' }
    }

    const apply = (
      key: keyof CamposExtraidos,
      field: { value: string | null; confidence: number },
    ) => {
      if (field.value && field.confidence >= 0.6) campos[key] = field.value
    }

    apply('nombre_propietario', veData.nombre_propietario)
    apply('numero_identificacion', veData.numero_identificacion)
    apply('marca', veData.marca_vehiculo)
    apply('linea', veData.linea_vehiculo)
    apply('modelo', veData.modelo_ano)
    apply('tecnologia', veData.tecnologia)
    apply('tipo', veData.tipo_vehiculo)
    apply('numero_cus', veData.numero_cus)
  }

  // ── Persistir campos en bloque data ──────────────────────────────────────
  if (Object.keys(campos).length > 0) {
    const { data: fresh } = await db(supabase)
      .from('negocio_bloques')
      .select('data')
      .eq('id', negocioBloqueId)
      .single()
    const freshData = (fresh?.data as Record<string, unknown>) ?? {}
    await db(supabase)
      .from('negocio_bloques')
      .update({ data: { ...freshData, ...campos }, updated_at: new Date().toISOString() })
      .eq('id', negocioBloqueId)
  }

  return { success: true, data: campos }
}

// ── 4. Guardar campos editados manualmente ────────────────────────────────────

export async function actualizarCamposNegocioBloque(
  negocioBloqueId: string,
  campos: CamposExtraidos,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { data: bloque } = await db(supabase)
    .from('negocio_bloques')
    .select('data')
    .eq('id', negocioBloqueId)
    .single()

  const currentData = (bloque?.data as Record<string, unknown>) ?? {}

  const { error: updateError } = await db(supabase)
    .from('negocio_bloques')
    .update({ data: { ...currentData, ...campos }, updated_at: new Date().toISOString() })
    .eq('id', negocioBloqueId)

  if (updateError) return { success: false, error: updateError.message }
  return { success: true }
}
