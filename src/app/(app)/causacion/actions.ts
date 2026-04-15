'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'

// ── Types ────────────────────────────────────────────────

export type Retencion = {
  tipo: 'iva' | 'reteiva' | 'retefuente' | 'reteica'
  valor: number
}

export type ItemCausacion = {
  id: string
  tipo: 'ingreso' | 'egreso'
  tabla: 'gastos' | 'cobros'
  fecha: string
  monto: number
  descripcion: string
  categoria: string | null
  proyecto: string | null
  created_by_name: string | null
  fecha_aprobacion: string | null
  // Campos contables (filled by contador at causación)
  cuenta_contable: string | null
  centro_costo: string | null
  notas_causacion: string | null
  retencion_aplicada: number | null
  fecha_causacion: string | null
  // Deducibilidad fiscal (solo gastos)
  deducible: boolean | null
  // Retenciones fiscales detalladas
  retenciones: Retencion[]
  tercero_nit: string | null
  tercero_razon_social: string | null
}

function getInitials(name: string | null): string | null {
  if (!name) return null
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  return parts[0].substring(0, 2).toUpperCase()
}

// ── getCausacionData ─────────────────────────────────────

export async function getCausacionData(tab: 'aprobados' | 'causados', mes?: string) {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { items: [], counts: { aprobados: 0, causados: 0 }, totales: { egresos: 0, ingresos: 0, ivaNeto: 0, retencionesAFavor: 0, retencionesPorPagar: 0 } }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canViewCausacion) return { items: [], counts: { aprobados: 0, causados: 0 }, totales: { egresos: 0, ingresos: 0, ivaNeto: 0, retencionesAFavor: 0, retencionesPorPagar: 0 } }

  const currentMes = mes ?? new Date().toISOString().slice(0, 7)
  const [y, m] = currentMes.split('-').map(Number)
  const startDate = `${currentMes}-01`
  const endDate = new Date(y, m, 0).toISOString().split('T')[0]

  const items: ItemCausacion[] = []

  // ── Gastos ──────────────────────────────────────────
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('gastos')
      .select('id, fecha, monto, descripcion, mensaje_original, categoria, proyecto_id, proyectos(nombre), created_by_wa_name, created_by_profile:profiles!gastos_created_by_profiles_fkey(full_name), estado_causacion, fecha_aprobacion, cuenta_contable, centro_costo, notas_causacion, retencion_aplicada, fecha_causacion, deducible, retenciones, tercero_nit, tercero_razon_social')
      .eq('workspace_id', workspaceId)

    if (tab === 'aprobados') {
      query = query.eq('estado_causacion', 'APROBADO')
    } else {
      query = query
        .eq('estado_causacion', 'CAUSADO')
        .gte('fecha_causacion', `${startDate}T00:00:00`)
        .lte('fecha_causacion', `${endDate}T23:59:59`)
    }

    query = query.order('fecha', { ascending: false })

    const { data: gastos } = await query

    for (const g of gastos ?? []) {
      const proy = g.proyectos as { nombre: string } | null
      const profile = g.created_by_profile as { full_name: string } | null
      items.push({
        id: g.id,
        tipo: 'egreso',
        tabla: 'gastos',
        fecha: g.fecha,
        monto: Number(g.monto),
        descripcion: g.descripcion || g.categoria || 'Gasto',
        categoria: g.categoria,
        proyecto: proy?.nombre ?? null,
        created_by_name: profile?.full_name ?? (g as any).created_by_wa_name ?? null,
        fecha_aprobacion: g.fecha_aprobacion ?? null,
        cuenta_contable: g.cuenta_contable ?? null,
        centro_costo: g.centro_costo ?? null,
        notas_causacion: g.notas_causacion ?? null,
        retencion_aplicada: g.retencion_aplicada ? Number(g.retencion_aplicada) : null,
        fecha_causacion: g.fecha_causacion ?? null,
        deducible: g.deducible ?? null,
        retenciones: ((g as any).retenciones as Retencion[]) ?? [],
        tercero_nit: (g as any).tercero_nit ?? null,
        tercero_razon_social: (g as any).tercero_razon_social ?? null,
      })
    }
  }

  // ── Cobros ──────────────────────────────────────────
  {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let query = (supabase as any)
      .from('cobros')
      .select('id, fecha, monto, notas, proyecto_id, proyectos(nombre), created_by_profile:profiles!cobros_created_by_profiles_fkey(full_name), estado_causacion, fecha_aprobacion, cuenta_contable, centro_costo, notas_causacion, retencion_aplicada, fecha_causacion, retenciones, tercero_nit, tercero_razon_social, negocio_id, negocios(empresa_id, empresas(numero_documento, razon_social))')
      .eq('workspace_id', workspaceId)

    if (tab === 'aprobados') {
      query = query.eq('estado_causacion', 'APROBADO')
    } else {
      query = query
        .eq('estado_causacion', 'CAUSADO')
        .gte('fecha_causacion', `${startDate}T00:00:00`)
        .lte('fecha_causacion', `${endDate}T23:59:59`)
    }

    query = query.order('fecha', { ascending: false })

    const { data: cobros } = await query

    for (const c of cobros ?? []) {
      const proy = c.proyectos as { nombre: string } | null
      const profile = c.created_by_profile as { full_name: string } | null
      const negocio = (c as any).negocios as { empresa_id: string; empresas: { numero_documento: string | null; razon_social: string | null } | null } | null
      const empresa = negocio?.empresas ?? null
      items.push({
        id: c.id,
        tipo: 'ingreso',
        tabla: 'cobros',
        fecha: c.fecha,
        monto: Number(c.monto),
        descripcion: c.notas ?? 'Cobro',
        categoria: null,
        proyecto: proy?.nombre ?? null,
        created_by_name: profile?.full_name ?? null,
        fecha_aprobacion: c.fecha_aprobacion ?? null,
        cuenta_contable: c.cuenta_contable ?? null,
        centro_costo: c.centro_costo ?? null,
        notas_causacion: c.notas_causacion ?? null,
        retencion_aplicada: c.retencion_aplicada ? Number(c.retencion_aplicada) : null,
        fecha_causacion: c.fecha_causacion ?? null,
        deducible: null,
        retenciones: ((c as any).retenciones as Retencion[]) ?? [],
        tercero_nit: (c as any).tercero_nit ?? empresa?.numero_documento ?? null,
        tercero_razon_social: (c as any).tercero_razon_social ?? empresa?.razon_social ?? null,
      })
    }
  }

  // Sort by fecha desc
  items.sort((a, b) => b.fecha.localeCompare(a.fecha))

  // Totales del mes (solo relevante para tab causados, pero se calcula siempre)
  const egresos = items.filter(i => i.tipo === 'egreso').reduce((s, i) => s + i.monto, 0)
  const ingresos = items.filter(i => i.tipo === 'ingreso').reduce((s, i) => s + i.monto, 0)

  let ivaGenerado = 0      // cobros → debes a DIAN
  let ivaDescontable = 0   // gastos → a tu favor
  let retencionesAFavor = 0   // retefuente + reteiva + reteica en cobros
  let retencionesPorPagar = 0  // retefuente + reteiva + reteica en gastos

  for (const item of items) {
    for (const ret of item.retenciones) {
      if (ret.tipo === 'iva') {
        if (item.tipo === 'ingreso') ivaGenerado += ret.valor
        else ivaDescontable += ret.valor
      } else {
        // retefuente, reteiva, reteica
        if (item.tipo === 'ingreso') retencionesAFavor += ret.valor
        else retencionesPorPagar += ret.valor
      }
    }
  }

  const ivaNeto = ivaGenerado - ivaDescontable

  // Counts for tab badges
  const { count: aprobadosGastos } = await supabase
    .from('gastos')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('estado_causacion', 'APROBADO')

  const { count: aprobadosCobros } = await supabase
    .from('cobros')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('estado_causacion', 'APROBADO')

  // Causados this month
  const { count: causadosGastos } = await supabase
    .from('gastos')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('estado_causacion', 'CAUSADO')
    .gte('fecha_causacion', `${startDate}T00:00:00`)
    .lte('fecha_causacion', `${endDate}T23:59:59`)

  const { count: causadosCobros } = await supabase
    .from('cobros')
    .select('id', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('estado_causacion', 'CAUSADO')
    .gte('fecha_causacion', `${startDate}T00:00:00`)
    .lte('fecha_causacion', `${endDate}T23:59:59`)

  return {
    items,
    counts: {
      aprobados: (aprobadosGastos ?? 0) + (aprobadosCobros ?? 0),
      causados: (causadosGastos ?? 0) + (causadosCobros ?? 0),
    },
    totales: {
      egresos,
      ingresos,
      ivaNeto,          // positivo = por pagar, negativo = a favor
      retencionesAFavor,
      retencionesPorPagar,
    },
  }
}

// ── causarMovimiento ─────────────────────────────────────

export async function causarMovimiento(input: {
  tabla: 'gastos' | 'cobros'
  registroId: string
  cuenta_contable?: string
  centro_costo?: string
  notas_causacion?: string
  retencion_aplicada?: number
  retenciones?: Retencion[]
  tercero_nit?: string
  tercero_razon_social?: string
}) {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { success: false, error: 'No autenticado' }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canCausar) return { success: false, error: 'Sin permisos para causar' }

  // Validate record belongs to workspace and is APROBADO
  let estadoCausacion: string | null = null
  let registroMonto: number | null = null

  if (input.tabla === 'gastos') {
    const { data } = await supabase
      .from('gastos')
      .select('id, estado_causacion, monto')
      .eq('id', input.registroId)
      .eq('workspace_id', workspaceId)
      .single()
    if (!data) return { success: false, error: 'Registro no encontrado' }
    estadoCausacion = data.estado_causacion
    registroMonto = Number(data.monto)
  } else {
    const { data } = await supabase
      .from('cobros')
      .select('id, estado_causacion, monto')
      .eq('id', input.registroId)
      .eq('workspace_id', workspaceId)
      .single()
    if (!data) return { success: false, error: 'Registro no encontrado' }
    estadoCausacion = data.estado_causacion
    registroMonto = Number(data.monto)
  }

  if (estadoCausacion !== 'APROBADO') return { success: false, error: 'Solo se pueden causar movimientos APROBADOS' }

  const updatePayload = {
    estado_causacion: 'CAUSADO' as const,
    causado_por: userId,
    fecha_causacion: new Date().toISOString(),
    cuenta_contable: input.cuenta_contable?.trim() || null,
    centro_costo: input.centro_costo?.trim() || null,
    notas_causacion: input.notas_causacion?.trim() || null,
    retencion_aplicada: input.retencion_aplicada ?? null,
    retenciones: input.retenciones ?? [],
    tercero_nit: input.tercero_nit?.trim() || null,
    tercero_razon_social: input.tercero_razon_social?.trim() || null,
  }

  const { error: updateError } = input.tabla === 'gastos'
    ? await supabase.from('gastos').update(updatePayload as any).eq('id', input.registroId)
    : await supabase.from('cobros').update(updatePayload as any).eq('id', input.registroId)

  if (updateError) return { success: false, error: updateError.message }

  // Log to causaciones_log with snapshot
  await supabase.from('causaciones_log').insert({
    workspace_id: workspaceId,
    tabla: input.tabla,
    registro_id: input.registroId,
    accion: 'CAUSAR',
    estado_anterior: 'APROBADO',
    estado_nuevo: 'CAUSADO',
    datos: {
      cuenta_contable: input.cuenta_contable?.trim() || null,
      centro_costo: input.centro_costo?.trim() || null,
      notas_causacion: input.notas_causacion?.trim() || null,
      retencion_aplicada: input.retencion_aplicada ?? null,
      retenciones: input.retenciones ?? [],
      tercero_nit: input.tercero_nit?.trim() || null,
      tercero_razon_social: input.tercero_razon_social?.trim() || null,
      monto: registroMonto,
    },
    realizado_por: userId,
  })

  revalidatePath('/causacion')
  revalidatePath('/movimientos')
  return { success: true }
}

// ── toggleDeducible ───────────────────────────────────────

export async function toggleDeducible(gastoId: string, deducible: boolean) {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canToggleDeducible) return { success: false, error: 'Sin permisos para modificar deducibilidad' }

  // Validate gasto belongs to workspace
  const { data: gasto } = await supabase
    .from('gastos')
    .select('id, estado_causacion')
    .eq('id', gastoId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!gasto) return { success: false, error: 'Gasto no encontrado' }
  if (gasto.estado_causacion !== 'APROBADO' && gasto.estado_causacion !== 'CAUSADO') {
    return { success: false, error: 'Solo se puede modificar deducibilidad en gastos APROBADOS o CAUSADOS' }
  }

  const { error: updateError } = await supabase
    .from('gastos')
    .update({ deducible })
    .eq('id', gastoId)

  if (updateError) return { success: false, error: updateError.message }

  revalidatePath('/causacion')
  revalidatePath('/movimientos')
  return { success: true }
}
