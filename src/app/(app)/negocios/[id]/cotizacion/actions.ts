'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

export async function getCotizacionesNegocio(negocioId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return []

  const { data } = await supabase
    .from('cotizaciones')
    .select('id, consecutivo, modo, estado, valor_total, descripcion, created_at')
    .eq('negocio_id' as never, negocioId)
    .order('created_at', { ascending: false })

  return data ?? []
}

export async function createCotizacionFlashNegocio(
  negocioId: string,
  descripcion: string,
  valorTotal: number
) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false as const, error: 'No autenticado' }

  const { data: consecutivoRaw } = await supabase.rpc('get_next_cotizacion_consecutivo', {
    p_workspace_id: workspaceId,
  })
  const consecutivo = consecutivoRaw ?? `COT-${new Date().getFullYear()}-0000`

  const { data, error: dbError } = await supabase
    .from('cotizaciones')
    .insert({
      workspace_id: workspaceId,
      negocio_id: negocioId,
      consecutivo,
      codigo: '',
      modo: 'flash',
      descripcion: descripcion.trim(),
      valor_total: valorTotal,
      estado: 'borrador',
    } as never)
    .select('id')
    .single()

  if (dbError) return { success: false as const, error: dbError.message }

  revalidatePath(`/negocios/${negocioId}`)
  return { success: true as const, id: (data as { id: string }).id }
}

export async function createCotizacionDetalladaNegocio(negocioId: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false as const, error: 'No autenticado' }

  const { data: consecutivoRaw } = await supabase.rpc('get_next_cotizacion_consecutivo', {
    p_workspace_id: workspaceId,
  })
  // Fallback con epoch para garantizar unicidad si el RPC falla
  const consecutivo = consecutivoRaw ?? `COT-${new Date().getFullYear()}-${Date.now()}`

  const { data, error: dbError } = await supabase
    .from('cotizaciones')
    .insert({
      workspace_id: workspaceId,
      negocio_id: negocioId,
      consecutivo,
      codigo: '',
      modo: 'detallada',
      valor_total: 0,
      estado: 'borrador',
    } as never)
    .select('id')
    .single()

  if (dbError) return { success: false as const, error: dbError.message }
  if (!data) return { success: false as const, error: 'Error al crear cotización — intenta de nuevo' }

  revalidatePath(`/negocios/${negocioId}`)
  return { success: true as const, id: (data as { id: string }).id }
}

export async function aceptarCotizacionNegocio(cotizacionId: string, negocioId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false as const, error: 'No autenticado' }

  // Obtener valor_total de la cotización
  const { data: cot, error: cotErr } = await supabase
    .from('cotizaciones')
    .select('valor_total')
    .eq('id', cotizacionId)
    .single()

  if (cotErr || !cot) return { success: false as const, error: 'Cotización no encontrada' }

  // Marcar cotización como aceptada (salto directo borrador→aceptada)
  const { error: updErr } = await supabase
    .from('cotizaciones')
    .update({ estado: 'aceptada', updated_at: new Date().toISOString() } as never)
    .eq('id', cotizacionId)

  if (updErr) return { success: false as const, error: updErr.message }

  // Actualizar precio_aprobado en negocio
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: negErr } = await (supabase as any)
    .from('negocios')
    .update({ precio_aprobado: (cot as { valor_total: number | null }).valor_total })
    .eq('id', negocioId)

  if (negErr) return { success: false as const, error: negErr.message }

  // Marcar TODOS los negocio_bloques de cotización como completo (todas las etapas)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: bloqueInstances } = await (supabase as any)
    .from('negocio_bloques')
    .select('id, bloque_configs!inner(bloque_definitions!inner(tipo))')
    .eq('negocio_id', negocioId)

  const cotBloqueIds = (bloqueInstances ?? [])
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .filter((b: any) => b.bloque_configs?.bloque_definitions?.tipo === 'cotizacion')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .map((b: any) => b.id as string)

  if (cotBloqueIds.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (supabase as any)
      .from('negocio_bloques')
      .update({
        estado: 'completo',
        completado_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .in('id', cotBloqueIds)
  }

  revalidatePath(`/negocios/${negocioId}`)
  return { success: true as const }
}

export async function rechazarCotizacionNegocio(cotizacionId: string, negocioId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false as const, error: 'No autenticado' }

  const { error: updErr } = await supabase
    .from('cotizaciones')
    .update({ estado: 'rechazada' } as never)
    .eq('id', cotizacionId)

  if (updErr) return { success: false as const, error: updErr.message }

  revalidatePath(`/negocios/${negocioId}`)
  return { success: true as const }
}
