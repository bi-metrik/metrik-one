'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'

export type Movimiento = {
  id: string
  tipo: 'ingreso' | 'egreso'
  tabla: 'gastos' | 'cobros'
  fecha: string
  monto: number
  descripcion: string
  categoria: string | null
  proyecto: string | null
  proyecto_codigo: string | null
  deducible: boolean
  soporte_url: string | null
  tipo_gasto: 'directo' | 'empresa' | 'fijo' | null
  canal_registro: 'app' | 'whatsapp' | null
  created_by_name: string | null
  created_by_initials: string | null
  estado_pago: 'pagado' | 'pendiente' | null  // null for ingresos
  fecha_pago: string | null
  // D246: Causación contable
  estado_causacion: 'PENDIENTE' | 'APROBADO' | 'CAUSADO' | 'RECHAZADO'
  rechazo_motivo: string | null
}

// D142: Categorías deducibles para régimen ordinario
const CATEGORIAS_DEDUCIBLES = ['materiales', 'transporte', 'servicios_profesionales', 'viaticos', 'software', 'impuestos_seguros', 'mano_de_obra']

function esCategoriaDeducible(categoria: string | null): boolean {
  if (!categoria) return false
  return CATEGORIAS_DEDUCIBLES.includes(categoria)
}

function getInitials(name: string | null): string | null {
  if (!name) return null
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return parts[0].substring(0, 2).toUpperCase()
}

export async function getMovimientos(filters?: {
  tipo?: 'todos' | 'ingresos' | 'egresos'
  mes?: string // YYYY-MM
  cat?: string          // categoria filter
  proy?: string         // proyecto_id filter
  tipoProy?: string     // 'interno' | 'cliente' | 'empresa' | 'todos'
  estadoPago?: string   // 'todos' | 'pagado' | 'pendiente'
  estadoCausacion?: string // D246: 'todos' | 'PENDIENTE' | 'APROBADO' | 'CAUSADO' | 'RECHAZADO'
  createdBy?: string    // user_id filter
}) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { movimientos: [], totales: { ingresos: 0, egresos: 0, deducible: 0 }, regimenFiscal: null as string | null }

  const tipoFilter = filters?.tipo ?? 'todos'
  const mes = filters?.mes ?? new Date().toISOString().slice(0, 7) // default current month
  const catFilter = filters?.cat && filters.cat !== 'todos' ? filters.cat : null
  const proyFilter = filters?.proy && filters.proy !== 'todos' ? filters.proy : null
  const tipoProyFilter = filters?.tipoProy && filters.tipoProy !== 'todos' ? filters.tipoProy : null
  const estadoPagoFilter = filters?.estadoPago && filters.estadoPago !== 'todos' ? filters.estadoPago : null
  const estadoCausacionFilter = filters?.estadoCausacion && filters.estadoCausacion !== 'todos' ? filters.estadoCausacion : null
  const createdByFilter = filters?.createdBy && filters.createdBy !== 'todos' ? filters.createdBy : null

  const startDate = `${mes}-01`
  const [y, m] = mes.split('-').map(Number)
  const endDate = new Date(y, m, 0).toISOString().split('T')[0] // last day of month

  // If filtering by tipoProy, we need project IDs
  let proyectoIdsByTipo: string[] | null = null
  if (tipoProyFilter && tipoProyFilter !== 'empresa') {
    const { data: projs } = await supabase
      .from('proyectos')
      .select('id')
      .eq('workspace_id', workspaceId)
      .eq('tipo', tipoProyFilter)
    proyectoIdsByTipo = (projs ?? []).map(p => p.id)
  }

  const results: Movimiento[] = []

  // ── Egresos (gastos table) ──────────────────────────
  if (tipoFilter === 'todos' || tipoFilter === 'egresos') {
    // Skip gastos entirely if tipoProy='empresa' was requested and we only want ingresos
    const skipGastos = false

    if (!skipGastos) {
      let query = supabase
        .from('gastos')
        .select('id, fecha, monto, descripcion, mensaje_original, categoria, deducible, soporte_url, tipo, canal_registro, proyecto_id, proyectos(nombre, codigo), created_by, created_by_profile:profiles!gastos_created_by_profiles_fkey(full_name), estado_pago, fecha_pago, estado_causacion, rechazo_motivo')
        .eq('workspace_id', workspaceId)
        .gte('fecha', startDate)
        .lte('fecha', endDate)

      // Apply filters
      if (catFilter) query = query.eq('categoria', catFilter)
      if (proyFilter === 'empresa') {
        query = query.is('proyecto_id', null)
      } else if (proyFilter) {
        query = query.eq('proyecto_id', proyFilter)
      }
      if (tipoProyFilter === 'empresa') {
        query = query.is('proyecto_id', null)
      } else if (proyectoIdsByTipo && proyectoIdsByTipo.length > 0) {
        query = query.in('proyecto_id', proyectoIdsByTipo)
      } else if (proyectoIdsByTipo && proyectoIdsByTipo.length === 0) {
        // No projects of that type — return empty for gastos
        query = query.eq('id', '00000000-0000-0000-0000-000000000000') // impossible match
      }
      if (estadoPagoFilter) query = query.eq('estado_pago', estadoPagoFilter)
      if (createdByFilter) query = query.eq('created_by', createdByFilter)
      if (estadoCausacionFilter) {
        query = query.eq('estado_causacion', estadoCausacionFilter)
      } else {
        // Hide rejected by default
        query = query.neq('estado_causacion', 'RECHAZADO')
      }

      query = query.order('fecha', { ascending: false })

      const { data: gastos } = await query

      for (const g of gastos ?? []) {
        const proy = g.proyectos as { nombre: string; codigo: string } | null
        const profile = g.created_by_profile as { full_name: string } | null
        results.push({
          id: g.id,
          tipo: 'egreso',
          tabla: 'gastos',
          fecha: g.fecha,
          monto: Number(g.monto),
          descripcion: g.descripcion || g.categoria || 'Gasto',
          categoria: g.categoria,
          proyecto: proy?.nombre ?? null,
          proyecto_codigo: proy?.codigo ?? null,
          deducible: g.deducible ?? false,
          soporte_url: g.soporte_url ?? null,
          tipo_gasto: (g.tipo as Movimiento['tipo_gasto']) ?? null,
          canal_registro: (g.canal_registro as Movimiento['canal_registro']) ?? null,
          created_by_name: profile?.full_name ?? null,
          created_by_initials: getInitials(profile?.full_name ?? null),
          estado_pago: (g.estado_pago as 'pagado' | 'pendiente') ?? 'pagado',
          fecha_pago: g.fecha_pago ?? null,
          estado_causacion: (g.estado_causacion as Movimiento['estado_causacion']) ?? 'PENDIENTE',
          rechazo_motivo: g.rechazo_motivo ?? null,
        })
      }
    }
  }

  // ── Ingresos (cobros table) ─────────────────────────
  // Skip ingresos if estadoPago filter is set (cobros don't have estado_pago)
  const skipIngresos = !!estadoPagoFilter || !!catFilter || tipoProyFilter === 'empresa'
  if ((tipoFilter === 'todos' || tipoFilter === 'ingresos') && !skipIngresos) {
    let query = supabase
      .from('cobros')
      .select('id, fecha, monto, notas, proyecto_id, proyectos(nombre, codigo), created_by, created_by_profile:profiles!cobros_created_by_profiles_fkey(full_name), estado_causacion, rechazo_motivo')
      .eq('workspace_id', workspaceId)
      .gte('fecha', startDate)
      .lte('fecha', endDate)

    // Apply filters
    if (proyFilter && proyFilter !== 'empresa') {
      query = query.eq('proyecto_id', proyFilter)
    }
    if (proyectoIdsByTipo && proyectoIdsByTipo.length > 0) {
      query = query.in('proyecto_id', proyectoIdsByTipo)
    } else if (proyectoIdsByTipo && proyectoIdsByTipo.length === 0) {
      query = query.eq('id', '00000000-0000-0000-0000-000000000000')
    }
    if (createdByFilter) query = query.eq('created_by', createdByFilter)
    if (estadoCausacionFilter) {
      query = query.eq('estado_causacion', estadoCausacionFilter)
    } else {
      // Hide rejected by default
      query = query.neq('estado_causacion', 'RECHAZADO')
    }

    query = query.order('fecha', { ascending: false })

    const { data: cobros } = await query

    for (const c of cobros ?? []) {
      const proy = c.proyectos as { nombre: string; codigo: string } | null
      const profile = c.created_by_profile as { full_name: string } | null
      results.push({
        id: c.id,
        tipo: 'ingreso',
        tabla: 'cobros',
        fecha: c.fecha,
        monto: Number(c.monto),
        descripcion: c.notas ?? 'Cobro',
        categoria: null,
        proyecto: proy?.nombre ?? null,
        proyecto_codigo: proy?.codigo ?? null,
        deducible: false,
        soporte_url: null,
        tipo_gasto: null,
        canal_registro: null,
        created_by_name: profile?.full_name ?? null,
        created_by_initials: getInitials(profile?.full_name ?? null),
        estado_pago: null,
        fecha_pago: null,
        estado_causacion: (c.estado_causacion as Movimiento['estado_causacion']) ?? 'PENDIENTE',
        rechazo_motivo: c.rechazo_motivo ?? null,
      })
    }
  }

  // Sort by date descending
  results.sort((a, b) => b.fecha.localeCompare(a.fecha))

  // Totals
  const ingresos = results.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0)
  const egresos = results.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.monto, 0)

  // D142: Deducible total (category-based + soporte)
  const deducible = results
    .filter(m => m.tipo === 'egreso' && esCategoriaDeducible(m.categoria) && m.soporte_url)
    .reduce((s, m) => s + m.monto, 0)

  // D141: Fiscal regime
  const { data: fiscalProfile } = await supabase
    .from('fiscal_profiles')
    .select('tax_regime')
    .eq('workspace_id', workspaceId)
    .maybeSingle()

  const regimenFiscal = (fiscalProfile?.tax_regime as string | null) ?? null

  return { movimientos: results, totales: { ingresos, egresos, deducible }, regimenFiscal }
}

// ── Filter options for the UI ─────────────────────────

export async function getFilterOptions() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { proyectos: [], miembros: [] }

  const [{ data: proyData }, { data: profilesData }] = await Promise.all([
    supabase
      .from('proyectos')
      .select('id, nombre, tipo, codigo')
      .eq('workspace_id', workspaceId)
      .in('estado', ['en_ejecucion', 'cerrado'])
      .order('nombre'),
    supabase
      .from('profiles')
      .select('id, full_name')
      .eq('workspace_id', workspaceId)
      .order('full_name'),
  ])

  return {
    proyectos: (proyData ?? []).map(p => ({
      id: p.id,
      nombre: p.nombre ?? 'Sin nombre',
      tipo: p.tipo ?? 'cliente',
      codigo: p.codigo ?? '',
    })),
    miembros: (profilesData ?? []).map(p => ({
      id: p.id,
      nombre: p.full_name ?? 'Sin nombre',
    })),
  }
}

// ── D119: Marcar gasto como pagado ────────────────────

export async function marcarComoPagado(gastoId: string, fechaPago?: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Validate gasto belongs to workspace and is pendiente
  const { data: gasto } = await supabase
    .from('gastos')
    .select('id, estado_pago')
    .eq('id', gastoId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!gasto) return { success: false, error: 'Gasto no encontrado' }
  if (gasto.estado_pago !== 'pendiente') return { success: false, error: 'El gasto ya está pagado' }

  const { error: updateError } = await supabase
    .from('gastos')
    .update({
      estado_pago: 'pagado',
      fecha_pago: fechaPago || new Date().toISOString().split('T')[0],
    })
    .eq('id', gastoId)

  if (updateError) return { success: false, error: updateError.message }

  revalidatePath('/movimientos')
  revalidatePath('/numeros')
  return { success: true }
}

// ── D246: Aprobar movimiento (PENDIENTE → APROBADO) ────

export async function aprobarMovimiento(tabla: 'gastos' | 'cobros', registroId: string) {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { success: false, error: 'No autenticado' }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canApproveCausacion) return { success: false, error: 'Sin permisos para aprobar' }

  // Validate record belongs to workspace and is PENDIENTE
  let estadoCausacion: string | null = null
  if (tabla === 'gastos') {
    const { data } = await supabase.from('gastos').select('id, estado_causacion').eq('id', registroId).eq('workspace_id', workspaceId).single()
    if (!data) return { success: false, error: 'Registro no encontrado' }
    estadoCausacion = data.estado_causacion
  } else {
    const { data } = await supabase.from('cobros').select('id, estado_causacion').eq('id', registroId).eq('workspace_id', workspaceId).single()
    if (!data) return { success: false, error: 'Registro no encontrado' }
    estadoCausacion = data.estado_causacion
  }

  if (estadoCausacion !== 'PENDIENTE') return { success: false, error: 'Solo se pueden aprobar movimientos PENDIENTES' }

  const updatePayload = {
    estado_causacion: 'APROBADO' as const,
    aprobado_por: userId,
    fecha_aprobacion: new Date().toISOString(),
  }

  const { error: updateError } = tabla === 'gastos'
    ? await supabase.from('gastos').update(updatePayload).eq('id', registroId)
    : await supabase.from('cobros').update(updatePayload).eq('id', registroId)

  if (updateError) return { success: false, error: updateError.message }

  // Log to causaciones_log
  await supabase.from('causaciones_log').insert({
    workspace_id: workspaceId,
    tabla,
    registro_id: registroId,
    accion: 'APROBAR',
    estado_anterior: 'PENDIENTE',
    estado_nuevo: 'APROBADO',
    realizado_por: userId,
  })

  revalidatePath('/movimientos')
  revalidatePath('/causacion')
  return { success: true }
}

// ── D246: Rechazar movimiento (PENDIENTE → RECHAZADO) ──

export async function rechazarMovimiento(tabla: 'gastos' | 'cobros', registroId: string, motivo: string) {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { success: false, error: 'No autenticado' }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canApproveCausacion) return { success: false, error: 'Sin permisos para rechazar' }

  if (!motivo || motivo.trim().length === 0) return { success: false, error: 'El motivo es obligatorio' }

  // Validate record belongs to workspace and is PENDIENTE
  let estadoCausacion: string | null = null
  if (tabla === 'gastos') {
    const { data } = await supabase.from('gastos').select('id, estado_causacion').eq('id', registroId).eq('workspace_id', workspaceId).single()
    if (!data) return { success: false, error: 'Registro no encontrado' }
    estadoCausacion = data.estado_causacion
  } else {
    const { data } = await supabase.from('cobros').select('id, estado_causacion').eq('id', registroId).eq('workspace_id', workspaceId).single()
    if (!data) return { success: false, error: 'Registro no encontrado' }
    estadoCausacion = data.estado_causacion
  }

  if (estadoCausacion !== 'PENDIENTE') return { success: false, error: 'Solo se pueden rechazar movimientos PENDIENTES' }

  const updatePayload = {
    estado_causacion: 'RECHAZADO' as const,
    rechazo_motivo: motivo.trim(),
  }

  const { error: updateError } = tabla === 'gastos'
    ? await supabase.from('gastos').update(updatePayload).eq('id', registroId)
    : await supabase.from('cobros').update(updatePayload).eq('id', registroId)

  if (updateError) return { success: false, error: updateError.message }

  // Log to causaciones_log
  await supabase.from('causaciones_log').insert({
    workspace_id: workspaceId,
    tabla,
    registro_id: registroId,
    accion: 'RECHAZAR',
    estado_anterior: 'PENDIENTE',
    estado_nuevo: 'RECHAZADO',
    motivo: motivo.trim(),
    realizado_por: userId,
  })

  revalidatePath('/movimientos')
  revalidatePath('/causacion')
  return { success: true }
}

// ── Aprobar todos los movimientos visibles ────────────────────

export async function aprobarTodos(items: { tabla: 'gastos' | 'cobros'; id: string }[]) {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { success: false, error: 'No autenticado', count: 0 }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canApproveCausacion) return { success: false, error: 'Sin permisos para aprobar', count: 0 }

  const updatePayload = {
    estado_causacion: 'APROBADO' as const,
    aprobado_por: userId,
    fecha_aprobacion: new Date().toISOString(),
  }

  let approved = 0

  for (const item of items) {
    const { error: updateError } = item.tabla === 'gastos'
      ? await supabase.from('gastos').update(updatePayload).eq('id', item.id).eq('workspace_id', workspaceId).eq('estado_causacion', 'PENDIENTE')
      : await supabase.from('cobros').update(updatePayload).eq('id', item.id).eq('workspace_id', workspaceId).eq('estado_causacion', 'PENDIENTE')

    if (!updateError) {
      approved++
      await supabase.from('causaciones_log').insert({
        workspace_id: workspaceId,
        tabla: item.tabla,
        registro_id: item.id,
        accion: 'APROBAR',
        estado_anterior: 'PENDIENTE',
        estado_nuevo: 'APROBADO',
        realizado_por: userId,
      })
    }
  }

  revalidatePath('/movimientos')
  revalidatePath('/causacion')
  return { success: true, error: null, count: approved }
}
