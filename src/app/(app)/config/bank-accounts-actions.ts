'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getBankAccounts() {
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
    .from('bank_accounts')
    .select('*')
    .eq('workspace_id', profile.workspace_id)
    .order('created_at')

  return data || []
}

export async function createBankAccount(formData: {
  bank_name: string
  account_name?: string
  account_type?: string
  is_primary?: boolean
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

  if (!['owner', 'admin'].includes(profile.role)) {
    return { error: 'Sin permisos' }
  }

  // Si es primary, quitar primary de las demás
  if (formData.is_primary) {
    await supabase
      .from('bank_accounts')
      .update({ is_primary: false })
      .eq('workspace_id', profile.workspace_id)
  }

  const { error } = await supabase.from('bank_accounts').insert({
    workspace_id: profile.workspace_id,
    bank_name: formData.bank_name,
    account_name: formData.account_name || 'Principal',
    account_type: formData.account_type || 'ahorros',
    is_primary: formData.is_primary || false,
  })

  if (error) return { error: error.message }
  revalidatePath('/config')
  revalidatePath('/mi-negocio')
  return { success: true }
}

export async function updateBankAccount(
  id: string,
  formData: {
    bank_name?: string
    account_name?: string
    account_type?: string
    is_primary?: boolean
    is_active?: boolean
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
    return { error: 'Sin permisos' }
  }

  // Si se marca como primary, quitar primary de las demás
  if (formData.is_primary) {
    await supabase
      .from('bank_accounts')
      .update({ is_primary: false })
      .eq('workspace_id', profile.workspace_id)
      .neq('id', id)
  }

  const { error } = await supabase
    .from('bank_accounts')
    .update(formData)
    .eq('id', id)
    .eq('workspace_id', profile.workspace_id)

  if (error) return { error: error.message }
  revalidatePath('/config')
  revalidatePath('/mi-negocio')
  return { success: true }
}

export async function deleteBankAccount(id: string) {
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
    return { error: 'Sin permisos' }
  }

  const { error } = await supabase
    .from('bank_accounts')
    .delete()
    .eq('id', id)
    .eq('workspace_id', profile.workspace_id)

  if (error) return { error: error.message }
  revalidatePath('/config')
  revalidatePath('/mi-negocio')
  return { success: true }
}

// ── Bank Balances ──────────────────────────────

export async function recordBalance(formData: {
  account_id: string
  balance: number
  notes?: string
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()
  if (!profile) return { error: 'Sin perfil' }

  const { error } = await supabase.from('bank_balances').insert({
    workspace_id: profile.workspace_id,
    account_id: formData.account_id,
    balance: formData.balance,
    notes: formData.notes || null,
  })

  if (error) return { error: error.message }
  revalidatePath('/config')
  revalidatePath('/mi-negocio')
  return { success: true }
}

export async function getRecentBalances(accountId: string) {
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
    .from('bank_balances')
    .select('*')
    .eq('workspace_id', profile.workspace_id)
    .eq('account_id', accountId)
    .order('recorded_at', { ascending: false })
    .limit(10)

  return data || []
}
