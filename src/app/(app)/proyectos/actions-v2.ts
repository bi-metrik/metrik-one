'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { revalidatePath } from 'next/cache'
import { logSystemChange } from '@/app/(app)/activity-actions'

// ── Types ───────────────────────────────────────────────

type ActionResult = { success: true } | { success: false; error: string }

export type EstadoProyectoV2 = 'en_ejecucion' | 'pausado' | 'cerrado' | 'entregado'

// D176: State machine: from → allowed targets
const TRANSICIONES: Record<EstadoProyectoV2, EstadoProyectoV2[]> = {
  en_ejecucion: ['pausado', 'entregado', 'cerrado'],
  pausado: ['en_ejecucion', 'cerrado'],
  entregado: ['cerrado'], // auto-cierre via trigger cuando cartera == 0
  cerrado: [], // terminal
}

// ── Crear proyecto interno (§7.9.1) ─────────────────────

export async function crearProyectoInterno(input: {
  nombre: string
  fecha_inicio?: string
  fecha_fin_estimada?: string
  carpeta_url?: string
  responsable_id?: string
  rubros?: { nombre: string; tipo: string; cantidad: number; unidad: string; valor_unitario: number; presupuestado: number }[]
}): Promise<ActionResult & { proyectoId?: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  if (!input.nombre.trim()) {
    return { success: false, error: 'El nombre es obligatorio' }
  }

  // Calculate presupuesto_total from rubros sum
  const presupuestoTotal = (input.rubros ?? []).reduce((sum, r) => sum + r.presupuestado, 0) || null

  const { data, error: dbError } = await supabase
    .from('proyectos')
    .insert({
      workspace_id: workspaceId,
      nombre: input.nombre.trim(),
      codigo: '',
      tipo: 'interno',
      estado: 'en_ejecucion',
      presupuesto_total: presupuestoTotal,
      fecha_inicio: input.fecha_inicio || new Date().toISOString().split('T')[0],
      fecha_fin_estimada: input.fecha_fin_estimada || null,
      carpeta_url: input.carpeta_url?.trim() || null,
      responsable_id: input.responsable_id || null,
      canal_creacion: 'app',
    })
    .select('id')
    .single()

  if (dbError) return { success: false, error: dbError.message }

  // Insert rubros if any
  if (input.rubros && input.rubros.length > 0) {
    const rubrosToInsert = input.rubros.map(r => ({
      proyecto_id: data.id,
      nombre: r.nombre,
      tipo: r.tipo,
      cantidad: r.cantidad,
      unidad: r.unidad,
      valor_unitario: r.valor_unitario,
      presupuestado: r.presupuestado,
    }))
    await supabase.from('proyecto_rubros').insert(rubrosToInsert)
  }

  revalidatePath('/proyectos')
  return { success: true, proyectoId: data.id }
}

// ── Get projects list (from financial view) ─────────────

export async function getProyectos() {
  const { supabase, workspaceId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const perms = getRolePermissions(role || '')

  // Operator: filter to only assigned projects
  if (!perms.canViewAllProjects && staffId) {
    // Get allowed project IDs from proyectos table
    const { data: allowed } = await supabase
      .from('proyectos')
      .select('id')
      .eq('workspace_id', workspaceId)
      .or(`responsable_id.eq.${staffId},colaboradores.cs.{${staffId}}`)

    const ids = (allowed ?? []).map(p => p.id)
    if (ids.length === 0) return []

    const [finRes, respRes] = await Promise.all([
      supabase
        .from('v_proyecto_financiero')
        .select('*')
        .in('proyecto_id', ids)
        .order('created_at', { ascending: false }),
      supabase
        .from('proyectos')
        .select('id, responsable_id, staff:responsable_id(full_name)')
        .in('id', ids),
    ])

    return mergeResponsable(finRes.data ?? [], respRes.data ?? [])
  }

  const [finRes, respRes] = await Promise.all([
    supabase
      .from('v_proyecto_financiero')
      .select('*')
      .eq('workspace_id', workspaceId)
      .order('created_at', { ascending: false }),
    supabase
      .from('proyectos')
      .select('id, responsable_id, staff:responsable_id(full_name)')
      .eq('workspace_id', workspaceId),
  ])

  return mergeResponsable(finRes.data ?? [], respRes.data ?? [])
}

// Merge responsable info from proyectos table into v_proyecto_financiero results
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mergeResponsable(financieros: any[], responsables: any[]) {
  const map = new Map<string, { responsable_id: string | null; responsable_nombre: string | null }>()
  for (const r of responsables) {
    const staff = r.staff as { full_name: string } | null
    map.set(r.id, {
      responsable_id: r.responsable_id,
      responsable_nombre: staff?.full_name ?? null,
    })
  }
  return financieros.map(f => ({
    ...f,
    responsable_id: map.get(f.proyecto_id)?.responsable_id ?? null,
    responsable_nombre: map.get(f.proyecto_id)?.responsable_nombre ?? null,
  }))
}

// ── Get single project detail ───────────────────────────

export async function getProyectoDetalle(id: string) {
  const { supabase, workspaceId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  const perms = getRolePermissions(role || '')

  // Operator guard: if not allowed to view all projects, check assignment
  if (!perms.canViewAllProjects && staffId) {
    const { data: check } = await supabase
      .from('proyectos')
      .select('id')
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .or(`responsable_id.eq.${staffId},colaboradores.cs.{${staffId}}`)
      .single()

    if (!check) return null
  }

  // Parallel fetches
  const [financieroRes, rubrosRes, facturasRes, ultimosRes, staffRes] = await Promise.all([
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

    // All activity entries (horas + gastos + cobros) — no limit
    Promise.all([
      supabase
        .from('horas')
        .select('id, fecha, horas, descripcion, created_at, staff:staff_id(full_name, salary, horas_disponibles_mes)')
        .eq('proyecto_id', id)
        .order('fecha', { ascending: false }),
      supabase
        .from('gastos')
        .select('id, fecha, monto, descripcion, mensaje_original, categoria, created_at, tipo, estado_pago, estado_causacion, soporte_url, deducible, canal_registro, created_by, created_by_wa_name, created_by_profile:profiles!gastos_created_by_profiles_fkey(full_name)')
        .eq('proyecto_id', id)
        .eq('estado_causacion', 'APROBADO')
        .order('fecha', { ascending: false }),
      supabase
        .from('cobros')
        .select('id, fecha, monto, notas, created_at')
        .eq('proyecto_id', id)
        .order('fecha', { ascending: false }),
    ]),

    // Active staff list for horas dialog
    supabase
      .from('staff')
      .select('id, full_name, tipo_vinculo, es_principal')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .order('es_principal', { ascending: false })
      .order('full_name'),
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
    ...(horasRes.data ?? []).map(h => {
      const staffName = (h.staff as unknown as { full_name: string } | null)?.full_name
      const desc = [h.descripcion ?? 'Horas registradas', staffName ? `(${staffName})` : ''].filter(Boolean).join(' ')
      return {
        id: h.id,
        tipo: 'horas' as const,
        fecha: h.fecha ?? '',
        descripcion: desc,
        valor: h.horas ?? 0,
        created_at: h.created_at ?? '',
      }
    }),
    ...(gastosRes.data ?? []).map(g => ({
      id: g.id,
      tipo: 'gasto' as const,
      fecha: g.fecha ?? '',
      descripcion: g.descripcion || g.categoria || 'Gasto',
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

  // D131: Fetch cotizacion_id + responsable for link to approved cotización
  const { data: proyectoBase } = await supabase
    .from('proyectos')
    .select('cotizacion_id, oportunidad_id, responsable_id, responsable_comercial_id, custom_data')
    .eq('id', id)
    .single()

  // Fetch responsable staff record if assigned
  let responsable: { id: string; full_name: string } | null = null
  if (proyectoBase?.responsable_id) {
    const { data: staffRecord } = await supabase
      .from('staff')
      .select('id, full_name')
      .eq('id', proyectoBase.responsable_id)
      .single()
    if (staffRecord) {
      responsable = { id: staffRecord.id, full_name: staffRecord.full_name ?? 'Sin nombre' }
    }
  }

  // Fetch responsable comercial staff record if assigned
  let responsableComercial: { id: string; full_name: string } | null = null
  if (proyectoBase?.responsable_comercial_id) {
    const { data: staffRecord } = await supabase
      .from('staff')
      .select('id, full_name')
      .eq('id', proyectoBase.responsable_comercial_id)
      .single()
    if (staffRecord) {
      responsableComercial = { id: staffRecord.id, full_name: staffRecord.full_name ?? 'Sin nombre' }
    }
  }

  // Separate lists for tabs
  const gastosAll = (gastosRes.data ?? []).map(g => {
    const profile = g.created_by_profile as { full_name: string } | null
    return {
      id: g.id,
      fecha: g.fecha ?? '',
      monto: g.monto ?? 0,
      descripcion: g.descripcion || g.categoria || 'Gasto',
      categoria: g.categoria,
      tipo: g.tipo,
      estado_pago: g.estado_pago,
      estado_causacion: g.estado_causacion ?? 'APROBADO',
      soporte_url: g.soporte_url,
      deducible: g.deducible ?? false,
      canal_registro: g.canal_registro ?? null,
      created_by_name: profile?.full_name ?? g.created_by_wa_name ?? null,
    }
  })

  const horasAll = (horasRes.data ?? []).map(h => {
    const staff = h.staff as unknown as { full_name: string; salary: number | null; horas_disponibles_mes: number | null } | null
    const tarifaHora = (staff?.salary && staff?.horas_disponibles_mes) ? staff.salary / staff.horas_disponibles_mes : 0
    return {
      id: h.id,
      fecha: h.fecha ?? '',
      horas: h.horas ?? 0,
      descripcion: h.descripcion ?? 'Horas registradas',
      staff_name: staff?.full_name ?? null,
      costo: (h.horas ?? 0) * tarifaHora,
    }
  })

  return {
    financiero: financieroRes.data,
    rubros: rubrosRes.data ?? [],
    facturas: facturasRes.data ?? [],
    timeline,
    gastosAll,
    horasAll,
    rubrosLista: rubrosLista ?? [],
    staffList: (staffRes.data ?? []).map(s => ({
      id: s.id,
      full_name: s.full_name ?? 'Sin nombre',
      tipo_vinculo: s.tipo_vinculo,
      es_principal: s.es_principal,
    })),
    cotizacionId: proyectoBase?.cotizacion_id ?? null,
    oportunidadId: proyectoBase?.oportunidad_id ?? null,
    responsable,
    responsableComercial,
    customData: (proyectoBase?.custom_data as Record<string, unknown>) ?? {},
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
  leccionesAprendidas?: string,
  roi?: { descripcion?: string; retornoEstimado?: number },
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
    return cerrarProyecto(id, leccionesAprendidas, roi)
  }

  const updates: Record<string, unknown> = {
    estado: nuevoEstado,
    updated_at: new Date().toISOString(),
    estado_changed_at: new Date().toISOString(),
  }

  const { error: dbError } = await supabase
    .from('proyectos')
    .update(updates)
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  if (workspaceId) {
    await logSystemChange(workspaceId, 'proyecto', id, 'estado', estadoActual, nuevoEstado, null)
  }

  revalidatePath('/proyectos')
  revalidatePath(`/proyectos/${id}`)
  return { success: true, proyectoId: id }
}

// ── Cerrar proyecto (snapshot §5.5) ─────────────────────

async function cerrarProyecto(
  id: string,
  leccionesAprendidas?: string,
  roi?: { descripcion?: string; retornoEstimado?: number },
): Promise<ActionResult & { proyectoId?: string }> {
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
    cartera: (fin.facturado ?? 0) - (fin.cobrado ?? 0),
    ganancia_estimada: fin.ganancia_estimada,
    ganancia_actual: fin.ganancia_actual,
    avance_porcentaje: fin.avance_porcentaje,
    presupuesto_consumido_pct: fin.presupuesto_consumido_pct,
  }

  const updatePayload: Record<string, unknown> = {
    estado: 'cerrado',
    fecha_cierre: new Date().toISOString().split('T')[0],
    cierre_snapshot: snapshot,
    lecciones_aprendidas: leccionesAprendidas?.trim() || null,
    avance_porcentaje: 100,
    updated_at: new Date().toISOString(),
  }

  // ROI fields for internal projects
  if (roi?.descripcion) updatePayload.roi_descripcion = roi.descripcion.trim()
  if (roi?.retornoEstimado != null) updatePayload.roi_retorno_estimado = roi.retornoEstimado

  const { error: dbError } = await supabase
    .from('proyectos')
    .update(updatePayload)
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  // Update costos_referencia (feedback loop §5.6) — only for client projects
  const { data: proyecto } = await supabase
    .from('proyectos')
    .select('oportunidad_id, tipo')
    .eq('id', id)
    .single()

  // Log project closure
  if (workspaceId) {
    await logSystemChange(workspaceId, 'proyecto', id, 'estado', 'en_ejecucion', 'cerrado', null)
  }

  if (proyecto?.tipo !== 'interno' && proyecto?.oportunidad_id) {
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
  staff_id?: string
}): Promise<ActionResult> {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
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

  // If no staff_id provided, default to principal staff
  let staffId = input.staff_id
  if (!staffId) {
    const { data: principal } = await supabase
      .from('staff')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('es_principal', true)
      .eq('is_active', true)
      .limit(1)
      .single()
    staffId = principal?.id ?? undefined
  }

  // Auto-approve for owner/admin
  const perms = getRolePermissions(role ?? 'read_only')
  const autoApprove = perms.canApproveCausacion

  const { error: dbError } = await supabase
    .from('horas')
    .insert({
      workspace_id: workspaceId,
      proyecto_id: proyectoId,
      fecha: input.fecha,
      horas: input.horas,
      descripcion: input.descripcion?.trim() || null,
      staff_id: staffId || null,
      created_by: userId,
      estado_aprobacion: autoApprove ? 'APROBADO' : 'PENDIENTE',
      aprobado_por: autoApprove ? userId : null,
      fecha_aprobacion: autoApprove ? new Date().toISOString() : null,
    })

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath(`/proyectos/${proyectoId}`)
  revalidatePath('/proyectos')
  revalidatePath('/equipo')
  return { success: true }
}

// ── Add gasto directo ───────────────────────────────────

export async function addGastoDirecto(proyectoId: string, input: {
  monto: number
  rubro_id?: string
  descripcion?: string
  categoria?: string
  fecha?: string
  estado_pago?: 'pagado' | 'pendiente'
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
      tipo: 'directo',
      estado_pago: input.estado_pago ?? 'pagado',
      created_by: userId,
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

  // Validate estado + tipo — factura NOT allowed on cerrado or interno
  const { data: proyecto } = await supabase
    .from('proyectos')
    .select('estado, tipo')
    .eq('id', proyectoId)
    .single()

  if (!proyecto) return { success: false, error: 'Proyecto no encontrado' }
  if (proyecto.tipo === 'interno') {
    return { success: false, error: 'Los proyectos internos no admiten facturación' }
  }
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
  const { supabase, workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Get factura to find proyecto_id (no state restriction for cobros on client projects)
  const { data: factura } = await supabase
    .from('facturas')
    .select('id, proyecto_id, monto')
    .eq('id', facturaId)
    .single()

  if (!factura) return { success: false, error: 'Factura no encontrada' }

  // Validate tipo — cobro NOT allowed on interno
  if (factura.proyecto_id) {
    const { data: proyecto } = await supabase
      .from('proyectos')
      .select('tipo')
      .eq('id', factura.proyecto_id)
      .single()
    if (proyecto?.tipo === 'interno') {
      return { success: false, error: 'Los proyectos internos no admiten cobros' }
    }
  }

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
      created_by: userId,
    })

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath(`/proyectos/${factura.proyecto_id}`)
  revalidatePath('/proyectos')
  return { success: true }
}

// ── D176: Marcar proyecto como entregado ────────────────

export async function marcarEntregado(id: string): Promise<ActionResult & { proyectoId?: string }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const { data: proyecto } = await supabase
    .from('proyectos')
    .select('estado, nombre')
    .eq('id', id)
    .single()

  if (!proyecto) return { success: false, error: 'Proyecto no encontrado' }

  const estadoActual = proyecto.estado as EstadoProyectoV2
  const permitidos = TRANSICIONES[estadoActual] ?? []

  if (!permitidos.includes('entregado')) {
    return { success: false, error: `No se puede marcar como entregado desde "${estadoActual}"` }
  }

  const { error: dbError } = await supabase
    .from('proyectos')
    .update({
      estado: 'entregado',
      updated_at: new Date().toISOString(),
      estado_changed_at: new Date().toISOString(),
    })
    .eq('id', id)

  if (dbError) return { success: false, error: dbError.message }

  if (workspaceId) {
    await logSystemChange(workspaceId, 'proyecto', id, 'estado', estadoActual, 'entregado', null)
  }

  revalidatePath('/proyectos')
  revalidatePath(`/proyectos/${id}`)
  return { success: true, proyectoId: id }
}

// ── Actualizar responsable ───────────────────────────────

export async function updateProyectoResponsable(id: string, responsableId: string | null): Promise<ActionResult> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('proyectos')
    .update({ responsable_id: responsableId || null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', workspaceId)

  if (dbError) return { success: false, error: dbError.message }
  revalidatePath(`/proyectos/${id}`)
  return { success: true }
}

// ── Actualizar carpeta URL ────────────────────────────────

export async function updateProyectoCarpeta(id: string, carpetaUrl: string | null): Promise<ActionResult> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const { data: updated, error: dbError } = await supabase
    .from('proyectos')
    .update({ carpeta_url: carpetaUrl?.trim() || null, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('workspace_id', workspaceId)
    .select('id, carpeta_url')

  if (dbError) return { success: false, error: dbError.message }
  if (!updated || updated.length === 0) return { success: false, error: `0 filas actualizadas (id=${id}, ws=${workspaceId})` }
  revalidatePath(`/proyectos/${id}`)
  revalidatePath('/negocios')
  return { success: true }
}
