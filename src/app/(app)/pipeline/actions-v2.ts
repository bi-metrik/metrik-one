'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

// ── Oportunidades ─────────────────────────────────────────

export async function getOportunidades() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('oportunidades')
    .select('*, contactos(nombre), empresas(nombre, nit, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function getOportunidad(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return null

  const { data } = await supabase
    .from('oportunidades')
    .select('*, contactos(id, nombre, telefono, email), empresas(id, nombre, sector, nit, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor)')
    .eq('id', id)
    .single()

  return data
}

export async function createOportunidad(input: {
  contacto_id?: string
  empresa_id?: string
  contacto_nombre?: string
  contacto_telefono?: string
  contacto_fuente?: string
  empresa_nombre?: string
  empresa_sector?: string
  descripcion: string
  valor_estimado: number
}) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  let contactoId = input.contacto_id ?? null
  let empresaId = input.empresa_id ?? null

  // Create contacto if new
  if (!contactoId && input.contacto_nombre?.trim()) {
    const { data } = await supabase
      .from('contactos')
      .insert({
        workspace_id: workspaceId,
        nombre: input.contacto_nombre.trim(),
        telefono: input.contacto_telefono?.trim() || null,
        fuente_adquisicion: input.contacto_fuente || null,
      })
      .select('id')
      .single()
    if (data) contactoId = data.id
  }

  // Create empresa if new
  if (!empresaId && input.empresa_nombre?.trim()) {
    const { data } = await supabase
      .from('empresas')
      .insert({
        workspace_id: workspaceId,
        nombre: input.empresa_nombre.trim(),
        sector: input.empresa_sector || null,
      })
      .select('id')
      .single()
    if (data) empresaId = data.id
  }

  if (!contactoId || !empresaId) {
    return { success: false, error: 'Contacto y empresa son requeridos' }
  }

  const { data, error: dbError } = await supabase
    .from('oportunidades')
    .insert({
      workspace_id: workspaceId,
      contacto_id: contactoId,
      empresa_id: empresaId,
      descripcion: input.descripcion.trim(),
      valor_estimado: input.valor_estimado,
      etapa: 'lead_nuevo',
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/pipeline')
  revalidatePath('/directorio/contactos')
  revalidatePath('/directorio/empresas')
  return { success: true, id: data.id }
}

export async function moveOportunidad(id: string, nuevaEtapa: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('oportunidades')
    .update({
      etapa: nuevaEtapa,
      ultima_accion: `Movida a ${nuevaEtapa}`,
      ultima_accion_fecha: new Date().toISOString(),
    })
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/pipeline')
  revalidatePath(`/pipeline/${id}`)
  return { success: true }
}

export async function perderOportunidad(id: string, razon: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('oportunidades')
    .update({
      etapa: 'perdida',
      razon_perdida: razon,
      ultima_accion: 'Marcada como perdida',
      ultima_accion_fecha: new Date().toISOString(),
    })
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/pipeline')
  revalidatePath(`/pipeline/${id}`)
  return { success: true }
}

/**
 * Hard gate: ganar oportunidad. Si la empresa no tiene perfil fiscal completo,
 * se puede pasar los datos fiscales faltantes y se hace UPDATE atomico.
 */
export async function ganarOportunidad(id: string, fiscalData?: {
  empresa_id: string
  nit?: string
  tipo_persona?: string
  regimen_tributario?: string
  gran_contribuyente?: boolean
  agente_retenedor?: boolean
}) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Get the oportunidad to find empresa_id
  const { data: opp } = await supabase
    .from('oportunidades')
    .select('empresa_id, descripcion, valor_estimado, contacto_id')
    .eq('id', id)
    .single()

  if (!opp) return { success: false, error: 'Oportunidad no encontrada' }

  const empresaId = opp.empresa_id
  if (!empresaId) return { success: false, error: 'Sin empresa asociada' }

  // If fiscal data provided, update empresa first
  if (fiscalData) {
    const updates: Record<string, unknown> = {}
    if (fiscalData.nit) updates.nit = fiscalData.nit
    if (fiscalData.tipo_persona) updates.tipo_persona = fiscalData.tipo_persona
    if (fiscalData.regimen_tributario) updates.regimen_tributario = fiscalData.regimen_tributario
    if (fiscalData.gran_contribuyente !== undefined) updates.gran_contribuyente = fiscalData.gran_contribuyente
    if (fiscalData.agente_retenedor !== undefined) updates.agente_retenedor = fiscalData.agente_retenedor

    if (Object.keys(updates).length > 0) {
      const { error: updateError } = await supabase
        .from('empresas')
        .update(updates)
        .eq('id', empresaId)
      if (updateError) return { success: false, error: updateError.message }
    }
  }

  // Check fiscal completeness via DB function
  const { data: fiscalCheck } = await supabase.rpc('check_perfil_fiscal_completo', {
    p_empresa_id: empresaId,
  })

  if (!fiscalCheck) {
    return { success: false, error: 'fiscal_incompleto', needsFiscal: true }
  }

  // Move to ganada
  const { error: moveError } = await supabase
    .from('oportunidades')
    .update({
      etapa: 'ganada',
      ultima_accion: 'Oportunidad ganada',
      ultima_accion_fecha: new Date().toISOString(),
    })
    .eq('id', id)

  if (moveError) return { success: false, error: moveError.message }

  // Create proyecto
  const workspaceResult = await getWorkspace()
  if (workspaceResult.workspaceId) {
    await supabase.from('proyectos').insert({
      workspace_id: workspaceResult.workspaceId,
      oportunidad_id: id,
      empresa_id: empresaId,
      contacto_id: opp.contacto_id,
      nombre: opp.descripcion ?? 'Proyecto sin nombre',
      estado: 'en_ejecucion',
      presupuesto_total: opp.valor_estimado ?? 0,
    })
  }

  revalidatePath('/pipeline')
  revalidatePath(`/pipeline/${id}`)
  revalidatePath('/proyectos')
  return { success: true }
}

export async function updateOportunidad(id: string, updates: Record<string, unknown>) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('oportunidades')
    .update(updates)
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/pipeline')
  revalidatePath(`/pipeline/${id}`)
  return { success: true }
}
