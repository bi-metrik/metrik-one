'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { getServerKey } from '@/lib/server-keys'
import { parseVeDocuments } from '@/lib/ve/parse-ve-docs'

const BUCKET = 've-documentos'

// Cast a untyped para tablas nuevas no en database.ts
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any { return client }

// Slugs que tienen extraccion AI (cedula → propietario, tarjeta_propiedad → vehiculo)
const SLUGS_CON_AI = ['cedula', 'tarjeta_propiedad']

export interface CamposExtraidos {
  nombre_propietario?: string
  numero_identificacion?: string
  marca?: string
  linea?: string
  modelo?: string
  tecnologia?: string
  tipo?: string
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
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const admin = createServiceClient()
  const { data: publicData } = admin.storage.from(BUCKET).getPublicUrl(filePath)
  const url = publicData.publicUrl

  const { data: bloque } = await db(supabase)
    .from('negocio_bloques')
    .select('data')
    .eq('id', negocioBloqueId)
    .single()

  const currentData = (bloque?.data as Record<string, unknown>) ?? {}
  const currentDocs = (currentData.docs as Record<string, string>) ?? {}

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

// ── 3. Procesar documento con IA (cédula → propietario, tarjeta → vehículo) ──

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

  // tarjeta_propiedad usa el parser de ficha_tecnica (doc vehicular)
  const parserSlug = slug === 'tarjeta_propiedad' ? 'ficha_tecnica' : slug

  const { data: veData, error: parseError } = await parseVeDocuments(
    [{ buffer, mimeType, slug: parserSlug }],
    apiKey,
  )

  if (parseError || !veData) {
    return { success: false, error: parseError ?? 'Error procesando documento' }
  }

  const campos: CamposExtraidos = {}
  const apply = (key: keyof CamposExtraidos, field: { value: string | null; confidence: number }) => {
    if (field.value && field.confidence >= 0.6) campos[key] = field.value
  }

  apply('nombre_propietario', veData.nombre_propietario)
  apply('numero_identificacion', veData.numero_identificacion)
  apply('marca', veData.marca_vehiculo)
  apply('linea', veData.linea_vehiculo)
  apply('modelo', veData.modelo_ano)
  apply('tecnologia', veData.tecnologia)
  apply('tipo', veData.tipo_vehiculo)

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
