'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'

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
  negocio: string | null
  negocio_codigo: string | null
  deducible: boolean
  soporte_url: string | null
  tipo_gasto: 'directo' | 'empresa' | 'fijo' | null
  canal_registro: 'app' | 'whatsapp' | null
  created_by_name: string | null
  created_by_initials: string | null
  estado_pago: 'pagado' | 'pendiente' | null  // null for ingresos
  fecha_pago: string | null
  // 2026-04-27: Refactor capa fiscal — flag binario reemplaza estado_causacion
  revisado: boolean
  clasificacion_costo: 'variable' | 'fijo' | 'no_operativo' | null  // null for cobros
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
  revisadoFiltro?: 'todos' | 'pendientes' | 'revisados'
  clasificacionFiltro?: 'todos' | 'variable' | 'fijo' | 'no_operativo'
  createdBy?: string    // user_id filter
}) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { movimientos: [], totales: { ingresos: 0, egresos: 0, deducible: 0 }, regimenFiscal: null as string | null }

  const tipoFilter = filters?.tipo ?? 'todos'
  const mes = filters?.mes ?? new Date().toISOString().slice(0, 7)
  const catFilter = filters?.cat && filters.cat !== 'todos' ? filters.cat : null
  const proyFilter = filters?.proy && filters.proy !== 'todos' ? filters.proy : null
  const tipoProyFilter = filters?.tipoProy && filters.tipoProy !== 'todos' ? filters.tipoProy : null
  const estadoPagoFilter = filters?.estadoPago && filters.estadoPago !== 'todos' ? filters.estadoPago : null
  const revisadoFiltro = filters?.revisadoFiltro && filters.revisadoFiltro !== 'todos' ? filters.revisadoFiltro : null
  const clasificacionFiltro = filters?.clasificacionFiltro && filters.clasificacionFiltro !== 'todos' ? filters.clasificacionFiltro : null
  const createdByFilter = filters?.createdBy && filters.createdBy !== 'todos' ? filters.createdBy : null

  const startDate = `${mes}-01`
  const [y, m] = mes.split('-').map(Number)
  const endDate = new Date(y, m, 0).toISOString().split('T')[0]

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

  // ── Egresos (gastos) ──────────────────────────
  if (tipoFilter === 'todos' || tipoFilter === 'egresos') {
    let query = supabase
      .from('gastos')
      .select('id, fecha, monto, descripcion, mensaje_original, categoria, deducible, soporte_url, tipo, canal_registro, created_by_wa_name, proyecto_id, proyectos(nombre, codigo), negocio_id, negocios(nombre, codigo), created_by, created_by_profile:profiles!gastos_created_by_profiles_fkey(full_name), estado_pago, fecha_pago, revisado, clasificacion_costo')
      .eq('workspace_id', workspaceId)
      .gte('fecha', startDate)
      .lte('fecha', endDate)

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
      query = query.eq('id', '00000000-0000-0000-0000-000000000000')
    }
    if (estadoPagoFilter) query = query.eq('estado_pago', estadoPagoFilter)
    if (createdByFilter) query = query.eq('created_by', createdByFilter)
    if (revisadoFiltro === 'pendientes') query = query.eq('revisado', false)
    if (revisadoFiltro === 'revisados') query = query.eq('revisado', true)
    if (clasificacionFiltro) query = query.eq('clasificacion_costo', clasificacionFiltro)

    query = query.order('fecha', { ascending: false })

    const { data: gastos } = await query

    for (const g of gastos ?? []) {
      const proy = g.proyectos as { nombre: string; codigo: string } | null
      const neg = g.negocios as { nombre: string; codigo: string } | null
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
        negocio: neg?.nombre ?? null,
        negocio_codigo: neg?.codigo ?? null,
        deducible: g.deducible ?? false,
        soporte_url: g.soporte_url ?? null,
        tipo_gasto: (g.tipo as Movimiento['tipo_gasto']) ?? null,
        canal_registro: (g.canal_registro as Movimiento['canal_registro']) ?? null,
        created_by_name: profile?.full_name ?? g.created_by_wa_name ?? null,
        created_by_initials: getInitials(profile?.full_name ?? g.created_by_wa_name ?? null),
        estado_pago: (g.estado_pago as 'pagado' | 'pendiente') ?? 'pagado',
        fecha_pago: g.fecha_pago ?? null,
        revisado: g.revisado ?? false,
        clasificacion_costo: (g.clasificacion_costo as Movimiento['clasificacion_costo']) ?? 'variable',
      })
    }
  }

  // ── Ingresos (cobros) ─────────────────────────
  // Cobros no tienen clasificacion_costo (solo gastos), ocultar si filtro activo
  const skipIngresos = !!estadoPagoFilter || !!catFilter || tipoProyFilter === 'empresa' || !!clasificacionFiltro
  if ((tipoFilter === 'todos' || tipoFilter === 'ingresos') && !skipIngresos) {
    let query = supabase
      .from('cobros')
      .select('id, fecha, monto, notas, created_by_wa_name, proyecto_id, proyectos(nombre, codigo), negocio_id, negocios(nombre, codigo), created_by, created_by_profile:profiles!cobros_created_by_profiles_fkey(full_name), revisado')
      .eq('workspace_id', workspaceId)
      .gte('fecha', startDate)
      .lte('fecha', endDate)

    if (proyFilter && proyFilter !== 'empresa') {
      query = query.eq('proyecto_id', proyFilter)
    }
    if (proyectoIdsByTipo && proyectoIdsByTipo.length > 0) {
      query = query.in('proyecto_id', proyectoIdsByTipo)
    } else if (proyectoIdsByTipo && proyectoIdsByTipo.length === 0) {
      query = query.eq('id', '00000000-0000-0000-0000-000000000000')
    }
    if (createdByFilter) query = query.eq('created_by', createdByFilter)
    if (revisadoFiltro === 'pendientes') query = query.eq('revisado', false)
    if (revisadoFiltro === 'revisados') query = query.eq('revisado', true)

    query = query.order('fecha', { ascending: false })

    const { data: cobros } = await query

    for (const c of cobros ?? []) {
      const proy = c.proyectos as { nombre: string; codigo: string } | null
      const neg = c.negocios as { nombre: string; codigo: string } | null
      const profile = c.created_by_profile as { full_name: string } | null
      results.push({
        id: c.id,
        tipo: 'ingreso',
        tabla: 'cobros',
        fecha: c.fecha ?? '',
        monto: Number(c.monto),
        descripcion: c.notas ?? 'Cobro',
        categoria: null,
        proyecto: proy?.nombre ?? null,
        proyecto_codigo: proy?.codigo ?? null,
        negocio: neg?.nombre ?? null,
        negocio_codigo: neg?.codigo ?? null,
        deducible: false,
        soporte_url: null,
        tipo_gasto: null,
        canal_registro: null,
        created_by_name: profile?.full_name ?? c.created_by_wa_name ?? null,
        created_by_initials: getInitials(profile?.full_name ?? c.created_by_wa_name ?? null),
        estado_pago: null,
        fecha_pago: null,
        revisado: c.revisado ?? false,
        clasificacion_costo: null,
      })
    }
  }

  results.sort((a, b) => b.fecha.localeCompare(a.fecha))

  const ingresos = results.filter(m => m.tipo === 'ingreso').reduce((s, m) => s + m.monto, 0)
  const egresos = results.filter(m => m.tipo === 'egreso').reduce((s, m) => s + m.monto, 0)
  const deducible = results
    .filter(m => m.tipo === 'egreso' && m.deducible)
    .reduce((s, m) => s + m.monto, 0)

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

// ── Attach soporte to existing gasto ────────────────────────

export async function attachSoporte(gastoId: string, formData: FormData) {
  const { workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const file = formData.get('file') as File | null
  if (!file || file.size === 0) return { success: false, error: 'Sin archivo' }

  const MAX_SIZE = 5 * 1024 * 1024
  if (file.size > MAX_SIZE) return { success: false, error: 'El archivo supera 5MB' }

  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
  if (!allowed.includes(file.type)) return { success: false, error: 'Solo JPEG, PNG, WebP o PDF' }

  const ext = file.name.split('.').pop() || 'jpg'
  const filePath = `${workspaceId}/${crypto.randomUUID()}.${ext}`

  const admin = createServiceClient()

  const { error: uploadError } = await admin.storage
    .from('gastos-soportes')
    .upload(filePath, file, { contentType: file.type, upsert: true })

  if (uploadError) return { success: false, error: uploadError.message }

  const { data: { publicUrl } } = admin.storage
    .from('gastos-soportes')
    .getPublicUrl(filePath)

  const { error: updateError } = await admin
    .from('gastos')
    .update({ soporte_url: publicUrl, soporte_pendiente: false })
    .eq('id', gastoId)
    .eq('workspace_id', workspaceId)

  if (updateError) return { success: false, error: updateError.message }

  revalidatePath('/movimientos')
  revalidatePath('/revision')
  return { success: true, error: null }
}
