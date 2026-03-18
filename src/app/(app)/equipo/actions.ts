'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'

// ── Types ───────────────────────────────────────────────

export type HoraEntry = {
  id: string
  fecha: string
  horas: number
  descripcion: string | null
  proyecto_nombre: string | null
  proyecto_codigo: string | null
  proyecto_id: string | null
  staff_name: string | null
  staff_id: string | null
  costo: number
  estado_aprobacion: 'PENDIENTE' | 'APROBADO' | 'RECHAZADO'
  rechazo_motivo: string | null
  created_by_name: string | null
}

type ActionResult = { success: true } | { success: false; error: string }

// ── Get horas with filters ─────────────────────────────

export async function getHoras(filters?: {
  mes?: string
  staff?: string
  proyecto?: string
  estado?: string
}) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { horas: [], totales: { totalHoras: 0, totalCosto: 0, pendientes: 0 } }

  const mes = filters?.mes ?? new Date().toISOString().slice(0, 7)
  const staffFilter = filters?.staff && filters.staff !== 'todos' ? filters.staff : null
  const proyFilter = filters?.proyecto && filters.proyecto !== 'todos' ? filters.proyecto : null
  const estadoFilter = filters?.estado && filters.estado !== 'todos' ? filters.estado : null

  const startDate = `${mes}-01`
  const [y, m] = mes.split('-').map(Number)
  const endDate = new Date(y, m, 0).toISOString().split('T')[0]

  let query = supabase
    .from('horas')
    .select('id, fecha, horas, descripcion, proyecto_id, estado_aprobacion, rechazo_motivo, staff_id, staff:staff_id(full_name, salary, horas_disponibles_mes), proyectos:proyecto_id(nombre, codigo)')
    .eq('workspace_id', workspaceId)
    .gte('fecha', startDate)
    .lte('fecha', endDate)

  if (staffFilter) query = query.eq('staff_id', staffFilter)
  if (proyFilter) query = query.eq('proyecto_id', proyFilter)
  if (estadoFilter) {
    query = query.eq('estado_aprobacion', estadoFilter)
  } else {
    query = query.neq('estado_aprobacion', 'RECHAZADO')
  }

  query = query.order('fecha', { ascending: false })

  const { data } = await query

  const results: HoraEntry[] = (data ?? []).map(h => {
    const staff = h.staff as unknown as { full_name: string; salary: number | null; horas_disponibles_mes: number | null } | null
    const proy = h.proyectos as unknown as { nombre: string; codigo: string } | null
    const tarifa = (staff?.salary && staff?.horas_disponibles_mes) ? staff.salary / staff.horas_disponibles_mes : 0
    return {
      id: h.id,
      fecha: h.fecha,
      horas: Number(h.horas),
      descripcion: h.descripcion,
      proyecto_nombre: proy?.nombre ?? null,
      proyecto_codigo: proy?.codigo ?? null,
      proyecto_id: h.proyecto_id,
      staff_name: staff?.full_name ?? null,
      staff_id: h.staff_id,
      costo: Number(h.horas) * tarifa,
      estado_aprobacion: (h.estado_aprobacion as HoraEntry['estado_aprobacion']) ?? 'PENDIENTE',
      rechazo_motivo: h.rechazo_motivo ?? null,
      created_by_name: staff?.full_name ?? null,
    }
  })

  const totalHoras = results.reduce((s, h) => s + h.horas, 0)
  const totalCosto = results.reduce((s, h) => s + h.costo, 0)
  const pendientes = results.filter(h => h.estado_aprobacion === 'PENDIENTE').length

  return { horas: results, totales: { totalHoras, totalCosto, pendientes } }
}

// ── Filter options ─────────────────────────────────────

export async function getEquipoFilterOptions() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { staff: [], proyectos: [] }

  const [{ data: staffData }, { data: proyData }] = await Promise.all([
    supabase
      .from('staff')
      .select('id, full_name')
      .eq('workspace_id', workspaceId)
      .eq('is_active', true)
      .order('full_name'),
    supabase
      .from('proyectos')
      .select('id, nombre, codigo')
      .eq('workspace_id', workspaceId)
      .in('estado', ['en_ejecucion', 'cerrado'])
      .order('nombre'),
  ])

  return {
    staff: (staffData ?? []).map(s => ({ id: s.id, nombre: s.full_name ?? 'Sin nombre' })),
    proyectos: (proyData ?? []).map(p => ({ id: p.id, nombre: p.nombre ?? 'Sin nombre', codigo: p.codigo ?? '' })),
  }
}

// ── Staff summary for profile ──────────────────────────

export async function getStaffResumen(staffId: string, mes: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return null

  const startDate = `${mes}-01`
  const [y, m] = mes.split('-').map(Number)
  const endDate = new Date(y, m, 0).toISOString().split('T')[0]

  const [{ data: staffData }, { data: horasData }] = await Promise.all([
    supabase
      .from('staff')
      .select('id, full_name, salary, horas_disponibles_mes, tipo_vinculo, es_principal')
      .eq('id', staffId)
      .single(),
    supabase
      .from('horas')
      .select('horas, estado_aprobacion, proyecto_id, proyectos:proyecto_id(nombre, codigo)')
      .eq('workspace_id', workspaceId)
      .eq('staff_id', staffId)
      .gte('fecha', startDate)
      .lte('fecha', endDate),
  ])

  if (!staffData) return null

  const tarifa = (staffData.salary && staffData.horas_disponibles_mes) ? staffData.salary / staffData.horas_disponibles_mes : 0
  const aprobadas = (horasData ?? []).filter(h => h.estado_aprobacion === 'APROBADO')
  const pendientes = (horasData ?? []).filter(h => h.estado_aprobacion === 'PENDIENTE')
  const rechazadas = (horasData ?? []).filter(h => h.estado_aprobacion === 'RECHAZADO')

  // Group by project
  const porProyecto = new Map<string, { nombre: string; codigo: string; horas: number }>()
  for (const h of aprobadas) {
    const proy = h.proyectos as unknown as { nombre: string; codigo: string } | null
    const key = h.proyecto_id ?? 'sin-proyecto'
    const existing = porProyecto.get(key)
    if (existing) {
      existing.horas += Number(h.horas)
    } else {
      porProyecto.set(key, { nombre: proy?.nombre ?? 'Sin proyecto', codigo: proy?.codigo ?? '', horas: Number(h.horas) })
    }
  }

  return {
    staff: {
      id: staffData.id,
      nombre: staffData.full_name ?? 'Sin nombre',
      salary: staffData.salary,
      horas_disponibles: staffData.horas_disponibles_mes,
      tipo_vinculo: staffData.tipo_vinculo,
      es_principal: staffData.es_principal,
      tarifa_hora: tarifa,
    },
    horas: {
      aprobadas: aprobadas.reduce((s, h) => s + Number(h.horas), 0),
      pendientes: pendientes.reduce((s, h) => s + Number(h.horas), 0),
      rechazadas: rechazadas.reduce((s, h) => s + Number(h.horas), 0),
    },
    costo: aprobadas.reduce((s, h) => s + Number(h.horas), 0) * tarifa,
    porProyecto: Array.from(porProyecto.values()).sort((a, b) => b.horas - a.horas),
  }
}

// ── Aprobar hora (PENDIENTE → APROBADO) ────────────────

export async function aprobarHora(horaId: string): Promise<ActionResult> {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { success: false, error: 'No autenticado' }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canApproveCausacion) return { success: false, error: 'Sin permisos para aprobar' }

  const { data } = await supabase
    .from('horas')
    .select('id, estado_aprobacion')
    .eq('id', horaId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!data) return { success: false, error: 'Registro no encontrado' }
  if (data.estado_aprobacion !== 'PENDIENTE') return { success: false, error: 'Solo se pueden aprobar horas PENDIENTES' }

  const { error: updateError } = await supabase
    .from('horas')
    .update({
      estado_aprobacion: 'APROBADO',
      aprobado_por: userId,
      fecha_aprobacion: new Date().toISOString(),
    })
    .eq('id', horaId)

  if (updateError) return { success: false, error: updateError.message }

  revalidatePath('/equipo')
  revalidatePath('/proyectos')
  return { success: true }
}

// ── Rechazar hora (PENDIENTE → RECHAZADO) ──────────────

export async function rechazarHora(horaId: string, motivo: string): Promise<ActionResult> {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { success: false, error: 'No autenticado' }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canApproveCausacion) return { success: false, error: 'Sin permisos para rechazar' }
  if (!motivo || motivo.trim().length === 0) return { success: false, error: 'El motivo es obligatorio' }

  const { data } = await supabase
    .from('horas')
    .select('id, estado_aprobacion')
    .eq('id', horaId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!data) return { success: false, error: 'Registro no encontrado' }
  if (data.estado_aprobacion !== 'PENDIENTE') return { success: false, error: 'Solo se pueden rechazar horas PENDIENTES' }

  const { error: updateError } = await supabase
    .from('horas')
    .update({
      estado_aprobacion: 'RECHAZADO',
      rechazo_motivo: motivo.trim(),
    })
    .eq('id', horaId)

  if (updateError) return { success: false, error: updateError.message }

  revalidatePath('/equipo')
  revalidatePath('/proyectos')
  return { success: true }
}

// ── Revertir aprobación (APROBADO → RECHAZADO) — solo owner ──

export async function revertirHora(horaId: string, motivo: string): Promise<ActionResult> {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { success: false, error: 'No autenticado' }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canRevertApproval) return { success: false, error: 'Solo el dueno puede revertir aprobaciones' }
  if (!motivo || motivo.trim().length === 0) return { success: false, error: 'El motivo es obligatorio' }

  const { data } = await supabase
    .from('horas')
    .select('id, estado_aprobacion')
    .eq('id', horaId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!data) return { success: false, error: 'Registro no encontrado' }
  if (data.estado_aprobacion !== 'APROBADO') return { success: false, error: 'Solo se pueden revertir horas APROBADAS' }

  const { error: updateError } = await supabase
    .from('horas')
    .update({
      estado_aprobacion: 'RECHAZADO',
      rechazo_motivo: motivo.trim(),
      aprobado_por: null,
      fecha_aprobacion: null,
    })
    .eq('id', horaId)

  if (updateError) return { success: false, error: updateError.message }

  revalidatePath('/equipo')
  revalidatePath('/proyectos')
  return { success: true }
}

// ── Aprobar todas las horas pendientes visibles ────────

export async function aprobarTodasHoras(ids: string[]): Promise<ActionResult & { count?: number }> {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { success: false, error: 'No autenticado' }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canApproveCausacion) return { success: false, error: 'Sin permisos para aprobar' }

  let approved = 0
  for (const id of ids) {
    const { error: updateError } = await supabase
      .from('horas')
      .update({
        estado_aprobacion: 'APROBADO',
        aprobado_por: userId,
        fecha_aprobacion: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('workspace_id', workspaceId)
      .eq('estado_aprobacion', 'PENDIENTE')

    if (!updateError) approved++
  }

  revalidatePath('/equipo')
  revalidatePath('/proyectos')
  return { success: true, count: approved }
}
