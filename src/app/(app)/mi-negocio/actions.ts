'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'
import { parseRut } from '@/lib/rut/parse-rut'
import type { RutParseResult, RutEmpresaUpdate } from '@/lib/rut/types'
import { getServerKey } from '@/lib/server-keys'

// ── Update Extended Fiscal Fields ────────────────────────

export async function updateFiscalExtended(data: {
  nit?: string
  razon_social?: string
  direccion_fiscal?: string
  email_facturacion?: string
}) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('fiscal_profiles')
    .update({
      nit: data.nit?.trim() || null,
      razon_social: data.razon_social?.trim() || null,
      direccion_fiscal: data.direccion_fiscal?.trim() || null,
      email_facturacion: data.email_facturacion?.trim() || null,
    })
    .eq('workspace_id', workspaceId)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/mi-negocio')
  revalidatePath('/config')
  return { success: true }
}

// ── Update Branding (logo, colors) ──────────────────────

export async function updateBranding(data: {
  logo_url?: string
  color_primario?: string
  color_secundario?: string
}) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('workspaces')
    .update({
      logo_url: data.logo_url?.trim() || null,
      color_primario: data.color_primario || '#10B981',
      color_secundario: data.color_secundario || '#1A1A1A',
    })
    .eq('id', workspaceId)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/mi-negocio')
  revalidatePath('/config')
  return { success: true }
}

// ── Upload Logo File ────────────────────────────────────

export async function uploadLogo(formData: FormData) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const file = formData.get('logo') as File
  if (!file || file.size === 0) return { success: false, error: 'No se seleccionó archivo' }

  // Validate
  const MAX_SIZE = 2 * 1024 * 1024 // 2MB
  const ALLOWED_TYPES = ['image/png', 'image/svg+xml', 'image/jpeg', 'image/webp']

  if (file.size > MAX_SIZE) return { success: false, error: 'El archivo no puede superar 2MB' }
  if (!ALLOWED_TYPES.includes(file.type)) return { success: false, error: 'Solo se permiten PNG, SVG, JPEG o WebP' }

  const ext = file.name.split('.').pop() || 'png'
  const filePath = `${workspaceId}/logo.${ext}`

  // Upload (upsert — replaces if exists)
  const { error: uploadError } = await supabase.storage
    .from('workspace-logos')
    .upload(filePath, file, { upsert: true })

  if (uploadError) return { success: false, error: uploadError.message }

  // Get public URL
  const { data: { publicUrl } } = supabase.storage
    .from('workspace-logos')
    .getPublicUrl(filePath)

  // Update workspace logo_url
  const { error: updateError } = await supabase
    .from('workspaces')
    .update({ logo_url: publicUrl })
    .eq('id', workspaceId)

  if (updateError) return { success: false, error: updateError.message }

  revalidatePath('/mi-negocio')
  revalidatePath('/config')
  return { success: true, url: publicUrl }
}

// ── D130: Update Margen de Contribución Estimado ────────

export async function updateMargenEstimado(margen: number) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  if (margen < 0.01 || margen > 0.99) return { success: false, error: 'Margen fuera de rango' }

  const { error: dbError } = await supabase
    .from('config_financiera')
    .upsert({
      workspace_id: workspaceId,
      margen_contribucion_estimado: margen,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'workspace_id' })

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/mi-negocio')
  revalidatePath('/numeros')
  return { success: true }
}

// ── Update Equipo Declarado ─────────────────────────────

export async function updateEquipoDeclarado(size: number) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('workspaces')
    .update({ equipo_declarado: Math.max(1, Math.floor(size)) })
    .eq('id', workspaceId)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/mi-negocio')
  return { success: true }
}

// ── RUT OCR Pipeline for Mi Negocio (fiscal_profiles) ───

const RUT_MAX_SIZE = 10 * 1024 * 1024 // 10MB
const RUT_ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

/**
 * Upload RUT document + OCR parse for mi-negocio (fiscal_profiles).
 * Mirrors directorio/actions uploadAndParseRUT but targets workspace storage.
 */
export async function uploadAndParseRutMiNegocio(
  formData: FormData,
): Promise<{ success: boolean; data?: RutParseResult; rutUrl?: string; error?: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Validate file
  const file = formData.get('rut') as File
  if (!file || file.size === 0) return { success: false, error: 'No se selecciono archivo' }
  if (file.size > RUT_MAX_SIZE) return { success: false, error: 'El archivo no puede superar 10MB' }
  if (!RUT_ALLOWED_TYPES.includes(file.type)) {
    return { success: false, error: 'Solo se permiten PDF, JPG, PNG o WebP' }
  }

  // Upload to Storage
  const ext = file.name.split('.').pop() || 'pdf'
  const ts = Date.now()
  const filePath = `${workspaceId}/mi-negocio/rut_${ts}.${ext}`

  const { error: uploadError } = await supabase.storage
    .from('rut-documents')
    .upload(filePath, file, { upsert: true })

  if (uploadError) return { success: false, error: `Error subiendo archivo: ${uploadError.message}` }

  // Get signed URL (private bucket)
  const { data: signedUrl } = await supabase.storage
    .from('rut-documents')
    .createSignedUrl(filePath, 60 * 60 * 24 * 365) // 1 year

  const rutUrl = signedUrl?.signedUrl || filePath

  // Parse with Gemini OCR
  const geminiKey = getServerKey('gemini')
  if (!geminiKey) {
    return { success: false, error: 'GEMINI_API_KEY no configurada en el servidor' }
  }

  const buffer = await file.arrayBuffer()
  const { data: parsed, error: parseError } = await parseRut(buffer, file.type, geminiKey)

  if (parseError || !parsed) {
    return { success: false, error: parseError || 'Error procesando el RUT' }
  }

  return { success: true, data: parsed, rutUrl }
}

/**
 * Confirm RUT data for mi-negocio after user review.
 * Maps RUT field names → fiscal_profiles column names and saves.
 */
export async function confirmRutDataMiNegocio(
  confirmedFields: RutEmpresaUpdate,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Map RUT field names → fiscal_profiles column names
  const updates: Record<string, unknown> = {}

  // Fields that need name mapping
  if (confirmedFields.numero_documento !== undefined) updates.nit = confirmedFields.numero_documento
  if (confirmedFields.tipo_persona !== undefined) updates.person_type = confirmedFields.tipo_persona
  if (confirmedFields.regimen_tributario !== undefined) updates.tax_regime = confirmedFields.regimen_tributario
  if (confirmedFields.responsable_iva !== undefined) updates.iva_responsible = confirmedFields.responsable_iva
  if (confirmedFields.autorretenedor !== undefined) updates.self_withholder = confirmedFields.autorretenedor
  if (confirmedFields.actividad_ciiu !== undefined) updates.ciiu = confirmedFields.actividad_ciiu

  // Direct-mapped fields (same name in both)
  if (confirmedFields.tipo_documento !== undefined) updates.tipo_documento = confirmedFields.tipo_documento
  if (confirmedFields.razon_social !== undefined) updates.razon_social = confirmedFields.razon_social
  if (confirmedFields.direccion_fiscal !== undefined) updates.direccion_fiscal = confirmedFields.direccion_fiscal
  if (confirmedFields.municipio !== undefined) updates.municipio = confirmedFields.municipio
  if (confirmedFields.departamento !== undefined) updates.departamento = confirmedFields.departamento
  if (confirmedFields.telefono !== undefined) updates.telefono = confirmedFields.telefono
  if (confirmedFields.email_fiscal !== undefined) updates.email_fiscal = confirmedFields.email_fiscal
  if (confirmedFields.gran_contribuyente !== undefined) updates.gran_contribuyente = confirmedFields.gran_contribuyente
  if (confirmedFields.agente_retenedor !== undefined) updates.agente_retenedor = confirmedFields.agente_retenedor
  if (confirmedFields.actividad_secundaria !== undefined) updates.actividad_secundaria = confirmedFields.actividad_secundaria
  if (confirmedFields.fecha_inicio_actividades !== undefined) updates.fecha_inicio_actividades = confirmedFields.fecha_inicio_actividades

  // RUT metadata
  if (confirmedFields.rut_documento_url !== undefined) updates.rut_documento_url = confirmedFields.rut_documento_url
  updates.rut_fecha_carga = new Date().toISOString()
  if (confirmedFields.rut_confianza_ocr !== undefined) updates.rut_confianza_ocr = confirmedFields.rut_confianza_ocr
  updates.rut_verificado = true

  // Mark fiscal profile as complete
  updates.is_complete = true

  // Save to fiscal_profiles
  const { error: dbError } = await supabase
    .from('fiscal_profiles')
    .update(updates)
    .eq('workspace_id', workspaceId)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/mi-negocio')
  revalidatePath('/config')
  revalidatePath('/numeros')
  revalidatePath('/pipeline')
  return { success: true }
}
