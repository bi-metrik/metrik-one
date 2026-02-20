'use server'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { revalidatePath } from 'next/cache'

export async function createGasto(formData: FormData) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const monto = parseFloat(formData.get('monto') as string)
  if (!monto || monto <= 0) return { success: false, error: 'Monto invalido' }

  const { error: dbError } = await supabase
    .from('gastos')
    .insert({
      workspace_id: workspaceId,
      fecha: (formData.get('fecha') as string) || new Date().toISOString().split('T')[0],
      monto,
      categoria: (formData.get('categoria') as string) || 'otros',
      descripcion: (formData.get('descripcion') as string)?.trim() || null,
      deducible: formData.get('deducible') === 'true',
      canal_registro: 'web',
    })

  if (dbError) return { success: false, error: dbError.message }

  revalidatePath('/numeros')
  return { success: true }
}
