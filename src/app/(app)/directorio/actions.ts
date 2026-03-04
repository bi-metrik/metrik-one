'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

// ── Contactos ─────────────────────────────────────────────

export async function getContactos() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('contactos')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function getContacto(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return null

  const { data } = await supabase
    .from('contactos')
    .select('*')
    .eq('id', id)
    .single()

  return data
}

export async function createContacto(formData: FormData) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const nombre = formData.get('nombre') as string
  if (!nombre?.trim()) return { success: false, error: 'Nombre requerido' }

  const { data, error: dbError } = await supabase
    .from('contactos')
    .insert({
      workspace_id: workspaceId,
      nombre: nombre.trim(),
      telefono: (formData.get('telefono') as string)?.trim() || null,
      email: (formData.get('email') as string)?.trim() || null,
      fuente_adquisicion: (formData.get('fuente_adquisicion') as string) || null,
      fuente_detalle: (formData.get('fuente_detalle') as string)?.trim() || null,
      rol: (formData.get('rol') as string) || null,
      segmento: (formData.get('segmento') as string) || 'sin_contactar',
      comision_porcentaje: formData.get('comision_porcentaje')
        ? parseFloat(formData.get('comision_porcentaje') as string)
        : null,
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/directorio/contactos')
  return { success: true, id: data.id }
}

export async function updateContacto(id: string, formData: FormData) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const updates: Record<string, unknown> = {}
  const fields = ['nombre', 'telefono', 'email', 'fuente_adquisicion', 'fuente_detalle', 'rol', 'segmento'] as const
  for (const f of fields) {
    const v = formData.get(f) as string | null
    if (v !== null) updates[f] = v.trim() || null
  }
  if (formData.get('comision_porcentaje') !== null) {
    const raw = formData.get('comision_porcentaje') as string
    updates.comision_porcentaje = raw ? parseFloat(raw) : null
  }

  const { error: dbError } = await supabase
    .from('contactos')
    .update(updates)
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/directorio/contactos')
  revalidatePath(`/directorio/contacto/${id}`)
  return { success: true }
}

export async function deleteContacto(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('contactos')
    .delete()
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/directorio/contactos')
  return { success: true }
}

export async function updateContactoSegmento(id: string, segmento: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const valid = ['sin_contactar', 'contactado', 'convertido', 'inactivo']
  if (!valid.includes(segmento)) return { success: false, error: 'Segmento invalido' }

  const { error: dbError } = await supabase
    .from('contactos')
    .update({ segmento })
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/directorio/contactos')
  revalidatePath(`/directorio/contacto/${id}`)
  return { success: true }
}

export async function searchContactos(query: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('contactos')
    .select('id, nombre, telefono, email')
    .eq('workspace_id', workspaceId)
    .ilike('nombre', `%${query}%`)
    .limit(10)

  return data ?? []
}

// ── Empresas ──────────────────────────────────────────────

export async function getEmpresas() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('empresas')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function getEmpresa(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return null

  const { data } = await supabase
    .from('empresas')
    .select('*')
    .eq('id', id)
    .single()

  return data
}

export async function createEmpresa(formData: FormData) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const nombre = formData.get('nombre') as string
  if (!nombre?.trim()) return { success: false, error: 'Nombre requerido' }

  const { data, error: dbError } = await supabase
    .from('empresas')
    .insert({
      workspace_id: workspaceId,
      nombre: nombre.trim(),
      sector: (formData.get('sector') as string) || null,
      numero_documento: (formData.get('numero_documento') as string)?.trim() || null,
      tipo_documento: (formData.get('tipo_documento') as string) || null,
      tipo_persona: (formData.get('tipo_persona') as string) || null,
      regimen_tributario: (formData.get('regimen_tributario') as string) || null,
      gran_contribuyente: formData.get('gran_contribuyente') === 'true',
      agente_retenedor: formData.get('agente_retenedor') === 'true',
      contacto_id: (formData.get('contacto_id') as string) || null,
      contacto_nombre: (formData.get('contacto_nombre') as string)?.trim() || null,
      contacto_email: (formData.get('contacto_email') as string)?.trim() || null,
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/directorio/empresas')
  return { success: true, id: data.id }
}

export async function updateEmpresa(id: string, formData: FormData) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const updates: Record<string, unknown> = {}
  const textFields = ['nombre', 'sector', 'numero_documento', 'tipo_documento', 'tipo_persona', 'regimen_tributario', 'contacto_id', 'contacto_nombre', 'contacto_email'] as const
  for (const f of textFields) {
    const v = formData.get(f) as string | null
    if (v !== null) updates[f] = v.trim() || null
  }
  const boolFields = ['gran_contribuyente', 'agente_retenedor'] as const
  for (const f of boolFields) {
    const v = formData.get(f) as string | null
    if (v !== null) updates[f] = v === 'true'
  }

  const { error: dbError } = await supabase
    .from('empresas')
    .update(updates)
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/directorio/empresas')
  revalidatePath(`/directorio/empresa/${id}`)
  return { success: true }
}

export async function deleteEmpresa(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Check for related oportunidades before deleting
  const { data: oportunidades } = await supabase
    .from('oportunidades')
    .select('id')
    .eq('empresa_id', id)
    .limit(1)

  if (oportunidades && oportunidades.length > 0) {
    return {
      success: false,
      error: 'No se puede eliminar esta empresa porque tiene oportunidades asociadas en el pipeline. Elimina primero las oportunidades.',
    }
  }

  const { error: dbError } = await supabase
    .from('empresas')
    .delete()
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/directorio/empresas')
  return { success: true }
}

export async function searchEmpresas(query: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('empresas')
    .select('id, nombre, sector, numero_documento, tipo_documento, contacto_id')
    .eq('workspace_id', workspaceId)
    .ilike('nombre', `%${query}%`)
    .limit(10)

  return data ?? []
}

export async function checkPerfilFiscal(empresaId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { complete: false, missing: ['Error de autenticacion'] }

  const { data } = await supabase
    .from('empresas')
    .select('numero_documento, tipo_documento, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor')
    .eq('id', empresaId)
    .single()

  if (!data) return { complete: false, missing: ['Empresa no encontrada'] }

  const missing: string[] = []
  if (!data.numero_documento) missing.push('Documento')
  if (!data.tipo_documento) missing.push('Tipo de documento')
  if (!data.tipo_persona) missing.push('Tipo de persona')
  if (!data.regimen_tributario) missing.push('Regimen tributario')
  if (data.gran_contribuyente === null) missing.push('Gran contribuyente')
  if (data.agente_retenedor === null) missing.push('Agente retenedor')

  return { complete: missing.length === 0, missing }
}

// ── Oportunidades por contacto/empresa (para vistas 360) ──

export async function getOportunidadesPorContacto(contactoId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  const { data } = await supabase
    .from('oportunidades')
    .select('id, descripcion, etapa, valor_estimado, created_at, empresas(nombre)')
    .eq('contacto_id', contactoId)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function getOportunidadesPorEmpresa(empresaId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  const { data } = await supabase
    .from('oportunidades')
    .select('id, descripcion, etapa, valor_estimado, created_at, contactos(nombre)')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function getProyectosPorEmpresa(empresaId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  const { data } = await supabase
    .from('proyectos')
    .select('id, nombre, estado, presupuesto_total, avance_porcentaje, created_at')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })

  return data ?? []
}

// ── Vinculo persona natural: empresa <-> contacto ─────────

export async function getEmpresaByContacto(contactoId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return null

  const { data } = await supabase
    .from('empresas')
    .select('id, nombre')
    .eq('contacto_id', contactoId)
    .maybeSingle()

  return data
}

// ── RUT OCR Pipeline (D69-D77) ──────────────────────────────

import { parseRut } from '@/lib/rut/parse-rut'
import type { RutParseResult, RutEmpresaUpdate } from '@/lib/rut/types'

const RUT_MAX_SIZE = 10 * 1024 * 1024 // 10MB
const RUT_ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp']

/**
 * Step 1: Upload RUT document + OCR parse.
 * Returns parsed data for user confirmation (D76: no auto-save).
 */
export async function uploadAndParseRUT(
  empresaId: string,
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

  // Verify empresa belongs to workspace
  const { data: empresa } = await supabase
    .from('empresas')
    .select('id')
    .eq('id', empresaId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!empresa) return { success: false, error: 'Empresa no encontrada' }

  // Upload to Storage
  const ext = file.name.split('.').pop() || 'pdf'
  const ts = Date.now()
  const filePath = `${workspaceId}/empresas/${empresaId}/rut_${ts}.${ext}`

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
  const buffer = await file.arrayBuffer()
  const { data: parsed, error: parseError } = await parseRut(buffer, file.type)

  if (parseError || !parsed) {
    return { success: false, error: parseError || 'Error procesando el RUT' }
  }

  return { success: true, data: parsed, rutUrl }
}

/**
 * Step 2: Confirm RUT data after user review (D76).
 * Saves all confirmed fields to empresas + recalculates estado_fiscal.
 */
export async function confirmRutData(
  empresaId: string,
  confirmedFields: RutEmpresaUpdate,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Build update object — only include non-undefined fields
  const updates: Record<string, unknown> = {}

  if (confirmedFields.numero_documento !== undefined) updates.numero_documento = confirmedFields.numero_documento
  if (confirmedFields.tipo_documento !== undefined) updates.tipo_documento = confirmedFields.tipo_documento
  if (confirmedFields.tipo_persona !== undefined) updates.tipo_persona = confirmedFields.tipo_persona
  if (confirmedFields.regimen_tributario !== undefined) updates.regimen_tributario = confirmedFields.regimen_tributario
  if (confirmedFields.gran_contribuyente !== undefined) updates.gran_contribuyente = confirmedFields.gran_contribuyente
  if (confirmedFields.agente_retenedor !== undefined) updates.agente_retenedor = confirmedFields.agente_retenedor
  if (confirmedFields.autorretenedor !== undefined) updates.autorretenedor = confirmedFields.autorretenedor
  if (confirmedFields.responsable_iva !== undefined) updates.responsable_iva = confirmedFields.responsable_iva
  if (confirmedFields.razon_social !== undefined) updates.razon_social = confirmedFields.razon_social
  if (confirmedFields.direccion_fiscal !== undefined) updates.direccion_fiscal = confirmedFields.direccion_fiscal
  if (confirmedFields.municipio !== undefined) updates.municipio = confirmedFields.municipio
  if (confirmedFields.departamento !== undefined) updates.departamento = confirmedFields.departamento
  if (confirmedFields.telefono !== undefined) updates.telefono = confirmedFields.telefono
  if (confirmedFields.email_fiscal !== undefined) updates.email_fiscal = confirmedFields.email_fiscal
  if (confirmedFields.actividad_ciiu !== undefined) updates.actividad_ciiu = confirmedFields.actividad_ciiu
  if (confirmedFields.actividad_secundaria !== undefined) updates.actividad_secundaria = confirmedFields.actividad_secundaria
  if (confirmedFields.fecha_inicio_actividades !== undefined) updates.fecha_inicio_actividades = confirmedFields.fecha_inicio_actividades

  // RUT metadata
  if (confirmedFields.rut_documento_url !== undefined) updates.rut_documento_url = confirmedFields.rut_documento_url
  updates.rut_fecha_carga = new Date().toISOString()
  if (confirmedFields.rut_confianza_ocr !== undefined) updates.rut_confianza_ocr = confirmedFields.rut_confianza_ocr
  updates.rut_verificado = true

  // Recalculate estado_fiscal (merge current + updates)
  const { data: currentEmpresa } = await supabase
    .from('empresas')
    .select('numero_documento, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor, autorretenedor')
    .eq('id', empresaId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!currentEmpresa) return { success: false, error: 'Empresa no encontrada' }

  const merged = { ...currentEmpresa, ...updates }
  const hardGateFields = ['numero_documento', 'tipo_persona', 'regimen_tributario', 'gran_contribuyente', 'agente_retenedor', 'autorretenedor'] as const
  const filled = hardGateFields.filter(f => merged[f] != null).length
  updates.estado_fiscal = filled === 0 ? 'pendiente' : filled === 6 ? 'verificado' : 'parcial'

  // Save
  const { error: dbError } = await supabase
    .from('empresas')
    .update(updates)
    .eq('id', empresaId)
    .eq('workspace_id', workspaceId)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/directorio/empresas')
  revalidatePath(`/directorio/empresa/${empresaId}`)
  revalidatePath('/pipeline')
  return { success: true }
}
