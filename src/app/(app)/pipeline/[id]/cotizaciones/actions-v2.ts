'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

export async function getCotizaciones(oportunidadId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  const { data } = await supabase
    .from('cotizaciones')
    .select('id, consecutivo, modo, estado, valor_total, margen_porcentaje, costo_total, descripcion, created_at')
    .eq('oportunidad_id', oportunidadId)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function getCotizacion(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return null

  const { data } = await supabase
    .from('cotizaciones')
    .select('*, oportunidades(id, descripcion, empresa_id, empresas(id, nombre, nit, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor))')
    .eq('id', id)
    .single()

  return data
}

export async function getCotizacionItems(cotizacionId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  const { data } = await supabase
    .from('items')
    .select('*, rubros(*)')
    .eq('cotizacion_id', cotizacionId)
    .order('orden')

  return data ?? []
}

export async function createCotizacionFlash(oportunidadId: string, descripcion: string, valorTotal: number) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Get consecutivo
  const { data: consecutivoRaw } = await supabase.rpc('get_next_cotizacion_consecutivo', {
    p_workspace_id: workspaceId,
  })
  const consecutivo = consecutivoRaw ?? `COT-${new Date().getFullYear()}-0000`

  const { data, error: dbError } = await supabase
    .from('cotizaciones')
    .insert({
      workspace_id: workspaceId,
      oportunidad_id: oportunidadId,
      consecutivo,
      modo: 'flash',
      descripcion: descripcion.trim(),
      valor_total: valorTotal,
      estado: 'borrador',
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath(`/pipeline/${oportunidadId}`)
  return { success: true, id: data.id }
}

export async function createCotizacionDetallada(oportunidadId: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const { data: consecutivoRaw } = await supabase.rpc('get_next_cotizacion_consecutivo', {
    p_workspace_id: workspaceId,
  })
  const consecutivo = consecutivoRaw ?? `COT-${new Date().getFullYear()}-0000`

  const { data, error: dbError } = await supabase
    .from('cotizaciones')
    .insert({
      workspace_id: workspaceId,
      oportunidad_id: oportunidadId,
      consecutivo,
      modo: 'detallada',
      valor_total: 0,
      estado: 'borrador',
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath(`/pipeline/${oportunidadId}`)
  return { success: true, id: data.id }
}

export async function updateCotizacion(id: string, updates: Record<string, unknown>) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('cotizaciones')
    .update(updates)
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/pipeline')
  return { success: true }
}

// ── Items CRUD ────────────────────────────────

export async function addItem(cotizacionId: string, nombre: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Get max order
  const { data: existing } = await supabase
    .from('items')
    .select('orden')
    .eq('cotizacion_id', cotizacionId)
    .order('orden', { ascending: false })
    .limit(1)

  const nextOrden = (existing?.[0]?.orden ?? 0) + 1

  const { data, error: dbError } = await supabase
    .from('items')
    .insert({
      cotizacion_id: cotizacionId,
      nombre: nombre.trim(),
      subtotal: 0,
      orden: nextOrden,
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  return { success: true, id: data.id }
}

export async function updateItem(id: string, nombre: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('items')
    .update({ nombre: nombre.trim() })
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }
  return { success: true }
}

export async function deleteItem(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('items')
    .delete()
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }
  return { success: true }
}

// ── Add from servicio catalog (deep copy) ─────────

export async function addItemFromServicio(cotizacionId: string, servicioId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Get the servicio template
  const { data: servicio } = await supabase
    .from('servicios')
    .select('nombre, precio_estandar, rubros_template')
    .eq('id', servicioId)
    .single()

  if (!servicio) return { success: false, error: 'Servicio no encontrado' }

  // Get max order
  const { data: existing } = await supabase
    .from('items')
    .select('orden')
    .eq('cotizacion_id', cotizacionId)
    .order('orden', { ascending: false })
    .limit(1)

  const nextOrden = (existing?.[0]?.orden ?? 0) + 1

  const rubrosTemplate = servicio.rubros_template as {
    tipo: string; descripcion?: string; cantidad: number; unidad: string; valor_unitario: number
  }[] | null

  // Calculate subtotal from rubros or use precio_estandar
  const subtotal = rubrosTemplate && rubrosTemplate.length > 0
    ? rubrosTemplate.reduce((sum, r) => sum + (r.cantidad * r.valor_unitario), 0)
    : (servicio.precio_estandar ?? 0)

  // Create item
  const { data: newItem, error: itemError } = await supabase
    .from('items')
    .insert({
      cotizacion_id: cotizacionId,
      nombre: servicio.nombre,
      subtotal,
      orden: nextOrden,
    })
    .select('id')
    .single()

  if (itemError) return { success: false, error: itemError.message }

  // Deep copy rubros from template
  if (rubrosTemplate && rubrosTemplate.length > 0 && newItem) {
    const rubrosToInsert = rubrosTemplate.map(r => ({
      item_id: newItem.id,
      tipo: r.tipo,
      descripcion: r.descripcion || null,
      cantidad: r.cantidad,
      unidad: r.unidad,
      valor_unitario: r.valor_unitario,
    }))
    await supabase.from('rubros').insert(rubrosToInsert)
  }

  return { success: true, id: newItem?.id }
}

// ── Rubros CRUD ────────────────────────────────

export async function addRubro(itemId: string, rubro: {
  tipo: string
  descripcion?: string
  cantidad: number
  unidad: string
  valor_unitario: number
}) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { data, error: dbError } = await supabase
    .from('rubros')
    .insert({
      item_id: itemId,
      tipo: rubro.tipo,
      descripcion: rubro.descripcion?.trim() || null,
      cantidad: rubro.cantidad,
      unidad: rubro.unidad,
      valor_unitario: rubro.valor_unitario,
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }
  return { success: true, id: data.id }
}

export async function updateRubro(id: string, updates: Record<string, unknown>) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('rubros')
    .update(updates)
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }
  return { success: true }
}

export async function deleteRubro(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('rubros')
    .delete()
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }
  return { success: true }
}

// ── State transitions ────────────────────────────

export async function enviarCotizacion(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Get cotización to find oportunidad_id
  const { data: cot } = await supabase
    .from('cotizaciones')
    .select('oportunidad_id')
    .eq('id', id)
    .single()

  if (!cot) return { success: false, error: 'Cotización no encontrada' }

  // Check if there's already an "enviada" cotización for this oportunidad
  const { data: existente } = await supabase
    .from('cotizaciones')
    .select('consecutivo')
    .eq('oportunidad_id', cot.oportunidad_id)
    .eq('estado', 'enviada')
    .maybeSingle()

  if (existente) {
    return {
      success: false,
      error: `Ya existe una cotización enviada (${existente.consecutivo ?? 'sin consecutivo'}). Primero acepta o rechaza esa cotización antes de enviar otra.`,
    }
  }

  const { error: dbError } = await supabase
    .from('cotizaciones')
    .update({
      estado: 'enviada',
      fecha_envio: new Date().toISOString(),
      fecha_validez: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    })
    .eq('id', id)
    .eq('estado', 'borrador')

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/pipeline')
  return { success: true }
}

export async function aceptarCotizacion(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('cotizaciones')
    .update({ estado: 'aceptada' })
    .eq('id', id)
    .eq('estado', 'enviada')

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/pipeline')
  return { success: true }
}

export async function rechazarCotizacion(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('cotizaciones')
    .update({ estado: 'rechazada' })
    .eq('id', id)
    .eq('estado', 'enviada')

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/pipeline')
  return { success: true }
}

export async function duplicarCotizacion(id: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Get original
  const { data: original } = await supabase
    .from('cotizaciones')
    .select('oportunidad_id, modo, descripcion, valor_total, margen_porcentaje, costo_total')
    .eq('id', id)
    .single()

  if (!original) return { success: false, error: 'Cotizacion no encontrada' }

  // Get new consecutivo
  const { data: dupConsRaw } = await supabase.rpc('get_next_cotizacion_consecutivo', {
    p_workspace_id: workspaceId,
  })
  const dupCons = dupConsRaw ?? `COT-${new Date().getFullYear()}-0000`

  const { data: newCot, error: dbError } = await supabase
    .from('cotizaciones')
    .insert({
      workspace_id: workspaceId,
      oportunidad_id: original.oportunidad_id,
      consecutivo: dupCons,
      modo: original.modo,
      descripcion: original.descripcion,
      valor_total: original.valor_total,
      margen_porcentaje: original.margen_porcentaje,
      costo_total: original.costo_total,
      estado: 'borrador',
      duplicada_de: id,
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  // If detallada, duplicate items + rubros
  if (original.modo === 'detallada' && newCot) {
    const { data: items } = await supabase
      .from('items')
      .select('nombre, subtotal, orden, rubros(tipo, descripcion, cantidad, unidad, valor_unitario)')
      .eq('cotizacion_id', id)
      .order('orden')

    for (const item of items ?? []) {
      const { data: newItem } = await supabase
        .from('items')
        .insert({
          cotizacion_id: newCot.id,
          nombre: item.nombre,
          subtotal: item.subtotal,
          orden: item.orden,
        })
        .select('id')
        .single()

      if (newItem && item.rubros) {
        const rubrosToInsert = (item.rubros as { tipo: string; descripcion: string | null; cantidad: number; unidad: string; valor_unitario: number }[]).map(r => ({
          item_id: newItem.id,
          tipo: r.tipo,
          descripcion: r.descripcion,
          cantidad: r.cantidad,
          unidad: r.unidad,
          valor_unitario: r.valor_unitario,
        }))
        if (rubrosToInsert.length > 0) {
          await supabase.from('rubros').insert(rubrosToInsert)
        }
      }
    }
  }

  revalidatePath(`/pipeline/${original.oportunidad_id}`)
  return { success: true, id: newCot?.id }
}

// ── Recalcular totales ────────────────────────

export async function recalcularTotales(cotizacionId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Get all items with rubros
  const { data: items } = await supabase
    .from('items')
    .select('id, rubros(valor_total)')
    .eq('cotizacion_id', cotizacionId)

  let totalCosto = 0
  for (const item of items ?? []) {
    const subtotal = ((item.rubros as { valor_total: number }[]) ?? []).reduce((sum: number, r: { valor_total: number }) => sum + (r.valor_total ?? 0), 0)
    await supabase.from('items').update({ subtotal }).eq('id', item.id)
    totalCosto += subtotal
  }

  // Update cotizacion costo_total
  await supabase
    .from('cotizaciones')
    .update({ costo_total: totalCosto })
    .eq('id', cotizacionId)

  return { success: true, costoTotal: totalCosto }
}
