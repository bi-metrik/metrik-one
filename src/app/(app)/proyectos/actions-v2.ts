'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

// ── Types ───────────────────────────────────────────────

type ActionResult = { success: true } | { success: false; error: string }

export type EstadoProyectoV2 = 'en_ejecucion' | 'pausado' | 'cerrado'

// State machine: from → allowed targets
const TRANSICIONES: Record<EstadoProyectoV2, EstadoProyectoV2[]> = {
  en_ejecucion: ['pausado', 'cerrado'],
  pausado: ['en_ejecucion', 'cerrado'],
  cerrado: [], // terminal
}

// ── Get projects list (from financial view) ─────────────

export async function getProyectos() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await supabase
    .from('v_proyecto_financiero')
    .select('*')
    .eq('workspace_id', workspaceId)
    .order('created_at', { ascending: false })

  return data ?? []
}

// ── Get single project detail ───────────────────────────

export async function getProyectoDetalle(id: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  // Parallel fetches
  const [financieroRes, rubrosRes, facturasRes, ultimosRes] = await Promise.all([
    // Financial summary from view
    supabase
      .from('v_proyecto_financiero')
      .select('*')
      .eq('proyecto_id', id)
      .eq('workspace_id', workspaceId)
      .single(),

    // Budget vs real per rubro
    supabase
      .from('v_proyecto_rubros_comparativo')
      .select('*')
      .eq('proyecto_id', id),

    // Invoices with payment status
    supabase
      .from('v_facturas_estado')
      .select('*')
      .eq('proyecto_id', id)
      .eq('workspace_id', workspaceId)
      .order('fecha_emision', { ascending: false }),

    // Last 10 activity entries (horas + gastos + cobros combined via UNION-like query)
    // We fetch each separately and merge client-side for simplicity
    Promise.all([
      supabase
        .from('horas')
        .select('id, fecha, horas, descripcion, created_at')
        .eq('proyecto_id', id)
        .order('fecha', { ascending: false })
        .limit(10),
      supabase
        .from('gastos')
        .select('id, fecha, monto, descripcion, categoria, created_at')
        .eq('proyecto_id', id)
        .order('fecha', { ascending: false })
        .limit(10),
      supabase
        .from('cobros')
        .select('id, fecha, monto, notas, created_at')
        .eq('proyecto_id', id)
        .order('fecha', { ascending: false })
        .limit(10),
    ]),
  ])

  if (financieroRes.error || !financieroRes.data) return null

  // Merge and sort last 10 entries by date
  const [horasRes, gastosRes, cobrosRes] = ultimosRes
  type TimelineEntry = {
    id: string
    tipo: 'horas' | 'gasto' | 'cobro'
    fecha: string
    descripcion: string
    valor: number
    created_at: string
  }

  const timeline: TimelineEntry[] = [
    ...(horasRes.data ?? []).map(h => ({
      id: h.id,
      tipo: 'horas' as const,
      fecha: h.fecha ?? '',
      descripcion: h.descripcion ?? 'Horas registradas',
      valor: h.horas ?? 0,
      created_at: h.created_at ?? '',
    })),
    ...(gastosRes.data ?? []).map(g => ({
      id: g.id,
      tipo: 'gasto' as const,
      fecha: g.fecha ?? '',
      descripcion: g.descripcion ?? g.categoria ?? 'Gasto',
      valor: g.monto ?? 0,
      created_at: g.created_at ?? '',
    })),
    ...(cobrosRes.data ?? []).map(c => ({
      id: c.id,
      tipo: 'cobro' as const,
      fecha: c.fecha ?? '',
      descripcion: c.notas ?? 'Cobro recibido',
      valor: c.monto ?? 0,
      created_at: c.created_at ?? '',
    })),
  ]
    .sort((a, b) => b.fecha.localeCompare(a.fecha))
    .slice(0, 10)

  // Fetch proyecto_rubros list for gasto dialog select
  const { data: rubrosLista } = await supabase
    .from('proyecto_rubros')
    .select('id, nombre, tipo, presupuestado')
    .eq('proyecto_id', id)
    .order('nombre')

  return {
    financiero: financieroRes.data,
    rubros: rubrosRes.data ?? [],
    facturas: facturasRes.data ?? [],
    timeline,
    rubrosLista: rubrosLista ?? [],
  }
}

// ── Update avance (slider 0-100) ────────────────────────

export async function updateAvance(id: string, porcentaje: number): Promise<ActionResult> {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  if (porcentaje < 0 || porcentaje > 100) {
    return { success: false, error: 'Porcentaje debe estar entre 0 y 100' }
  }

  const { error: dbError } = await supabase
    .from('proyectos')
    .update({ avance_porcentaje: porcentaje })
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/proyectos')
  revalidatePath(`/proyectos/${id}`)
  return { success: true }
}

// ── Cambiar estado proyecto (state machine §6.3) ────────

export async function cambiarEstadoProyecto(
  id: string,
  nuevoEstado: EstadoProyectoV2,
  leccionesAprendidas?: string
): Promise<ActionResult & { proyectoId?: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Get current state
  const { data: proyecto } = await supabase
    .from('proyectos')
    .select('estado')
    .eq('id', id)
    .single()

  if (!proyecto) return { success: false, error: 'Proyecto no encontrado' }

  const estadoActual = proyecto.estado as EstadoProyectoV2
  const permitidos = TRANSICIONES[estadoActual] ?? []

  if (!permitidos.includes(nuevoEstado)) {
    return { success: false, error: `No se puede cambiar de "${estadoActual}" a "${nuevoEstado}"` }
  }

  // If closing, do the full closure flow
  if (nuevoEstado === 'cerrado') {
    return cerrarProyecto(id, leccionesAprendidas)
  }

  const updates: Record<string, unknown> = {
    estado: nuevoEstado,
    updated_at: new Date().toISOString(),
  }

  const { error: dbError } = await supabase
    .from('proyectos')
    .update(updates)
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/proyectos')
  revalidatePath(`/proyectos/${id}`)
  return { success: true, proyectoId: id }
}

// ── Cerrar proyecto (snapshot §5.5) ─────────────────────

async function cerrarProyecto(id: string, leccionesAprendidas?: string): Promise<ActionResult & { proyectoId?: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Get financial data for snapshot
  const { data: fin } = await supabase
    .from('v_proyecto_financiero')
    .select('*')
    .eq('proyecto_id', id)
    .eq('workspace_id', workspaceId)
    .single()

  if (!fin) return { success: false, error: 'No se encontraron datos financieros' }

  // Build snapshot
  const snapshot = {
    fecha_cierre: new Date().toISOString(),
    presupuesto_total: fin.presupuesto_total,
    costo_acumulado: fin.costo_acumulado,
    horas_estimadas: fin.horas_estimadas,
    horas_reales: fin.horas_reales,
    gastos_directos: fin.gastos_directos,
    costo_horas: fin.costo_horas,
    facturado: fin.facturado,
    cobrado: fin.cobrado,
    cartera: fin.cartera,
    ganancia_estimada: fin.ganancia_estimada,
    ganancia_real: fin.ganancia_real,
    avance_porcentaje: fin.avance_porcentaje,
    presupuesto_consumido_pct: fin.presupuesto_consumido_pct,
  }

  const { error: dbError } = await supabase
    .from('proyectos')
    .update({
      estado: 'cerrado',
      fecha_cierre: new Date().toISOString().split('T')[0],
      cierre_snapshot: snapshot,
      lecciones_aprendidas: leccionesAprendidas?.trim() || null,
      avance_porcentaje: 100,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  // Update costos_referencia (feedback loop §5.6)
  // Get oportunidad → service type from cotizacion
  const { data: proyecto } = await supabase
    .from('proyectos')
    .select('oportunidad_id')
    .eq('id', id)
    .single()

  if (proyecto?.oportunidad_id) {
    const { data: opp } = await supabase
      .from('oportunidades')
      .select('descripcion')
      .eq('id', proyecto.oportunidad_id)
      .single()

    const tipoServicio = opp?.descripcion ?? 'general'

    // Upsert cost reference
    const { data: existing } = await supabase
      .from('costos_referencia')
      .select('*')
      .eq('workspace_id', workspaceId)
      .eq('tipo_servicio', tipoServicio)
      .single()

    const horasReal = fin.horas_reales ?? 0
    const costoReal = fin.costo_acumulado ?? 0
    const presupuesto = fin.presupuesto_total ?? 0
    const margenReal = presupuesto > 0 ? ((presupuesto - costoReal) / presupuesto) * 100 : 0

    if (existing) {
      const n = (existing.proyectos_base ?? 0) + 1
      await supabase
        .from('costos_referencia')
        .update({
          horas_promedio: ((existing.horas_promedio ?? 0) * (n - 1) + horasReal) / n,
          costo_promedio: ((existing.costo_promedio ?? 0) * (n - 1) + costoReal) / n,
          margen_promedio: ((existing.margen_promedio ?? 0) * (n - 1) + margenReal) / n,
          proyectos_base: n,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existing.id)
    } else {
      await supabase
        .from('costos_referencia')
        .insert({
          workspace_id: workspaceId,
          tipo_servicio: tipoServicio,
          horas_promedio: horasReal,
          costo_promedio: costoReal,
          margen_promedio: margenReal,
          proyectos_base: 1,
        })
    }
  }

  revalidatePath('/proyectos')
  revalidatePath(`/proyectos/${id}`)
  return { success: true, proyectoId: id }
}

// ── Add horas ───────────────────────────────────────────

export async function addHoras(proyectoId: string, input: {
  fecha: string
  horas: number
  descripcion?: string
}): Promise<ActionResult> {
  const { supabase, workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Validate estado
  const { data: proyecto } = await supabase
    .from('proyectos')
    .select('estado')
    .eq('id', proyectoId)
    .single()

  if (!proyecto) return { success: false, error: 'Proyecto no encontrado' }
  if (proyecto.estado !== 'en_ejecucion') {
    return { success: false, error: 'Solo se pueden registrar horas en proyectos en ejecución' }
  }

  const { error: dbError } = await supabase
    .from('horas')
    .insert({
      workspace_id: workspaceId,
      proyecto_id: proyectoId,
      user_id: userId,
      fecha: input.fecha,
      horas: input.horas,
      descripcion: input.descripcion?.trim() || null,
    })

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath(`/proyectos/${proyectoId}`)
  revalidatePath('/proyectos')
  return { success: true }
}

// ── Add gasto directo ───────────────────────────────────

export async function addGastoDirecto(proyectoId: string, input: {
  monto: number
  rubro_id?: string
  descripcion?: string
  categoria?: string
  fecha?: string
}): Promise<ActionResult> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Validate estado
  const { data: proyecto } = await supabase
    .from('proyectos')
    .select('estado')
    .eq('id', proyectoId)
    .single()

  if (!proyecto) return { success: false, error: 'Proyecto no encontrado' }
  if (proyecto.estado !== 'en_ejecucion') {
    return { success: false, error: 'Solo se pueden registrar gastos en proyectos en ejecución' }
  }

  const { error: dbError } = await supabase
    .from('gastos')
    .insert({
      workspace_id: workspaceId,
      proyecto_id: proyectoId,
      monto: input.monto,
      rubro_id: input.rubro_id || null,
      descripcion: input.descripcion?.trim() || null,
      categoria: input.categoria || 'otros',
      fecha: input.fecha || new Date().toISOString().split('T')[0],
    })

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath(`/proyectos/${proyectoId}`)
  revalidatePath('/proyectos')
  return { success: true }
}

// ── Add factura ─────────────────────────────────────────

export async function addFactura(proyectoId: string, input: {
  monto: number
  fecha_emision?: string
  numero_factura?: string
  notas?: string
}): Promise<ActionResult> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Validate estado — factura NOT allowed on cerrado
  const { data: proyecto } = await supabase
    .from('proyectos')
    .select('estado')
    .eq('id', proyectoId)
    .single()

  if (!proyecto) return { success: false, error: 'Proyecto no encontrado' }
  if (proyecto.estado === 'cerrado') {
    return { success: false, error: 'No se pueden crear facturas en proyectos cerrados' }
  }

  const { error: dbError } = await supabase
    .from('facturas')
    .insert({
      workspace_id: workspaceId,
      proyecto_id: proyectoId,
      monto: input.monto,
      fecha_emision: input.fecha_emision || new Date().toISOString().split('T')[0],
      numero_factura: input.numero_factura?.trim() || null,
      notas: input.notas?.trim() || null,
    })

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath(`/proyectos/${proyectoId}`)
  revalidatePath('/proyectos')
  return { success: true }
}

// ── Add cobro (§6.3: allowed even on closed projects) ───

export async function addCobro(facturaId: string, input: {
  monto: number
  fecha?: string
  notas?: string
}): Promise<ActionResult> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Get factura to find proyecto_id (no state restriction for cobros)
  const { data: factura } = await supabase
    .from('facturas')
    .select('id, proyecto_id, monto')
    .eq('id', facturaId)
    .single()

  if (!factura) return { success: false, error: 'Factura no encontrada' }

  // Check saldo pendiente via view
  const { data: estadoFactura } = await supabase
    .from('v_facturas_estado')
    .select('saldo_pendiente')
    .eq('factura_id', facturaId)
    .single()

  const saldo = estadoFactura?.saldo_pendiente ?? factura.monto
  if (input.monto > Number(saldo) + 0.01) {
    return { success: false, error: `El cobro ($${input.monto}) supera el saldo pendiente ($${saldo})` }
  }

  const { error: dbError } = await supabase
    .from('cobros')
    .insert({
      workspace_id: workspaceId,
      factura_id: facturaId,
      proyecto_id: factura.proyecto_id,
      monto: input.monto,
      fecha: input.fecha || new Date().toISOString().split('T')[0],
      notas: input.notas?.trim() || null,
    })

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath(`/proyectos/${factura.proyecto_id}`)
  revalidatePath('/proyectos')
  return { success: true }
}
