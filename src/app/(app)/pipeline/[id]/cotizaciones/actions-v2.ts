'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

export async function getCotizaciones(oportunidadId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  const { data } = await supabase
    .from('cotizaciones')
    .select('id, codigo, consecutivo, modo, estado, valor_total, descuento_porcentaje, descuento_valor, margen_porcentaje, costo_total, descripcion, created_at')
    .eq('oportunidad_id', oportunidadId)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function getCotizacion(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return null

  const { data } = await supabase
    .from('cotizaciones')
    .select('*, oportunidades(id, descripcion, empresa_id, empresas(id, nombre, numero_documento, tipo_documento, tipo_persona, regimen_tributario, gran_contribuyente, agente_retenedor, autorretenedor))')
    .eq('id', id)
    .single()

  return data
}

export async function getCotizacionItems(cotizacionId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('items')
    .select('*, rubros(*)')
    .eq('cotizacion_id', cotizacionId)
    .order('orden')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (data ?? []) as any[]
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
      codigo: '',
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
      codigo: '',
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

  // Revalidar path correcto según el origen de la cotización
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cot } = await (supabase as any)
    .from('cotizaciones')
    .select('oportunidad_id, negocio_id')
    .eq('id', id)
    .single()

  if (cot?.negocio_id) {
    revalidatePath(`/negocios/${cot.negocio_id}`)
  } else if (cot?.oportunidad_id) {
    revalidatePath(`/pipeline/${cot.oportunidad_id}`)
  } else {
    revalidatePath('/pipeline')
  }
  return { success: true }
}

// ── Items CRUD ────────────────────────────────

export async function addItem(cotizacionId: string, nombre: string, precioVenta?: number, descripcion?: string) {
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
      ...(precioVenta != null ? { precio_venta: precioVenta } : {}),
      ...(descripcion ? { descripcion: descripcion.trim() } : {}),
    } as never)
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  return { success: true, id: (data as { id: string }).id }
}

export async function updateItem(id: string, updates: { nombre?: string; precio_venta?: number; descuento_porcentaje?: number; descripcion?: string | null; cantidad?: number }) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const patch: Record<string, unknown> = {}
  if (updates.nombre !== undefined) patch.nombre = updates.nombre.trim()
  if (updates.precio_venta !== undefined) patch.precio_venta = updates.precio_venta
  if (updates.descuento_porcentaje !== undefined) patch.descuento_porcentaje = updates.descuento_porcentaje
  if (updates.descripcion !== undefined) patch.descripcion = updates.descripcion?.trim() || null
  if (updates.cantidad !== undefined) patch.cantidad = updates.cantidad

  const { error: dbError } = await supabase
    .from('items')
    .update(patch as never)
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }
  return { success: true }
}

export async function deleteItem(id: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Fetch item details before deleting
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: item } = await (supabase as any)
    .from('items')
    .select('cotizacion_id, servicio_origen_id, subtotal, es_ajuste')
    .eq('id', id)
    .single()

  if (!item) return { success: false, error: 'Item no encontrado' }

  // Never allow deleting the adjustment item directly
  if (item.es_ajuste) return { success: false, error: 'El item de ajuste se gestiona automáticamente' }

  // Check if there's an active adjustment item for this cotizacion
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ajusteItems } = await (supabase as any)
    .from('items')
    .select('id')
    .eq('cotizacion_id', item.cotizacion_id)
    .eq('es_ajuste', true)
    .limit(1)
  const hayAjuste = (ajusteItems ?? []).length > 0

  // Determine how much to subtract from valor_total:
  // 1. If item has servicio_origen_id → use that service's precio_estandar
  // 2. Fallback → use the item's subtotal (cost-based estimate)
  let precioRestar = 0
  if (!hayAjuste) {
    if (item.servicio_origen_id) {
      const { data: servicio } = await supabase
        .from('servicios')
        .select('precio_estandar')
        .eq('id', item.servicio_origen_id)
        .single()
      precioRestar = servicio?.precio_estandar ?? (item.subtotal ?? 0)
    } else {
      precioRestar = item.subtotal ?? 0
    }
  }

  const { error: dbError } = await supabase
    .from('items')
    .delete()
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  if (hayAjuste) {
    // Re-reconcile: recalcularTotales will update the adjustment item
    // (caller should call recalcularTotales after deleteItem)
  } else if (precioRestar > 0) {
    // No adjustment item: subtract from valor_total manually
    const { data: cot } = await supabase
      .from('cotizaciones')
      .select('valor_total')
      .eq('id', item.cotizacion_id)
      .single()

    const newValor = Math.max(0, (cot?.valor_total ?? 0) - precioRestar)
    await supabase
      .from('cotizaciones')
      .update({ valor_total: newValor })
      .eq('id', item.cotizacion_id)
  }

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

  const precioVenta = servicio.precio_estandar ?? subtotal

  // Create item (store servicio_origen_id so deleteItem can reverse the valor_total change)
  const { data: newItem, error: itemError } = await supabase
    .from('items')
    .insert({
      cotizacion_id: cotizacionId,
      nombre: servicio.nombre,
      subtotal,
      orden: nextOrden,
      servicio_origen_id: servicioId,
      precio_venta: precioVenta,
    } as never)
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

  // Check if there's an active adjustment item — if so, don't manually adjust valor_total
  // (recalcularTotales, called by the frontend after this, will re-reconcile)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ajusteItems } = await (supabase as any)
    .from('items')
    .select('id')
    .eq('cotizacion_id', cotizacionId)
    .eq('es_ajuste', true)
    .limit(1)
  const hayAjuste = (ajusteItems ?? []).length > 0

  if (!hayAjuste && precioVenta > 0) {
    const { data: cot } = await supabase
      .from('cotizaciones')
      .select('valor_total')
      .eq('id', cotizacionId)
      .single()

    await supabase
      .from('cotizaciones')
      .update({ valor_total: (cot?.valor_total ?? 0) + precioVenta })
      .eq('id', cotizacionId)
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

  // Get cotización to find oportunidad_id y negocio_id
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: cot } = await (supabase as any)
    .from('cotizaciones')
    .select('oportunidad_id, negocio_id, valor_total')
    .eq('id', id)
    .single()

  if (!cot) return { success: false, error: 'Cotización no encontrada' }

  // Check if there's already an "enviada" cotización for this negocio/oportunidad
  const parentField = cot.negocio_id ? 'negocio_id' : 'oportunidad_id'
  const parentId = cot.negocio_id ?? cot.oportunidad_id

  const { data: existente } = await supabase
    .from('cotizaciones')
    .select('consecutivo')
    .eq(parentField as never, parentId)
    .eq('estado', 'enviada')
    .maybeSingle()

  if (existente) {
    return {
      success: false,
      error: `Ya hay una cotización enviada. Apruébala o recházala antes de enviar otra.`,
    }
  }

  const { error: dbError } = await supabase
    .from('cotizaciones')
    .update({
      estado: 'enviada',
      fecha_envio: new Date().toISOString(),
      fecha_validez: new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0],
    } as never)
    .eq('id', id)
    .eq('estado', 'borrador')

  if (dbError) return { success: false, error: dbError.message }

  if (cot.negocio_id) {
    revalidatePath(`/negocios/${cot.negocio_id}`)
  } else {
    revalidatePath('/pipeline')
  }
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

  // Get oportunidad_id for chaining accept → win → project
  const { data: cot } = await supabase
    .from('cotizaciones')
    .select('oportunidad_id')
    .eq('id', id)
    .single()

  revalidatePath('/pipeline')
  return {
    success: true,
    shouldWin: true,
    oportunidadId: cot?.oportunidad_id ?? null,
  }
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

  // Get extra fields separately
  const { data: discountData } = await supabase
    .from('cotizaciones')
    .select('*')
    .eq('id', id)
    .single()
  const descPct = discountData?.descuento_porcentaje ?? 0
  const descVal = discountData?.descuento_valor ?? 0
  const negocioIdOrig = discountData?.negocio_id ?? null

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
      codigo: '',
      modo: original.modo,
      descripcion: original.descripcion,
      valor_total: original.valor_total,
      margen_porcentaje: original.margen_porcentaje,
      costo_total: original.costo_total,
      estado: 'borrador',
      duplicada_de: id,
      descuento_porcentaje: descPct,
      descuento_valor: descVal,
      negocio_id: negocioIdOrig,
      aiu_admin_pct: discountData?.aiu_admin_pct ?? null,
      aiu_imprevistos_pct: discountData?.aiu_imprevistos_pct ?? null,
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  // If detallada, duplicate items + rubros
  if (original.modo === 'detallada' && newCot) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: items } = await (supabase as any)
      .from('items')
      .select('nombre, descripcion, subtotal, orden, precio_venta, descuento_porcentaje, es_ajuste, cantidad, rubros(tipo, descripcion, cantidad, unidad, valor_unitario)')
      .eq('cotizacion_id', id)
      .order('orden')

    for (const item of items ?? []) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: newItem } = await (supabase as any)
        .from('items')
        .insert({
          cotizacion_id: newCot.id,
          nombre: item.nombre,
          descripcion: item.descripcion ?? null,
          subtotal: item.subtotal,
          orden: item.orden,
          precio_venta: item.precio_venta ?? 0,
          descuento_porcentaje: item.descuento_porcentaje ?? 0,
          es_ajuste: item.es_ajuste ?? false,
          cantidad: item.cantidad ?? 1,
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

  if (original.oportunidad_id) revalidatePath(`/pipeline/${original.oportunidad_id}`)
  if (negocioIdOrig) revalidatePath(`/negocios/${negocioIdOrig}`)
  return { success: true, id: newCot?.id }
}

// ── Reconciliación automática de ajuste ────────────────────────

export async function reconciliarAjuste(cotizacionId: string, valorTotalDeseado: number) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  if (valorTotalDeseado < 0) return { success: false, error: 'El valor total no puede ser negativo' }

  // 1. Get all items
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: items } = await (supabase as any)
    .from('items')
    .select('id, precio_venta, descuento_porcentaje, es_ajuste, orden, cantidad')
    .eq('cotizacion_id', cotizacionId)

  // 2. Sum net of regular items (es_ajuste = false)
  let sumaNetaRegulares = 0
  let ajusteExistenteId: string | null = null
  let maxOrden = 0
  for (const item of items ?? []) {
    if (item.es_ajuste) {
      ajusteExistenteId = item.id
    } else {
      const pv = Number(item.precio_venta) || 0
      const cant = Number(item.cantidad) || 1
      const dp = Math.min(100, Math.max(0, Number(item.descuento_porcentaje) || 0))
      sumaNetaRegulares += pv * cant * (1 - dp / 100)
    }
    if ((item.orden ?? 0) > maxOrden) maxOrden = item.orden ?? 0
  }

  // 3. Difference
  const diferencia = Math.round(valorTotalDeseado - sumaNetaRegulares)

  // 4-6. Handle adjustment item
  if (diferencia === 0) {
    // Remove adjustment if exists
    if (ajusteExistenteId) {
      await supabase.from('items').delete().eq('id', ajusteExistenteId)
    }
  } else {
    const nombre = diferencia > 0 ? 'Administración e imprevistos' : 'Descuento comercial'
    if (ajusteExistenteId) {
      // Update existing
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('items')
        .update({ precio_venta: diferencia, nombre } as never)
        .eq('id', ajusteExistenteId)
    } else {
      // Insert new
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('items')
        .insert({
          cotizacion_id: cotizacionId,
          nombre,
          subtotal: 0,
          orden: maxOrden + 1,
          precio_venta: diferencia,
          descuento_porcentaje: 0,
          es_ajuste: true,
        })
    }
  }

  // 7. Set valor_total to desired value
  await supabase
    .from('cotizaciones')
    .update({ valor_total: valorTotalDeseado } as never)
    .eq('id', cotizacionId)

  return { success: true }
}

// ── Recalcular totales ────────────────────────

export async function recalcularTotales(cotizacionId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Get all items with rubros
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: items } = await (supabase as any)
    .from('items')
    .select('id, precio_venta, descuento_porcentaje, es_ajuste, cantidad, rubros(valor_total)')
    .eq('cotizacion_id', cotizacionId)

  let totalCosto = 0
  let totalVenta = 0
  let hayAjuste = false
  let ajusteId: string | null = null

  for (const item of items ?? []) {
    // Update subtotal from rubros (skip for adjustment item — it has no rubros)
    if (!item.es_ajuste) {
      const subtotal = ((item.rubros as { valor_total: number }[]) ?? []).reduce((sum: number, r: { valor_total: number }) => sum + (r.valor_total ?? 0), 0)
      await supabase.from('items').update({ subtotal } as never).eq('id', item.id)
      const cant = Number(item.cantidad) || 1
      totalCosto += subtotal * cant
    }

    const pv = Number(item.precio_venta) || 0
    const cant = Number(item.cantidad) || 1
    const dp = Math.min(100, Math.max(0, Number(item.descuento_porcentaje) || 0))
    totalVenta += pv * cant * (1 - dp / 100)

    if (item.es_ajuste) {
      hayAjuste = true
      ajusteId = item.id
    }
  }

  const updates: Record<string, unknown> = { costo_total: totalCosto }

  if (hayAjuste) {
    // Read the user-fixed valor_total and re-reconcile the adjustment item
    const { data: cot } = await supabase
      .from('cotizaciones')
      .select('valor_total')
      .eq('id', cotizacionId)
      .single()

    const valorTotalFijado = cot?.valor_total ?? 0
    // Sum net of regular items only (excluding adjustment)
    let sumaNetaRegulares = 0
    for (const item of items ?? []) {
      if (!item.es_ajuste) {
        const pv = Number(item.precio_venta) || 0
        const cant = Number(item.cantidad) || 1
        const dp = Math.min(100, Math.max(0, Number(item.descuento_porcentaje) || 0))
        sumaNetaRegulares += pv * cant * (1 - dp / 100)
      }
    }
    const nuevaDiferencia = Math.round(valorTotalFijado - sumaNetaRegulares)

    if (nuevaDiferencia === 0 && ajusteId) {
      // No longer needed — remove
      await supabase.from('items').delete().eq('id', ajusteId)
    } else if (ajusteId) {
      const nombre = nuevaDiferencia > 0 ? 'Administración e imprevistos' : 'Descuento comercial'
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await (supabase as any)
        .from('items')
        .update({ precio_venta: nuevaDiferencia, nombre } as never)
        .eq('id', ajusteId)
    }
    // valor_total stays as the user set it — don't overwrite
  } else {
    // Normal behavior: valor_total = sum of items
    if (totalVenta > 0) updates.valor_total = Math.round(totalVenta)
  }

  await supabase
    .from('cotizaciones')
    .update(updates as never)
    .eq('id', cotizacionId)

  return { success: true, costoTotal: totalCosto, valorVenta: Math.round(totalVenta) }
}

// ── AIU (Admin + Imprevistos sobre costos) ────────────────────

export async function aplicarAIU(cotizacionId: string, adminPct: number | null, imprevPct: number | null) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Guardar porcentajes en cotizacion
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('cotizaciones')
    .update({ aiu_admin_pct: adminPct, aiu_imprevistos_pct: imprevPct } as never)
    .eq('id', cotizacionId)

  // Si ambos son null o 0, quitar ajuste AIU y dejar flujo normal
  const adminVal = adminPct ?? 0
  const imprevVal = imprevPct ?? 0
  if (adminVal === 0 && imprevVal === 0) {
    // Eliminar item de ajuste si existe
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: ajuste } = await (supabase as any)
      .from('items')
      .select('id')
      .eq('cotizacion_id', cotizacionId)
      .eq('es_ajuste', true)
      .maybeSingle()
    if (ajuste) {
      await supabase.from('items').delete().eq('id', ajuste.id)
    }
    // Recalcular totales normal
    await recalcularTotales(cotizacionId)
    return { success: true }
  }

  // Calcular costoTotal (sum de rubros de items regulares)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: items } = await (supabase as any)
    .from('items')
    .select('id, precio_venta, descuento_porcentaje, es_ajuste, orden, cantidad, rubros(valor_total)')
    .eq('cotizacion_id', cotizacionId)

  let costoTotal = 0
  let sumaNetaRegulares = 0
  let ajusteId: string | null = null
  let maxOrden = 0

  for (const item of items ?? []) {
    if (item.es_ajuste) {
      ajusteId = item.id
    } else {
      const rubrosSum = ((item.rubros as { valor_total: number }[]) ?? []).reduce((s: number, r: { valor_total: number }) => s + (r.valor_total ?? 0), 0)
      const cant = Number(item.cantidad) || 1
      costoTotal += rubrosSum * cant
      const pv = Number(item.precio_venta) || 0
      const dp = Math.min(100, Math.max(0, Number(item.descuento_porcentaje) || 0))
      sumaNetaRegulares += pv * cant * (1 - dp / 100)
    }
    if ((item.orden ?? 0) > maxOrden) maxOrden = item.orden ?? 0
  }

  // Calcular AIU sobre costos
  const aiuAmount = Math.round(costoTotal * (adminVal + imprevVal) / 100)
  const nombre = `Administración (${adminVal}%) e imprevistos (${imprevVal}%)`

  if (ajusteId) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('items')
      .update({ precio_venta: aiuAmount, nombre } as never)
      .eq('id', ajusteId)
  } else {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('items')
      .insert({
        cotizacion_id: cotizacionId,
        nombre,
        subtotal: 0,
        orden: maxOrden + 1,
        precio_venta: aiuAmount,
        descuento_porcentaje: 0,
        es_ajuste: true,
      })
  }

  // Actualizar valor_total = sumaNetaRegulares + aiuAmount
  const valorTotal = Math.round(sumaNetaRegulares + aiuAmount)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('cotizaciones')
    .update({ valor_total: valorTotal, costo_total: costoTotal } as never)
    .eq('id', cotizacionId)

  return { success: true }
}
