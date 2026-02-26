'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

// ── D83: Generate draft fixed expenses for current month ──────

export async function generarBorradoresGastosFijos() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const now = new Date()
  const periodoActual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  // Check if borradores already exist for this month
  const { count } = await supabase
    .from('gastos_fijos_borradores')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('periodo', periodoActual)

  if (count && count > 0) {
    return { success: true, message: 'Borradores ya existen para este mes', generated: 0 }
  }

  // Get active gastos fijos config
  const { data: fijos } = await supabase
    .from('gastos_fijos_config')
    .select('id, nombre, monto_referencia, categoria')
    .eq('workspace_id', workspaceId)
    .eq('activo', true)

  if (!fijos || fijos.length === 0) {
    return { success: true, message: 'No hay gastos fijos configurados', generated: 0 }
  }

  // Create borradores
  const borradores = fijos.map(f => ({
    workspace_id: workspaceId,
    gasto_fijo_config_id: f.id,
    periodo: periodoActual,
    nombre: f.nombre,
    monto_esperado: f.monto_referencia,
    categoria: f.categoria,
    confirmado: false,
  }))

  const { error: insertError } = await supabase
    .from('gastos_fijos_borradores')
    .insert(borradores)

  if (insertError) return { success: false, error: insertError.message }

  revalidatePath('/numeros')
  return { success: true, generated: borradores.length }
}

// ── D84: Confirm a draft fixed expense ─────────────────────

export async function confirmarBorradorGastoFijo(borradorId: string, montoAjustado?: number) {
  const { supabase, workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  // Get the borrador
  const { data: borrador } = await supabase
    .from('gastos_fijos_borradores')
    .select('*')
    .eq('id', borradorId)
    .single()

  if (!borrador) return { success: false, error: 'Borrador no encontrado' }

  const montoFinal = montoAjustado ?? borrador.monto_esperado

  // Create actual gasto
  const { data: gasto, error: gastoError } = await supabase
    .from('gastos')
    .insert({
      workspace_id: workspaceId,
      monto: montoFinal,
      categoria: borrador.categoria,
      descripcion: borrador.nombre,
      fecha: new Date().toISOString().split('T')[0],
      tipo: 'fijo',
      estado_pago: 'pagado',
      gasto_fijo_ref_id: borrador.gasto_fijo_config_id,
      created_by: userId,
    })
    .select('id')
    .single()

  if (gastoError) return { success: false, error: gastoError.message }

  // Update borrador status
  await supabase
    .from('gastos_fijos_borradores')
    .update({
      confirmado: true,
      fecha_confirmacion: new Date().toISOString(),
      gasto_id: gasto?.id ?? null,
    })
    .eq('id', borradorId)

  revalidatePath('/numeros')
  revalidatePath('/proyectos')
  return { success: true }
}

// ── D84: Discard a draft fixed expense ─────────────────────

export async function descartarBorradorGastoFijo(borradorId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // Mark as confirmed with NULL gasto_id (discarded)
  await supabase
    .from('gastos_fijos_borradores')
    .update({
      confirmado: true,
      fecha_confirmacion: new Date().toISOString(),
    })
    .eq('id', borradorId)

  revalidatePath('/numeros')
  return { success: true }
}

// ── D84: Match gasto to gasto_fijo_config ─────────────────

export async function matchGastoFijo(gastoId: string, gastoFijoId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const { error: dbError } = await supabase
    .from('gastos')
    .update({
      gasto_fijo_ref_id: gastoFijoId,
      tipo: 'fijo',
    })
    .eq('id', gastoId)

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/numeros')
  return { success: true }
}

// ── D105: Get pending borradores for current month ────────

export async function getBorradoresDelMes() {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const now = new Date()
  const periodoActual = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  const { data } = await supabase
    .from('gastos_fijos_borradores')
    .select('*, gastos_fijos_config(nombre, monto_referencia)')
    .eq('workspace_id', workspaceId)
    .eq('periodo', periodoActual)
    .order('nombre')

  return data ?? []
}

// ── D105: Check if gasto matches a recurring pattern ──────

export async function sugerirGastoFijo(monto: number, descripcion: string, categoria: string | null) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { suggestion: null }

  if (!categoria) return { suggestion: null }

  // Check if there's a similar gasto in the last 2 months with same category
  const twoMonthsAgo = new Date()
  twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2)

  const { data: similares } = await supabase
    .from('gastos')
    .select('monto, descripcion')
    .eq('workspace_id', workspaceId)
    .eq('categoria', categoria)
    .gte('fecha', twoMonthsAgo.toISOString().split('T')[0])
    .is('gasto_fijo_ref_id', null) // not already linked

  if (!similares || similares.length < 2) return { suggestion: null }

  // Check for existing gastos_fijos_config with same category to avoid duplicates
  const { data: existing } = await supabase
    .from('gastos_fijos_config')
    .select('id')
    .eq('workspace_id', workspaceId)
    .eq('categoria', categoria)
    .limit(1)
    .maybeSingle()

  if (existing) return { suggestion: null }

  // Suggest it's a recurring expense
  const avgMonto = similares.reduce((s, g) => s + g.monto, 0) / similares.length
  return {
    suggestion: {
      message: `Parece que "${descripcion}" es un gasto recurrente (~${Math.round(avgMonto).toLocaleString('es-CO')} COP/mes). ¿Quieres registrarlo como gasto fijo?`,
      avgMonto: Math.round(avgMonto),
      descripcion,
      categoria,
    },
  }
}
