'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

export async function getMonthlyTargets(year: number) {
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
    .from('monthly_targets')
    .select('*')
    .eq('workspace_id', profile.workspace_id)
    .eq('year', year)
    .order('month')

  return data || []
}

export async function upsertMonthlyTarget(formData: {
  year: number
  month: number
  sales_target: number
  collection_target: number
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
    return { error: 'Sin permisos para configurar metas' }
  }

  // Check if exists
  const { data: existing } = await supabase
    .from('monthly_targets')
    .select('id')
    .eq('workspace_id', profile.workspace_id)
    .eq('year', formData.year)
    .eq('month', formData.month)
    .maybeSingle()

  if (existing) {
    const { error } = await supabase
      .from('monthly_targets')
      .update({
        sales_target: formData.sales_target,
        collection_target: formData.collection_target,
      })
      .eq('id', existing.id)

    if (error) return { error: error.message }
  } else {
    const { error } = await supabase.from('monthly_targets').insert({
      workspace_id: profile.workspace_id,
      year: formData.year,
      month: formData.month,
      sales_target: formData.sales_target,
      collection_target: formData.collection_target,
    })

    if (error) return { error: error.message }
  }

  revalidatePath('/config')
  return { success: true }
}

export async function bulkUpsertMonthlyTargets(
  year: number,
  targets: { month: number; sales_target: number; collection_target: number }[]
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
    return { error: 'Sin permisos para configurar metas' }
  }

  // Upsert all 12 months
  for (const t of targets) {
    const { data: existing } = await supabase
      .from('monthly_targets')
      .select('id')
      .eq('workspace_id', profile.workspace_id)
      .eq('year', year)
      .eq('month', t.month)
      .maybeSingle()

    if (existing) {
      await supabase
        .from('monthly_targets')
        .update({
          sales_target: t.sales_target,
          collection_target: t.collection_target,
        })
        .eq('id', existing.id)
    } else {
      await supabase.from('monthly_targets').insert({
        workspace_id: profile.workspace_id,
        year,
        month: t.month,
        sales_target: t.sales_target,
        collection_target: t.collection_target,
      })
    }
  }

  revalidatePath('/config')
  return { success: true }
}
