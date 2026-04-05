'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { revalidatePath } from 'next/cache'
import { logSystemChange } from '@/app/(app)/activity-actions'
import { checkTenantRules, BlockTransitionError } from '@/lib/tenant-rules'

// ── Tipo extendido para etapas con proceso (post-migración multi-proceso) ──

export interface WorkspaceStageWithProceso {
  id: string
  nombre: string
  slug: string
  sistema_slug: string | null
  orden: number
  es_sistema: boolean
  es_terminal: boolean
  proceso: string | null
  activo: boolean
}

// ── Etapas del workspace (con proceso) ────────────────────

export async function getWorkspaceStagesPipeline(): Promise<WorkspaceStageWithProceso[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('workspace_stages')
    .select('id, nombre, slug, sistema_slug, orden, es_sistema, es_terminal, proceso, activo')
    .eq('workspace_id', workspaceId)
    .eq('entidad', 'oportunidad')
    .eq('activo', true)
    .order('orden', { ascending: true })

  return (data ?? []) as WorkspaceStageWithProceso[]
}

// ── Oportunidades ─────────────────────────────────────────

export async function getOportunidades() {
  const { supabase, workspaceId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const perms = getRolePermissions(role || '')

  let query = supabase
    .from('oportunidades')
    .select('*, contactos(nombre), empresas(nombre, codigo, numero_documento, tipo_documento, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor), staff:responsable_id(id, full_name)')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  // Operator: only see assigned records
  if (!perms.canViewAllProjects && staffId) {
    query = query.or(`responsable_id.eq.${staffId},colaboradores.cs.{${staffId}}`)
  }

  const { data } = await query

  return data ?? []
}

export async function getOportunidad(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return null

  const { data } = await supabase
    .from('oportunidades')
    .select('*, contactos(id, nombre, telefono, email), empresas(id, nombre, codigo, sector, numero_documento, tipo_documento, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor, autorretenedor), staff:responsable_id(id, full_name)')
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
  responsable_id?: string
  custom_data?: Record<string, unknown>
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
          codigo: '',
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
        codigo: '',
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
      responsable_id: input.responsable_id || null,
      etapa: 'lead_nuevo',
      codigo: '',
      ...(input.custom_data && Object.keys(input.custom_data).length > 0
        ? { custom_data: input.custom_data as unknown as Record<string, never> }
        : {}),
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
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Get current etapa + custom_data para contexto de reglas
  const { data: current } = await supabase
    .from('oportunidades')
    .select('etapa, custom_data')
    .eq('id', id)
    .single()

  // ── Gate E2: contactado requiere al menos 1 entrada en activity_log ──
  if (nuevaEtapa === 'contactado') {
    const { count } = await supabase
      .from('activity_log')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .eq('entity_type', 'oportunidad')
      .eq('entity_id', id)

    if (!count || count === 0) {
      return {
        success: false,
        error: 'Debes registrar al menos un comentario sobre el contacto con el cliente antes de avanzar.',
      }
    }
  }

  // ── Evaluar gates (tenant_rules) ANTES de persistir el cambio ──
  // estado_nuevo y estado_anterior en el contexto para que las reglas
  // puedan filtrar por etapa destino específica (ej: solo bloquear "ganada").
  try {
    await checkTenantRules(
      workspaceId,
      'oportunidad',
      'status_change',
      {
        id,
        workspace_id: workspaceId,
        estado_nuevo: nuevaEtapa,
        estado_anterior: current?.etapa ?? null,
        ...(current?.custom_data as Record<string, unknown> ?? {}),
        custom_data: current?.custom_data,
      },
    )
  } catch (e) {
    if (e instanceof BlockTransitionError) {
      return { success: false, error: e.message }
    }
    // Error de infraestructura — no bloquear al usuario
  }

  const { error: dbError } = await supabase
    .from('oportunidades')
    .update({
      etapa: nuevaEtapa,
      ultima_accion: `Movida a ${nuevaEtapa}`,
      ultima_accion_fecha: new Date().toISOString(),
      etapa_changed_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  // Log activity
  if (workspaceId) {
    await logSystemChange(workspaceId, 'oportunidad', id, 'etapa', current?.etapa ?? null, nuevaEtapa, staffId)
  }

  revalidatePath('/pipeline')
  revalidatePath(`/pipeline/${id}`)
  return { success: true }
}

export async function perderOportunidad(id: string, razon: string) {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const { data: current } = await supabase
    .from('oportunidades')
    .select('etapa, custom_data')
    .eq('id', id)
    .single()

  // ── Evaluar gates ANTES de persistir ──
  try {
    await checkTenantRules(
      workspaceId,
      'oportunidad',
      'status_change',
      {
        id,
        workspace_id: workspaceId,
        estado_nuevo: 'perdida',
        estado_anterior: current?.etapa ?? null,
        ...(current?.custom_data as Record<string, unknown> ?? {}),
        custom_data: current?.custom_data,
      },
    )
  } catch (e) {
    if (e instanceof BlockTransitionError) {
      return { success: false, error: e.message }
    }
  }

  const { error: dbError } = await supabase
    .from('oportunidades')
    .update({
      etapa: 'perdida',
      razon_perdida: razon,
      ultima_accion: 'Marcada como perdida',
      ultima_accion_fecha: new Date().toISOString(),
      etapa_changed_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  if (workspaceId) {
    await logSystemChange(workspaceId, 'oportunidad', id, 'etapa', current?.etapa ?? null, `perdida (${razon})`, staffId)
  }

  revalidatePath('/pipeline')
  revalidatePath(`/pipeline/${id}`)
  return { success: true }
}

/**
 * Hard gate: ganar oportunidad. Si la empresa no tiene perfil fiscal completo,
 * se puede pasar los datos fiscales faltantes y se hace UPDATE atomico.
 *
 * Para oportunidades VE (custom_data.linea_negocio === 've'):
 * - Se omite el gate fiscal (el RUT se carga durante la recolección de docs)
 * - El proyecto se crea con custom_data.estado_ve según vehiculo_en_upme
 * - Se auto-crea cotización flash si no existe ninguna
 */
export async function ganarOportunidad(id: string, fiscalData?: {
  empresa_id: string
  numero_documento?: string
  tipo_documento?: string
  tipo_persona?: string
  regimen_tributario?: string
  gran_contribuyente?: boolean
  agente_retenedor?: boolean
  autorretenedor?: boolean
}) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Get the oportunidad to find empresa_id
  const { data: opp } = await supabase
    .from('oportunidades')
    .select('empresa_id, descripcion, valor_estimado, contacto_id, responsable_id, custom_data')
    .eq('id', id)
    .single()

  if (!opp) return { success: false, error: 'Oportunidad no encontrada' }

  const empresaId = opp.empresa_id
  if (!empresaId) return { success: false, error: 'Sin empresa asociada' }

  const oppCustomData = (opp.custom_data as Record<string, unknown>) ?? {}
  const esVe = oppCustomData.linea_negocio === 've'

  if (!esVe) {
    // Flujo estándar: gate fiscal obligatorio
    // If fiscal data provided, update empresa first
    if (fiscalData) {
      const updates: Record<string, unknown> = {}
      if (fiscalData.numero_documento) updates.numero_documento = fiscalData.numero_documento
      if (fiscalData.tipo_documento) updates.tipo_documento = fiscalData.tipo_documento
      if (fiscalData.tipo_persona) updates.tipo_persona = fiscalData.tipo_persona
      if (fiscalData.regimen_tributario) updates.regimen_tributario = fiscalData.regimen_tributario
      if (fiscalData.gran_contribuyente !== undefined) updates.gran_contribuyente = fiscalData.gran_contribuyente
      if (fiscalData.agente_retenedor !== undefined) updates.agente_retenedor = fiscalData.agente_retenedor
      if (fiscalData.autorretenedor !== undefined) updates.autorretenedor = fiscalData.autorretenedor

      if (Object.keys(updates).length > 0) {
        const { data: currentEmpresa } = await supabase
          .from('empresas')
          .select('numero_documento, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor, autorretenedor')
          .eq('id', empresaId)
          .single()

        const merged = { ...currentEmpresa, ...updates }
        const fields = ['numero_documento', 'tipo_persona', 'regimen_tributario', 'gran_contribuyente', 'agente_retenedor', 'autorretenedor'] as const
        const filled = fields.filter(f => merged[f] != null).length
        updates.estado_fiscal = filled === 0 ? 'pendiente' : filled === 6 ? 'verificado' : 'parcial'

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
  }

  // Get the workspace ID (we already have supabase from above)
  const workspaceResult = await getWorkspace()
  const wsId = workspaceResult.workspaceId
  if (!wsId) return { success: false, error: 'Sin workspace' }

  // Find best cotización: prefer aceptada, fallback to any
  const { data: cotizacion } = await supabase
    .from('cotizaciones')
    .select('id, modo, valor_total, descuento_valor')
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
    // D131: Apply discount to get net budget
    const valorBruto = cotizacion.valor_total ?? presupuestoTotal
    const descuento = Number(cotizacion.descuento_valor ?? 0)
    presupuestoTotal = valorBruto - descuento

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
  const { data: currentOpp } = await supabase
    .from('oportunidades')
    .select('etapa')
    .eq('id', id)
    .single()

  const { error: moveError } = await supabase
    .from('oportunidades')
    .update({
      etapa: 'ganada',
      ultima_accion: 'Oportunidad ganada',
      ultima_accion_fecha: new Date().toISOString(),
      etapa_changed_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (moveError) return { success: false, error: moveError.message }

  if (wsId) {
    await logSystemChange(wsId, 'oportunidad', id, 'etapa', currentOpp?.etapa ?? null, 'ganada', null)
  }

  // ── Lógica VE: calcular estado_ve inicial y auto-crear cotización si falta ──
  let veCotizacionId: string | null = cotizacion?.id ?? null
  let veCustomData: Record<string, unknown> | null = null

  if (esVe) {
    // Estado inicial depende de vehiculo_en_upme
    const vehiculoEnUpme = oppCustomData.vehiculo_en_upme
    const estadoVeInicial = vehiculoEnUpme === false ? 'por_inclusion' : 'por_radicar'

    veCustomData = {
      linea_negocio: 've',
      estado_ve: estadoVeInicial,
    }

    // Auto-crear cotización flash si no existe ninguna
    if (!veCotizacionId) {
      // Obtener consecutivo via RPC
      const { data: consecutivoRaw } = await supabase.rpc('get_next_cotizacion_consecutivo', {
        p_workspace_id: wsId,
      })
      const consecutivo = (consecutivoRaw as string | null) ?? `COT-${new Date().getFullYear()}-0000`

      const { data: cotVe, error: cotVeErr } = await supabase
        .from('cotizaciones')
        .insert({
          workspace_id: wsId,
          oportunidad_id: id,
          consecutivo,
          codigo: '',
          modo: 'flash',
          descripcion: 'Gestión de trámite VE/HEV/PHEV',
          valor_total: opp.valor_estimado ?? 0,
          estado: 'aceptada',
        })
        .select('id')
        .single()

      if (!cotVeErr && cotVe) {
        veCotizacionId = cotVe.id
        presupuestoTotal = opp.valor_estimado ?? 0
      }
    }
  }

  // Create proyecto with full data
  const { data: proyecto, error: projError } = await supabase
    .from('proyectos')
    .insert({
      workspace_id: wsId,
      oportunidad_id: id,
      cotizacion_id: veCotizacionId,
      empresa_id: empresaId,
      contacto_id: opp.contacto_id,
      responsable_comercial_id: opp.responsable_id,
      responsable_id: null,
      nombre: opp.descripcion ?? 'Proyecto sin nombre',
      codigo: '',
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

  // Inherit custom_data via field mappings (oportunidad → proyecto)
  // Para VE, partir de veCustomData como base
  const baseCustomData = veCustomData ?? {}
  if (Object.keys(oppCustomData).length > 0) {
    const { data: mappings } = await supabase
      .from('custom_field_mappings')
      .select('origen_slug, destino_slug')
      .eq('workspace_id', wsId)
      .eq('origen_entidad', 'oportunidad')
      .eq('destino_entidad', 'proyecto')
      .eq('activo', true)

    const proyCustomData: Record<string, unknown> = { ...baseCustomData }
    if (mappings && mappings.length > 0) {
      for (const m of mappings) {
        const val = oppCustomData[m.origen_slug]
        if (val !== undefined && val !== null) {
          proyCustomData[m.destino_slug] = val
        }
      }
    }
    if (Object.keys(proyCustomData).length > 0) {
      await supabase
        .from('proyectos')
        .update({ custom_data: proyCustomData as unknown as Record<string, never> })
        .eq('id', proyecto.id)
    }
  } else if (Object.keys(baseCustomData).length > 0) {
    // VE sin mappings: igual guardar el estado_ve
    await supabase
      .from('proyectos')
      .update({ custom_data: baseCustomData as unknown as Record<string, never> })
      .eq('id', proyecto.id)
  }

  // Create proyecto_rubros from cotización items (with full detail inheritance)
  if (veCotizacionId) {
    await syncRubrosCotizacion(supabase, proyecto.id, veCotizacionId, esVe ? 'flash' : (cotizacion?.modo ?? null), presupuestoTotal)
  }

  revalidatePath('/pipeline')
  revalidatePath(`/pipeline/${id}`)
  revalidatePath('/proyectos')
  revalidatePath('/negocios')
  return { success: true, proyectoId: proyecto.id }
}

// Label lookup for rubro types
const TIPO_RUBRO_LABELS: Record<string, string> = {
  mo_propia: 'Mano de obra propia',
  mo_terceros: 'Mano de obra terceros',
  materiales: 'Materiales',
  viaticos: 'Viáticos',
  software: 'Software y tecnología',
  servicios_prof: 'Servicios profesionales',
}

// ── Sync rubros from cotización to proyecto ──────────────────
// Aggregates all rubros across all items by tipo, so e.g. "mo_propia"
// from 5 items gets totalized into one proyecto_rubros row.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function syncRubrosCotizacion(supabase: any, proyectoId: string, cotizacionId: string, modo: string | null, presupuestoTotal: number) {
  if (modo === 'detallada') {
    const { data: items } = await supabase
      .from('items')
      .select('nombre, subtotal, rubros(tipo, cantidad, unidad, valor_unitario, valor_total)')
      .eq('cotizacion_id', cotizacionId)

    if (items && items.length > 0) {
      // Aggregate rubros by tipo across all items
      const aggregated: Record<string, {
        tipo: string
        nombre: string
        presupuestado: number
        cantidad: number
        unidad: string | null
      }> = {}
      let itemsWithoutRubros = 0
      let itemsWithoutRubrosTotal = 0

      for (const item of items) {
        const rubrosList = Array.isArray(item.rubros) ? item.rubros : []
        if (rubrosList.length > 0) {
          for (const r of rubrosList) {
            const tipo = r.tipo ?? 'general'
            if (!aggregated[tipo]) {
              aggregated[tipo] = {
                tipo,
                nombre: TIPO_RUBRO_LABELS[tipo] ?? tipo,
                presupuestado: 0,
                cantidad: 0,
                unidad: r.unidad ?? null,
              }
            }
            aggregated[tipo].presupuestado += Number(r.valor_total ?? 0)
            aggregated[tipo].cantidad += Number(r.cantidad ?? 0)
          }
        } else {
          // Item without rubros — accumulate for a generic entry
          itemsWithoutRubros++
          itemsWithoutRubrosTotal += Number(item.subtotal ?? 0)
        }
      }

      // Add generic entry for items without rubros
      if (itemsWithoutRubros > 0) {
        if (!aggregated['general']) {
          aggregated['general'] = {
            tipo: 'general',
            nombre: 'General',
            presupuestado: 0,
            cantidad: 0,
            unidad: null,
          }
        }
        aggregated['general'].presupuestado += itemsWithoutRubrosTotal
      }

      const rubrosToInsert = Object.values(aggregated).map(a => ({
        proyecto_id: proyectoId,
        nombre: a.nombre,
        presupuestado: a.presupuestado,
        tipo: a.tipo,
        cantidad: a.cantidad > 0 ? a.cantidad : null,
        unidad: a.unidad,
      }))

      if (rubrosToInsert.length > 0) {
        await supabase.from('proyecto_rubros').insert(rubrosToInsert)
      }
    }
  } else {
    // Flash: single "general" rubro
    await supabase.from('proyecto_rubros').insert({
      proyecto_id: proyectoId,
      nombre: 'General',
      presupuestado: presupuestoTotal,
      tipo: 'general',
    })
  }
}

// ── Re-sync rubros for existing project ──────────────────────
export async function resyncRubrosProyecto(proyectoId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Get project's cotizacion
  const { data: proyecto } = await supabase
    .from('proyectos')
    .select('cotizacion_id, presupuesto_total')
    .eq('id', proyectoId)
    .single()

  if (!proyecto?.cotizacion_id) return { success: false, error: 'Sin cotización vinculada' }

  // Delete existing rubros (allow re-sync)
  await supabase
    .from('proyecto_rubros')
    .delete()
    .eq('proyecto_id', proyectoId)

  // Get cotización mode
  const { data: cotizacion } = await supabase
    .from('cotizaciones')
    .select('id, modo, valor_total')
    .eq('id', proyecto.cotizacion_id)
    .single()

  if (!cotizacion) return { success: false, error: 'Cotización no encontrada' }

  await syncRubrosCotizacion(supabase, proyectoId, cotizacion.id, cotizacion.modo, proyecto.presupuesto_total ?? 0)

  revalidatePath(`/proyectos/${proyectoId}`)
  return { success: true }
}

export async function updateOportunidad(id: string, updates: Record<string, unknown>) {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Get current values for fields being changed (for logging)
  const logFields = ['responsable_id'] as const
  const changedLogFields = logFields.filter(f => f in updates)
  let currentData: Record<string, unknown> | null = null
  if (changedLogFields.length > 0) {
    const { data } = await supabase
      .from('oportunidades')
      .select(changedLogFields.join(', '))
      .eq('id', id)
      .single()
    currentData = data as Record<string, unknown> | null
  }

  const { data: updated, error: dbError } = await supabase
    .from('oportunidades')
    .update(updates)
    .eq('id', id)
    .select('id')

  if (dbError) return { success: false, error: dbError.message }
  if (!updated || updated.length === 0) return { success: false, error: `0 filas actualizadas (id=${id})` }

  // Log changes
  if (workspaceId && currentData) {
    for (const field of changedLogFields) {
      const oldVal = currentData[field]
      const newVal = updates[field]
      if (oldVal !== newVal) {
        // For responsable_id, resolve staff names
        let oldLabel = String(oldVal ?? '')
        let newLabel = String(newVal ?? '')
        if (field === 'responsable_id') {
          if (oldVal) {
            const { data: s } = await supabase.from('staff').select('full_name').eq('id', String(oldVal)).single()
            oldLabel = s?.full_name ?? 'Sin asignar'
          } else { oldLabel = 'Sin asignar' }
          if (newVal) {
            const { data: s } = await supabase.from('staff').select('full_name').eq('id', String(newVal)).single()
            newLabel = s?.full_name ?? 'Sin asignar'
          } else { newLabel = 'Sin asignar' }
        }
        await logSystemChange(workspaceId, 'oportunidad', id, field, oldLabel, newLabel, staffId)
      }
    }
  }

  revalidatePath('/pipeline')
  revalidatePath(`/pipeline/${id}`)
  revalidatePath('/negocios')
  return { success: true }
}

// ── D171: Verificar cotización existente (semi-hard gate) ──

export async function checkCotizacionExiste(oportunidadId: string): Promise<{ tieneCotizacion: boolean }> {
  const { supabase, error } = await getWorkspace()
  if (error) return { tieneCotizacion: false }

  const { data } = await supabase
    .from('cotizaciones')
    .select('id')
    .eq('oportunidad_id', oportunidadId)
    .limit(1)
    .maybeSingle()

  return { tieneCotizacion: !!data }
}
