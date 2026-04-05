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
  const consecutivo = consecutivoRaw ?? `COT-${new Date().getFullYear()}-0000`

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

  revalidatePath(`/negocios/${negocioId}`)
  return { success: true as const, id: (data as { id: string }).id }
}
