'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { getServerKey } from '@/lib/server-keys'
import { parseVeDocuments } from '@/lib/ve/parse-ve-docs'
import { parseRut } from '@/lib/rut/parse-rut'

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
