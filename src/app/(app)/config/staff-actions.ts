'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getStaff() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return []

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()
  if (!profile) return []

  const { data } = await supabase
    .from('staff')
    .select('*')
    .eq('workspace_id', profile.workspace_id)
    .order('full_name')

  return data || []
}

export async function createStaffMember(formData: {
  full_name: string
  position?: string
  department?: string
  contract_type?: string
  salary?: number
  phone_whatsapp?: string
  horas_disponibles_mes?: number
  tipo_vinculo?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()
  if (!profile) return { error: 'Sin perfil' }

  // Solo owner/admin puede gestionar personal
  if (!['owner', 'admin'].includes(profile.role)) {
    return { error: 'Sin permisos para gestionar personal' }
  }

  const { error } = await supabase.from('staff').insert({
    workspace_id: profile.workspace_id,
    full_name: formData.full_name,
    position: formData.position || null,
    department: formData.department || null,
    contract_type: formData.contract_type || 'fijo',
    salary: formData.salary || 0,
    phone_whatsapp: formData.phone_whatsapp || null,
    horas_disponibles_mes: formData.horas_disponibles_mes ?? 160,
    tipo_vinculo: formData.tipo_vinculo || null,
  })

  if (error) return { error: error.message }
  revalidatePath('/config')
  revalidatePath('/mi-negocio')
  return { success: true }
}

export async function updateStaffMember(
  id: string,
  formData: {
    full_name?: string
    position?: string | null
    department?: string | null
    contract_type?: string
    salary?: number
    phone_whatsapp?: string | null
    is_active?: boolean
    horas_disponibles_mes?: number
    tipo_vinculo?: string | null
  }
) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()
  if (!profile) return { error: 'Sin perfil' }

  if (!['owner', 'admin'].includes(profile.role)) {
    return { error: 'Sin permisos para gestionar personal' }
  }

  const { error } = await supabase
    .from('staff')
    .update(formData)
    .eq('id', id)
    .eq('workspace_id', profile.workspace_id)

  if (error) return { error: error.message }
  revalidatePath('/config')
  revalidatePath('/mi-negocio')
  return { success: true }
}

export async function deleteStaffMember(id: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()
  if (!profile) return { error: 'Sin perfil' }

  if (!['owner', 'admin'].includes(profile.role)) {
    return { error: 'Sin permisos para gestionar personal' }
  }

  const { error } = await supabase
    .from('staff')
    .delete()
    .eq('id', id)
    .eq('workspace_id', profile.workspace_id)

  if (error) return { error: error.message }
  revalidatePath('/config')
  revalidatePath('/mi-negocio')
  return { success: true }
}
