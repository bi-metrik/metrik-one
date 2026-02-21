'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

// ── Oportunidades ─────────────────────────────────────────

export async function getOportunidades() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('oportunidades')
    .select('*, contactos(nombre), empresas(nombre, numero_documento, tipo_documento, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function getOportunidad(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return null

  const { data } = await supabase
    .from('oportunidades')
    .select('*, contactos(id, nombre, telefono, email), empresas(id, nombre, sector, numero_documento, tipo_documento, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor)')
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
  es_persona_natural?: boolean
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

  // Handle persona natural: auto-create empresa linked to contacto
  if (input.es_persona_natural && contactoId) {
    // Look for existing empresa linked to this contacto
    const { data: existingEmpresa } = await supabase
      .from('empresas')
      .select('id')
      .eq('contacto_id', contactoId)
      .maybeSingle()

    if (existingEmpresa) {
      empresaId = existingEmpresa.id
    } else {
      // Get contacto name for empresa
      let contactName = input.contacto_nombre?.trim() || 'Persona Natural'
      if (!input.contacto_nombre && contactoId) {
        const { data: c } = await supabase.from('contactos').select('nombre').eq('id', contactoId).single()
        if (c) contactName = c.nombre
      }
      const { data: newEmpresa } = await supabase
        .from('empresas')
        .insert({
          workspace_id: workspaceId,
          nombre: contactName,
          tipo_persona: 'natural',
          contacto_id: contactoId,
          tipo_documento: 'CC',
        })
        .select('id')
        .single()
      if (newEmpresa) empresaId = newEmpresa.id
    }
  }

  // Create empresa if new (normal flow, not persona natural)
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
  numero_documento?: string
  tipo_documento?: string
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
    if (fiscalData.numero_documento) updates.numero_documento = fiscalData.numero_documento
    if (fiscalData.tipo_documento) updates.tipo_documento = fiscalData.tipo_documento
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

  // Get the workspace ID (we already have supabase from above)
  const workspaceResult = await getWorkspace()
  const wsId = workspaceResult.workspaceId
  if (!wsId) return { success: false, error: 'Sin workspace' }

  // Find best cotización: prefer aceptada, fallback to any
  const { data: cotizacion } = await supabase
    .from('cotizaciones')
    .select('id, modo, valor_total')
    .eq('oportunidad_id', id)
    .order('estado', { ascending: true }) // aceptada sorts first alphabetically
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  // Calculate financials from cotización items if available
  let gananciaEstimada: number | null = null
  let retencionesEstimadas: number | null = null
  let horasEstimadas: number | null = null
  let presupuestoTotal = opp.valor_estimado ?? 0

  if (cotizacion) {
    presupuestoTotal = cotizacion.valor_total ?? presupuestoTotal

    // Get items + rubros for detailed cotizaciones
    if (cotizacion.modo === 'detallada') {
      const { data: rubrosData } = await supabase
        .from('rubros')
        .select('tipo, cantidad, item_id, items!inner(cotizacion_id)')
        .eq('items.cotizacion_id', cotizacion.id)

      if (rubrosData && rubrosData.length > 0) {
        // Estimate hours from MO rubros
        horasEstimadas = rubrosData
          .filter(r => r.tipo === 'mo_propia' || r.tipo === 'mo_terceros')
          .reduce((sum, r) => sum + (r.cantidad ?? 0), 0) || null
      }
    }
  }

  // Inherit carpeta_url from oportunidad
  const { data: oppFull } = await supabase
    .from('oportunidades')
    .select('carpeta_url')
    .eq('id', id)
    .single()

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

  // Create proyecto with full data
  const { data: proyecto, error: projError } = await supabase
    .from('proyectos')
    .insert({
      workspace_id: wsId,
      oportunidad_id: id,
      cotizacion_id: cotizacion?.id ?? null,
      empresa_id: empresaId,
      contacto_id: opp.contacto_id,
      nombre: opp.descripcion ?? 'Proyecto sin nombre',
      estado: 'en_ejecucion',
      presupuesto_total: presupuestoTotal,
      ganancia_estimada: gananciaEstimada,
      retenciones_estimadas: retencionesEstimadas,
      horas_estimadas: horasEstimadas,
      carpeta_url: oppFull?.carpeta_url ?? null,
      canal_creacion: 'app',
    })
    .select('id')
    .single()

  if (projError || !proyecto) {
    return { success: false, error: projError?.message ?? 'Error creando proyecto' }
  }

  // Create proyecto_rubros from cotización items
  if (cotizacion) {
    if (cotizacion.modo === 'detallada') {
      // Get items with their first rubro type
      const { data: items } = await supabase
        .from('items')
        .select('nombre, subtotal, rubros(tipo)')
        .eq('cotizacion_id', cotizacion.id)

      if (items && items.length > 0) {
        const rubrosToInsert = items.map(item => {
          const firstRubroTipo = Array.isArray(item.rubros) && item.rubros.length > 0
            ? (item.rubros[0] as { tipo: string }).tipo
            : null
          return {
            proyecto_id: proyecto.id,
            nombre: item.nombre ?? 'Sin nombre',
            presupuestado: item.subtotal ?? 0,
            tipo: mapTipoRubro(firstRubroTipo),
          }
        })

        await supabase.from('proyecto_rubros').insert(rubrosToInsert)
      }
    } else {
      // Flash: single "general" rubro
      await supabase.from('proyecto_rubros').insert({
        proyecto_id: proyecto.id,
        nombre: 'General',
        presupuestado: presupuestoTotal,
        tipo: 'general',
      })
    }
  }

  revalidatePath('/pipeline')
  revalidatePath(`/pipeline/${id}`)
  revalidatePath('/proyectos')
  return { success: true, proyectoId: proyecto.id }
}

// Helper: map cotización tipo_rubro to proyecto_rubros tipo
function mapTipoRubro(tipo: string | null): string {
  const map: Record<string, string> = {
    mo_propia: 'horas',
    mo_terceros: 'subcontratacion',
    materiales: 'materiales',
    viaticos: 'transporte',
    software: 'servicios_profesionales',
    servicios_prof: 'servicios_profesionales',
  }
  return map[tipo ?? ''] ?? 'general'
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
