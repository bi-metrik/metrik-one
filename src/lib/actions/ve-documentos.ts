'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { getServerKey } from '@/lib/server-keys'
import { parseVeDocuments } from '@/lib/ve/parse-ve-docs'

// ── Tipos ──────────────────────────────────────────────────

export type DocumentoSlug =
  | 'cedula'
  | 'factura'
  | 'rut'
  | 'soporte_upme'
  | 'ficha_tecnica'
  | 'cert_emisiones'

export interface VeDocumentoState {
  slug: DocumentoSlug
  url: string
  subido_en: string
}

export interface CamposVehiculo {
  marca?: string
  linea?: string
  modelo?: string
  tecnologia?: string
  tipo?: string
}

// ── Constantes ─────────────────────────────────────────────

const BUCKET = 've-documentos'
const MAX_SIZE = 10 * 1024 * 1024 // 10MB
const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

// ── Helpers ────────────────────────────────────────────────

function getExtension(filename: string, mimeType: string): string {
  const extFromName = filename.split('.').pop()?.toLowerCase()
  if (extFromName) return extFromName
  const mimeMap: Record<string, string> = {
    'application/pdf': 'pdf',
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
  }
  return mimeMap[mimeType] || 'pdf'
}

// ── Leer documentos actuales de custom_data ────────────────

export async function getVeDocumentos(
  oportunidadId: string,
): Promise<{ docs: VeDocumentoState[]; vehiculoEnUpme: boolean | null; camposVehiculo: CamposVehiculo | null }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { docs: [], vehiculoEnUpme: null, camposVehiculo: null }

  const { data } = await supabase
    .from('oportunidades')
    .select('custom_data')
    .eq('id', oportunidadId)
    .single()

  if (!data?.custom_data) return { docs: [], vehiculoEnUpme: null, camposVehiculo: null }

  const cd = data.custom_data as Record<string, unknown>
  const docsRaw = (cd.docs as Record<string, string>) ?? {}
  const docs: VeDocumentoState[] = Object.entries(docsRaw).map(([slug, url]) => ({
    slug: slug as DocumentoSlug,
    url,
    subido_en: '',
  }))

  const vehiculoEnUpme = typeof cd.vehiculo_en_upme === 'boolean' ? cd.vehiculo_en_upme : null

  const camposVehiculo: CamposVehiculo = {}
  if (cd.marca_vehiculo) camposVehiculo.marca = cd.marca_vehiculo as string
  if (cd.linea_vehiculo) camposVehiculo.linea = cd.linea_vehiculo as string
  if (cd.modelo_ano) camposVehiculo.modelo = cd.modelo_ano as string
  if (cd.tecnologia) camposVehiculo.tecnologia = cd.tecnologia as string
  if (cd.tipo_vehiculo) camposVehiculo.tipo = cd.tipo_vehiculo as string

  const hasCampos = Object.keys(camposVehiculo).length > 0

  return { docs, vehiculoEnUpme, camposVehiculo: hasCampos ? camposVehiculo : null }
}

// ── Subir documento VE ─────────────────────────────────────

export async function subirDocumentoVe(
  oportunidadId: string,
  slug: DocumentoSlug,
  formData: FormData,
): Promise<{ success: boolean; url?: string; error?: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const file = formData.get('file') as File
  if (!file || file.size === 0) return { success: false, error: 'No se selecciono archivo' }
  if (file.size > MAX_SIZE) return { success: false, error: 'Archivo demasiado grande. Max 10MB' }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return { success: false, error: 'Solo PDF, JPG, PNG o WebP' }
  }

  const ext = getExtension(file.name, file.type)
  const filePath = `${workspaceId}/${oportunidadId}/${slug}.${ext}`

  // Usar service client para bypasear RLS en storage
  const admin = createServiceClient()

  const { error: uploadError } = await admin.storage
    .from(BUCKET)
    .upload(filePath, file, { upsert: true })

  if (uploadError) {
    // Si el bucket no existe, el error es claro
    if (uploadError.message?.includes('Bucket not found') || uploadError.message?.includes('bucket')) {
      return {
        success: false,
        error: `Bucket '${BUCKET}' no existe. Crealo en Supabase Storage Dashboard.`,
      }
    }
    return { success: false, error: `Error al subir: ${uploadError.message}` }
  }

  // URL publica (el bucket debe ser publico) o signed URL
  const { data: publicData } = admin.storage.from(BUCKET).getPublicUrl(filePath)
  const url = publicData.publicUrl

  // Persistir en custom_data.docs
  const { data: opp } = await supabase
    .from('oportunidades')
    .select('custom_data')
    .eq('id', oportunidadId)
    .single()

  const currentCustomData = (opp?.custom_data as Record<string, unknown>) ?? {}
  const currentDocs = (currentCustomData.docs as Record<string, string>) ?? {}

  const updatedCustomData = {
    ...currentCustomData,
    docs: {
      ...currentDocs,
      [slug]: url,
    },
  }

  const { error: updateError } = await supabase
    .from('oportunidades')
    .update({ custom_data: updatedCustomData as unknown as Record<string, never> })
    .eq('id', oportunidadId)

  if (updateError) return { success: false, error: `Archivo subido pero error guardando: ${updateError.message}` }

  return { success: true, url }
}

// ── Actualizar vehiculo_en_upme en custom_data ─────────────

export async function actualizarVehiculoEnUpme(
  oportunidadId: string,
  vehiculoEnUpme: boolean,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { data: opp } = await supabase
    .from('oportunidades')
    .select('custom_data')
    .eq('id', oportunidadId)
    .single()

  const currentCustomData = (opp?.custom_data as Record<string, unknown>) ?? {}

  const { error: updateError } = await supabase
    .from('oportunidades')
    .update({
      custom_data: {
        ...currentCustomData,
        vehiculo_en_upme: vehiculoEnUpme,
      } as unknown as Record<string, never>,
    })
    .eq('id', oportunidadId)

  if (updateError) return { success: false, error: updateError.message }
  return { success: true }
}

// ── Actualizar campos del vehiculo en custom_data ──────────

export async function actualizarCamposVehiculo(
  oportunidadId: string,
  campos: CamposVehiculo,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { data: opp } = await supabase
    .from('oportunidades')
    .select('custom_data')
    .eq('id', oportunidadId)
    .single()

  const currentCustomData = (opp?.custom_data as Record<string, unknown>) ?? {}

  const updates: Record<string, unknown> = { ...currentCustomData }
  if (campos.marca !== undefined) updates.marca_vehiculo = campos.marca
  if (campos.linea !== undefined) updates.linea_vehiculo = campos.linea
  if (campos.modelo !== undefined) updates.modelo_ano = campos.modelo
  if (campos.tecnologia !== undefined) updates.tecnologia = campos.tecnologia
  if (campos.tipo !== undefined) updates.tipo_vehiculo = campos.tipo

  const { error: updateError } = await supabase
    .from('oportunidades')
    .update({ custom_data: updates as unknown as Record<string, never> })
    .eq('id', oportunidadId)

  if (updateError) return { success: false, error: updateError.message }
  return { success: true }
}

// ── Helpers de deteccion de MIME por extension ────────────

function mimeTypeFromUrl(url: string): string {
  const path = url.split('?')[0].toLowerCase()
  if (path.endsWith('.pdf')) return 'application/pdf'
  if (path.endsWith('.png')) return 'image/png'
  if (path.endsWith('.webp')) return 'image/webp'
  if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg'
  // Fallback: intentar con PDF (documentos colombianos suelen ser PDF)
  return 'application/pdf'
}

// ── Procesar documentos con Gemini Vision ─────────────────

export async function procesarDocumentosVe(
  oportunidadId: string,
): Promise<{ success: boolean; data?: CamposVehiculo; error?: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const admin = createServiceClient()

  // Leer URLs de documentos actuales
  const { data: opp } = await supabase
    .from('oportunidades')
    .select('custom_data')
    .eq('id', oportunidadId)
    .single()

  if (!opp?.custom_data) return { success: false, error: 'Oportunidad no encontrada' }

  const cd = opp.custom_data as Record<string, unknown>
  const docsUrls = (cd.docs as Record<string, string>) ?? {}

  // Requiere al menos factura o ficha_tecnica
  const urlFactura = docsUrls.factura
  const urlFicha = docsUrls.ficha_tecnica

  if (!urlFactura && !urlFicha) {
    return { success: false, error: 'Se necesita al menos la Factura o la Ficha Tecnica para procesar' }
  }

  const apiKey = getServerKey('gemini')
  if (!apiKey) {
    return { success: false, error: 'GEMINI_API_KEY no configurada en el servidor' }
  }

  // Construir lista de documentos relevantes para extraccion VE
  // (factura primero — prioridad para datos de identificacion del vehiculo)
  const docEntries: { url: string; slug: string }[] = []
  if (urlFactura) docEntries.push({ url: urlFactura, slug: 'factura' })
  if (urlFicha) docEntries.push({ url: urlFicha, slug: 'ficha_tecnica' })

  const slugsProcesados = docEntries.map(d => d.slug)

  // Fetch + convertir cada documento a ArrayBuffer para envio inline a Gemini
  const docsPayload: Array<{ buffer: ArrayBuffer; mimeType: string; slug: string }> = []
  for (const entry of docEntries) {
    try {
      const res = await fetch(entry.url)
      if (!res.ok) {
        console.warn(`[procesarDocumentosVe] No se pudo descargar ${entry.slug}: HTTP ${res.status}`)
        continue
      }
      const buffer = await res.arrayBuffer()
      // Preferir content-type del servidor; fallback por extension de URL
      const contentType = res.headers.get('content-type') || ''
      const mimeType = contentType.split(';')[0].trim() || mimeTypeFromUrl(entry.url)
      docsPayload.push({ buffer, mimeType, slug: entry.slug })
    } catch (fetchErr) {
      console.warn(`[procesarDocumentosVe] Error descargando ${entry.slug}:`, fetchErr)
    }
  }

  if (docsPayload.length === 0) {
    return { success: false, error: 'No se pudieron descargar los documentos para procesar' }
  }

  // Llamar al parser con el patron identico a parse-rut.ts
  const { data: veData, error: parseError } = await parseVeDocuments(docsPayload, apiKey)

  if (parseError || !veData) {
    // Registrar intento fallido en log
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('ve_procesamiento_log').insert({
      workspace_id: workspaceId,
      oportunidad_id: oportunidadId,
      documentos_procesados: slugsProcesados,
      campos_extraidos: null,
      exitoso: false,
    })
    return { success: false, error: parseError ?? 'Error desconocido al procesar documentos' }
  }

  // Mapear VeVehicleData → CamposVehiculo (estructura legacy del action)
  const extracted: CamposVehiculo = {
    marca: veData.marca_vehiculo.value ?? undefined,
    linea: veData.linea_vehiculo.value ?? undefined,
    modelo: veData.modelo_ano.value ?? undefined,
    tecnologia: veData.tecnologia.value ?? undefined,
    tipo: veData.tipo_vehiculo.value ?? undefined,
  }

  // Persistir campos extraidos en custom_data de la oportunidad
  await actualizarCamposVehiculo(oportunidadId, extracted)

  // Registrar extraccion exitosa en log
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('ve_procesamiento_log').insert({
    workspace_id: workspaceId,
    oportunidad_id: oportunidadId,
    documentos_procesados: slugsProcesados,
    campos_extraidos: {
      marca_vehiculo: veData.marca_vehiculo,
      linea_vehiculo: veData.linea_vehiculo,
      modelo_ano: veData.modelo_ano,
      tecnologia: veData.tecnologia,
      tipo_vehiculo: veData.tipo_vehiculo,
      overall_confidence: veData.overall_confidence,
    } as unknown as Record<string, unknown>,
    exitoso: true,
  })

  return { success: true, data: extracted }
}
