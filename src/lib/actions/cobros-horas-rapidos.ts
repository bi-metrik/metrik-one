'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { getRolePermissions } from '@/lib/roles'
import { revalidatePath } from 'next/cache'
import { todayBogotaISO } from '@/lib/dates/bogota'

type ActionResult = { success: true } | { success: false; error: string }

// Add horas — usado desde /nuevo/horas (FAB)
export async function addHoras(proyectoId: string, input: {
  fecha: string
  horas: number
  descripcion?: string
  staff_id?: string
}): Promise<ActionResult> {
  const { supabase, workspaceId, userId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const { data: proyecto } = await supabase
    .from('proyectos')
    .select('estado')
    .eq('id', proyectoId)
    .single()

  if (!proyecto) return { success: false, error: 'Proyecto no encontrado' }
  if (proyecto.estado !== 'en_ejecucion') {
    return { success: false, error: 'Solo se pueden registrar horas en proyectos en ejecución' }
  }

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

  const perms = getRolePermissions(role ?? 'read_only')
  const autoApprove = perms.canMarcarRevisado

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

  revalidatePath('/equipo')
  return { success: true }
}

// Add cobro — usado desde /nuevo/cobro (FAB)
export async function addCobro(facturaId: string, input: {
  monto: number
  fecha?: string
  notas?: string
  retencion?: number
}): Promise<ActionResult> {
  const { supabase, workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const { data: factura } = await supabase
    .from('facturas')
    .select('id, proyecto_id, monto')
    .eq('id', facturaId)
    .single()

  if (!factura) return { success: false, error: 'Factura no encontrada' }

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
      retencion: input.retencion ?? 0,
      fecha: input.fecha || todayBogotaISO(),
      notas: input.notas?.trim() || null,
      created_by: userId,
    })

  if (dbError) return { success: false, error: dbError.message }

  return { success: true }
}
