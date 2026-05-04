'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'

export interface CrearPlanInput {
  negocioId: string
  negocioBloqueId: string
  monto: number
  frecuencia: 'mensual' | 'trimestral' | 'anual'
  fechaInicio: string  // YYYY-MM-DD
  totalCuotas: number
  pasarela: 'wompi' | 'manual' | 'mixto'
  autoRenovar?: boolean
  notas?: string
}

function addMeses(fecha: string, meses: number): string {
  const d = new Date(fecha + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + meses)
  return d.toISOString().split('T')[0]
}

function calcularFechaFin(fechaInicio: string, frecuencia: string, totalCuotas: number): string {
  const offsetMeses = frecuencia === 'trimestral' ? 3 : frecuencia === 'anual' ? 12 : 1
  // ultima cuota = fecha_inicio + (totalCuotas - 1) * offset
  return addMeses(fechaInicio, (totalCuotas - 1) * offsetMeses)
}

export async function crearPlanRecurrente(input: CrearPlanInput): Promise<{ success: boolean; error?: string; planId?: string }> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canRegisterCobro) return { success: false, error: 'Sin permisos para crear plan de cobro' }

  if (input.monto <= 0) return { success: false, error: 'Monto debe ser mayor a 0' }
  if (input.totalCuotas <= 0) return { success: false, error: 'Total cuotas debe ser mayor a 0' }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.fechaInicio)) return { success: false, error: 'Fecha inicio invalida' }

  // Validar negocio
  const { data: negocio } = await supabase
    .from('negocios')
    .select('id, estado, precio_aprobado')
    .eq('id', input.negocioId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!negocio) return { success: false, error: 'Negocio no encontrado' }
  if (negocio.estado !== 'abierto') return { success: false, error: 'Negocio no esta abierto' }

  const fechaFin = calcularFechaFin(input.fechaInicio, input.frecuencia, input.totalCuotas)
  const precioTotal = input.monto * input.totalCuotas

  // 1. Crear plan
  const { data: plan, error: planErr } = await supabase
    .from('planes_cobro')
    .insert({
      workspace_id: workspaceId,
      negocio_id: input.negocioId,
      monto: input.monto,
      frecuencia: input.frecuencia,
      fecha_inicio: input.fechaInicio,
      fecha_fin: fechaFin,
      total_cuotas: input.totalCuotas,
      pasarela: input.pasarela,
      auto_renovar: input.autoRenovar ?? false,
      notas: input.notas?.trim() || null,
      activo: true,
    })
    .select('id')
    .single()

  if (planErr || !plan) return { success: false, error: planErr?.message ?? 'Error creando plan' }

  // 2. Setear precio_aprobado del negocio si no esta definido
  if (!negocio.precio_aprobado || Number(negocio.precio_aprobado) === 0) {
    await supabase
      .from('negocios')
      .update({ precio_aprobado: precioTotal, pausado: true, motivo_pausa: 'plan_recurrente_activo' })
      .eq('id', input.negocioId)
  } else {
    // Solo activar pausado
    await supabase
      .from('negocios')
      .update({ pausado: true, motivo_pausa: 'plan_recurrente_activo' })
      .eq('id', input.negocioId)
  }

  // 3. Marcar bloque completado con data del plan
  await supabase
    .from('negocio_bloques')
    .update({
      estado: 'completo',
      completado_at: new Date().toISOString(),
      data: {
        plan_id: plan.id,
        monto: input.monto,
        frecuencia: input.frecuencia,
        fecha_inicio: input.fechaInicio,
        fecha_fin: fechaFin,
        total_cuotas: input.totalCuotas,
        pasarela: input.pasarela,
        auto_renovar: input.autoRenovar ?? false,
      },
    })
    .eq('id', input.negocioBloqueId)

  revalidatePath(`/negocios/${input.negocioId}`)
  return { success: true, planId: plan.id }
}

export async function confirmarCobroProgramado(cobroId: string, fecha?: string): Promise<{ success: boolean; error?: string }> {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { success: false, error: 'No autenticado' }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canRegisterCobro) return { success: false, error: 'Sin permisos para confirmar cobros' }

  const { data: cobro } = await supabase
    .from('cobros')
    .select('id, tipo_cobro, fecha, plan_cobro_id, negocio_id')
    .eq('id', cobroId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!cobro) return { success: false, error: 'Cobro no encontrado' }
  if (cobro.tipo_cobro !== 'programado') return { success: false, error: 'Solo cobros programados se confirman aqui' }
  if (cobro.fecha) return { success: false, error: 'Cobro ya confirmado' }

  const fechaConfirma = fecha ?? new Date().toISOString().split('T')[0]

  const { error: updErr } = await supabase
    .from('cobros')
    .update({
      fecha: fechaConfirma,
      vencido: false,
    })
    .eq('id', cobroId)

  if (updErr) return { success: false, error: updErr.message }

  // Marcar notificaciones cobro_vencido relacionadas como completadas
  await supabase
    .from('notificaciones')
    .update({ estado: 'completada', updated_at: new Date().toISOString() })
    .eq('entidad_tipo', 'cobro')
    .eq('entidad_id', cobroId)
    .eq('estado', 'pendiente')

  revalidatePath(`/negocios/${cobro.negocio_id}`)
  revalidatePath('/movimientos')
  revalidatePath('/revision')
  return { success: true }
}

export async function cancelarPlan(planId: string): Promise<{ success: boolean; error?: string }> {
  const { supabase, workspaceId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const perms = getRolePermissions(role ?? 'read_only')
  if (!perms.canDeleteRecords) return { success: false, error: 'Sin permisos para cancelar planes' }

  const { data: plan } = await supabase
    .from('planes_cobro')
    .select('id, negocio_id')
    .eq('id', planId)
    .eq('workspace_id', workspaceId)
    .single()

  if (!plan) return { success: false, error: 'Plan no encontrado' }

  await supabase
    .from('planes_cobro')
    .update({ activo: false, updated_at: new Date().toISOString() })
    .eq('id', planId)

  revalidatePath(`/negocios/${plan.negocio_id}`)
  return { success: true }
}
