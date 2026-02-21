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
