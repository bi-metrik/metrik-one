'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

// ── Contactos ─────────────────────────────────────────────

// Origen (primer toque) grabado en el contacto desde el webhook (custom_data.origen).
// Es first-touch inmutable: la campaña por la que el contacto llego la primera vez.
export interface OrigenContacto {
  fuente?: string | null
  campaign_id?: string | null
  campaign_name?: string | null
  adset_name?: string | null
  ad_name?: string | null
  platform?: string | null
  first_at?: string | null
}

// Contacto enriquecido para la vista general (calcado del patron de /negocios):
// marca Meta, ultima interaccion (cualquiera y solo Meta) y origen de campana.
export interface ContactoConMeta {
  id: string
  nombre: string
  telefono: string | null
  email: string | null
  fuente_adquisicion: string | null
  rol: string | null
  segmento: string | null
  comision_porcentaje: number | null
  created_at: string | null
  es_meta: boolean
  ultima_interaccion_at: string | null
  ultima_interaccion_meta_at: string | null
  origen: OrigenContacto | null
  responsable_id: string | null
  responsable_nombre: string | null
}

export async function getContactos(): Promise<ContactoConMeta[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  // responsable_id aun no esta en database.ts generado (migracion reciente) → cast.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: contactos } = await (supabase as any)
    .from('contactos')
    .select('id, nombre, telefono, email, fuente_adquisicion, rol, segmento, comision_porcentaje, created_at, custom_data, responsable_id')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  const rows = (contactos ?? []) as Array<{
    id: string
    nombre: string
    telefono: string | null
    email: string | null
    fuente_adquisicion: string | null
    rol: string | null
    segmento: string | null
    comision_porcentaje: number | null
    created_at: string | null
    custom_data: { origen?: OrigenContacto } | null
    responsable_id: string | null
  }>
  if (rows.length === 0) return []

  // Mapa de nombres de staff para resolver el responsable de cada contacto.
  const { data: staffRows } = await supabase
    .from('staff')
    .select('id, full_name')
    .eq('workspace_id', workspaceId)
  const staffMap = new Map<string, string>(
    ((staffRows ?? []) as Array<{ id: string; full_name: string }>).map((s) => [s.id, s.full_name]),
  )

  // Agregado de interacciones por contacto (a 95 contactos, un solo fetch + reduce
  // en memoria es suficiente; no amerita columnas cacheadas ni triggers).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: inters } = await (supabase as any)
    .from('contacto_interacciones')
    .select('contacto_id, fuente, ocurrida_at, created_at')
    .eq('workspace_id', workspaceId)

  const agg = new Map<string, { last: string | null; lastMeta: string | null; meta: boolean }>()
  for (const it of (inters ?? []) as Array<{ contacto_id: string; fuente: string; ocurrida_at: string | null; created_at: string | null }>) {
    const when = it.ocurrida_at ?? it.created_at
    const cur = agg.get(it.contacto_id) ?? { last: null, lastMeta: null, meta: false }
    if (when && (!cur.last || when > cur.last)) cur.last = when
    if (it.fuente === 'meta') {
      cur.meta = true
      if (when && (!cur.lastMeta || when > cur.lastMeta)) cur.lastMeta = when
    }
    agg.set(it.contacto_id, cur)
  }

  return rows.map((c) => {
    const a = agg.get(c.id)
    return {
      id: c.id,
      nombre: c.nombre,
      telefono: c.telefono,
      email: c.email,
      fuente_adquisicion: c.fuente_adquisicion,
      rol: c.rol,
      segmento: c.segmento,
      comision_porcentaje: c.comision_porcentaje,
      created_at: c.created_at,
      es_meta: a?.meta ?? false,
      ultima_interaccion_at: a?.last ?? null,
      ultima_interaccion_meta_at: a?.lastMeta ?? null,
      origen: c.custom_data?.origen ?? null,
      responsable_id: c.responsable_id,
      responsable_nombre: c.responsable_id ? (staffMap.get(c.responsable_id) ?? null) : null,
    }
  })
}

// staff.id del usuario logueado (para pre-filtrar contactos "Mis contactos").
// null si el usuario no es staff del workspace.
export async function getMiStaffId(): Promise<string | null> {
  const { staffId, error } = await getWorkspace()
  if (error) return null
  return staffId ?? null
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
      // Nombres de contacto en MAYUSCULAS (homogeneo con negocios).
      nombre: nombre.trim().toUpperCase(),
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
    if (v !== null) {
      const val = v.trim() || null
      // El nombre se guarda en MAYUSCULAS (homogeneo con negocios); email intacto.
      updates[f] = f === 'nombre' && val ? val.toUpperCase() : val
    }
  }
  if (formData.get('comision_porcentaje') !== null) {
    const raw = formData.get('comision_porcentaje') as string
    updates.comision_porcentaje = raw ? parseFloat(raw) : null
  }
  // Responsable comercial del contacto (staff.id). Cadena vacía → sin responsable.
  if (formData.get('responsable_id') !== null) {
    const raw = (formData.get('responsable_id') as string).trim()
    updates.responsable_id = raw || null
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

// ── Staff para selector de responsable (contacto) ─────────
// Devuelve el staff activo del workspace para poblar el selector "Responsable"
// del Contacto 360. Prioriza el área comercial (staff_areas.area='comercial');
// si no hay ninguno con esa área, cae a todo el staff activo (evita un selector
// vacío en workspaces que no clasifican por área).

export interface StaffOption {
  id: string
  full_name: string
}

export async function getStaffParaResponsable(): Promise<StaffOption[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data: activos } = await supabase
    .from('staff')
    .select('id, full_name')
    .eq('workspace_id', workspaceId)
    .eq('is_active', true)
    .order('full_name')

  const staff = (activos ?? []) as StaffOption[]
  if (staff.length === 0) return []

  // Filtrar a comercial si hay quienes tengan esa área asignada.
  const { data: areas } = await supabase
    .from('staff_areas')
    .select('staff_id')
    .eq('area', 'comercial')
    .in('staff_id', staff.map((s) => s.id))

  const comercialIds = new Set(((areas ?? []) as { staff_id: string }[]).map((a) => a.staff_id))
  if (comercialIds.size > 0) {
    return staff.filter((s) => comercialIds.has(s.id))
  }
  return staff
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
      codigo: '', // trigger auto-genera
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

  // Check for related negocios before deleting
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: negociosAsociados } = await (supabase as any)
    .from('negocios')
    .select('id')
    .eq('empresa_id', id)
    .limit(1)

  if (negociosAsociados && negociosAsociados.length > 0) {
    return {
      success: false,
      error: 'No se puede eliminar esta empresa porque tiene negocios asociados. Elimina primero los negocios.',
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

// ── Negocios por empresa/contacto (para vistas 360) ────────

export async function getNegociosPorEmpresa(empresaId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('negocios')
    .select('id, nombre, codigo, estado, stage_actual, precio_estimado, created_at, contactos(nombre)')
    .eq('empresa_id', empresaId)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function getNegociosPorContacto(contactoId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('negocios')
    .select('id, nombre, codigo, estado, stage_actual, precio_estimado, created_at, empresas(nombre)')
    .eq('contacto_id', contactoId)
    .order('created_at', { ascending: false })

  return data ?? []
}

// ── Interacciones del contacto (bandeja de leads / timeline) ──────────
// Interacciones entrantes (Meta / WhatsApp / web / manual) del contacto, más
// recientes primero. Alimenta la línea de tiempo del Contacto 360 y sus acciones
// (crear negocio, marcar contactada, descartar).

export interface InteraccionContacto {
  id: string
  fuente: string
  fuente_ref: string | null
  estado: string
  negocio_id: string | null
  payload: Record<string, unknown> | null
  ocurrida_at: string | null
  created_at: string | null
}

export async function getInteraccionesPorContacto(contactoId: string): Promise<InteraccionContacto[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('contacto_interacciones')
    .select('id, fuente, fuente_ref, estado, negocio_id, payload, ocurrida_at, created_at')
    .eq('workspace_id', workspaceId)
    .eq('contacto_id', contactoId)
    .order('ocurrida_at', { ascending: false, nullsFirst: false })
    .order('created_at', { ascending: false })

  return (data ?? []) as InteraccionContacto[]
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
import { getServerKey } from '@/lib/server-keys'

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
  revalidatePath('/negocios')
  return { success: true }
}
