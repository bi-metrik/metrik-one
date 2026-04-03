'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { GoogleGenerativeAI } from '@google/generative-ai'
import { getServerKey } from '@/lib/server-keys'

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

// ── Helpers Gemini Vision ──────────────────────────────────

async function urlToBase64Part(url: string): Promise<{ inlineData: { data: string; mimeType: string } } | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const contentType = res.headers.get('content-type') || 'application/octet-stream'
    const mimeType = contentType.split(';')[0].trim()
    const buffer = await res.arrayBuffer()
    const data = Buffer.from(buffer).toString('base64')
    return { inlineData: { data, mimeType } }
  } catch {
    return null
  }
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
  const docs = (cd.docs as Record<string, string>) ?? {}

  // Requiere al menos factura o ficha_tecnica
  const urlFactura = docs.factura
  const urlFicha = docs.ficha_tecnica
  const urlRut = docs.rut

  if (!urlFactura && !urlFicha) {
    return { success: false, error: 'Se necesita al menos la Factura o la Ficha Tecnica para procesar' }
  }

  const apiKey = getServerKey('gemini')
  if (!apiKey) {
    return { success: false, error: 'GEMINI_API_KEY no configurada en el servidor' }
  }

  // Construir partes para Gemini Vision (texto + imágenes inline en base64)
  const promptText = `Analiza los siguientes documentos de un vehiculo electrico/hibrido y extrae los datos del vehiculo.
Devuelve UNICAMENTE un JSON con esta estructura exacta (sin explicaciones adicionales):
{
  "marca": "string o null",
  "linea": "string o null",
  "modelo": "string o null (año, ej: 2023)",
  "tecnologia": "string o null (EV/HEV/PHEV/MOTO EV)",
  "tipo": "string o null (Automovil/Camioneta)"
}
Si no encuentras un dato, usa null. Extrae principalmente del documento de Factura o Ficha Tecnica.`

  const docEntries: { url: string; label: string }[] = []
  if (urlFactura) docEntries.push({ url: urlFactura, label: 'Factura de compra' })
  if (urlFicha) docEntries.push({ url: urlFicha, label: 'Ficha tecnica' })
  if (urlRut) docEntries.push({ url: urlRut, label: 'RUT' })

  const slugsProcesados = docEntries.map(d => d.label.toLowerCase().replace(/ /g, '_'))

  // Convertir documentos a base64 para enviar inline a Gemini
  type GeminiPart =
    | { text: string }
    | { inlineData: { data: string; mimeType: string } }

  const parts: GeminiPart[] = [{ text: promptText }]

  for (const entry of docEntries) {
    const part = await urlToBase64Part(entry.url)
    if (part) {
      parts.push({ text: `Documento: ${entry.label}` })
      parts.push(part)
    }
  }

  let extracted: CamposVehiculo | null = null
  let exitoso = false

  try {
    const genai = new GoogleGenerativeAI(apiKey)
    const model = genai.getGenerativeModel({ model: 'gemini-2.5-flash-preview-04-17' })

    const result = await model.generateContent(parts as Parameters<typeof model.generateContent>[0])
    const responseText = result.response.text().trim()

    const jsonMatch = responseText.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('No se pudo extraer JSON de la respuesta')
    }

    extracted = JSON.parse(jsonMatch[0]) as CamposVehiculo
    exitoso = true

    // Persistir los campos extraidos en custom_data
    await actualizarCamposVehiculo(oportunidadId, extracted)
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Error desconocido'

    // Registrar intento fallido en log
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (admin as any).from('ve_procesamiento_log').insert({
      workspace_id: workspaceId,
      oportunidad_id: oportunidadId,
      documentos_procesados: slugsProcesados,
      campos_extraidos: null,
      exitoso: false,
    })

    return { success: false, error: `Error procesando con Gemini: ${msg}` }
  }

  // Registrar extraccion exitosa en log de facturacion
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin as any).from('ve_procesamiento_log').insert({
    workspace_id: workspaceId,
    oportunidad_id: oportunidadId,
    documentos_procesados: slugsProcesados,
    campos_extraidos: extracted as unknown as Record<string, unknown>,
    exitoso,
  })

  return { success: true, data: extracted }
}
