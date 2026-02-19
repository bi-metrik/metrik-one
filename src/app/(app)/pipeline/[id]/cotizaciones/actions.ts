'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

async function getWorkspace() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, role')
    .eq('id', user.id)
    .single()

  if (!profile) return null
  return { supabase, workspaceId: profile.workspace_id, role: profile.role, userId: user.id }
}

export async function getQuotesForOpportunity(opportunityId: string) {
  const ctx = await getWorkspace()
  if (!ctx) return []

  const { data } = await ctx.supabase
    .from('quotes')
    .select('*')
    .eq('opportunity_id', opportunityId)
    .eq('workspace_id', ctx.workspaceId)
    .order('created_at', { ascending: false })

  return data || []
}

export async function createQuote(opportunityId: string, formData: {
  description?: string
  total_price: number
  estimated_cost?: number
  mode?: string
  valid_days?: number
  client_id?: string
}) {
  const ctx = await getWorkspace()
  if (!ctx) return { error: 'No autenticado' }

  const validDays = formData.valid_days || 15
  const validUntil = new Date()
  validUntil.setDate(validUntil.getDate() + validDays)

  const { data, error } = await ctx.supabase
    .from('quotes')
    .insert({
      workspace_id: ctx.workspaceId,
      opportunity_id: opportunityId,
      client_id: formData.client_id || null,
      mode: formData.mode || 'quick',
      description: formData.description || null,
      total_price: formData.total_price,
      estimated_cost: formData.estimated_cost || null,
      status: 'borrador',
      valid_days: validDays,
      valid_until: validUntil.toISOString().split('T')[0],
    })
    .select('*')
    .single()

  if (error) return { error: error.message }
  revalidatePath(`/pipeline/${opportunityId}`)
  return { success: true, quote: data }
}

export async function sendQuote(quoteId: string, opportunityId: string) {
  const ctx = await getWorkspace()
  if (!ctx) return { error: 'No autenticado' }

  // Validate: no other "enviada" quote in this opportunity
  const { data: others } = await ctx.supabase
    .from('quotes')
    .select('id, status')
    .eq('opportunity_id', opportunityId)
    .eq('workspace_id', ctx.workspaceId)
    .eq('status', 'enviada')
    .neq('id', quoteId)

  if (others && others.length > 0) {
    return { error: 'Ya hay una cotización enviada en esta oportunidad.' }
  }

  const { error } = await ctx.supabase
    .from('quotes')
    .update({ status: 'enviada', sent_at: new Date().toISOString() })
    .eq('id', quoteId)
    .eq('workspace_id', ctx.workspaceId)

  if (error) return { error: error.message }
  revalidatePath(`/pipeline/${opportunityId}`)
  return { success: true }
}

export async function acceptQuote(quoteId: string, opportunityId: string) {
  const ctx = await getWorkspace()
  if (!ctx) return { error: 'No autenticado' }

  // Get quote details
  const { data: quote } = await ctx.supabase
    .from('quotes')
    .select('*, opportunities(name, client_id)')
    .eq('id', quoteId)
    .eq('workspace_id', ctx.workspaceId)
    .single()

  if (!quote) return { error: 'Cotización no encontrada' }
  if (quote.status !== 'enviada') return { error: 'Solo se puede aceptar una cotización enviada' }

  // 1. Mark quote as accepted
  await ctx.supabase
    .from('quotes')
    .update({ status: 'aceptada', accepted_at: new Date().toISOString() })
    .eq('id', quoteId)

  // 2. Update opportunity to won
  await ctx.supabase
    .from('opportunities')
    .update({
      stage: 'won',
      probability: 100,
    })
    .eq('id', opportunityId)
    .eq('workspace_id', ctx.workspaceId)

  // 3. Create project from quote
  const oppData = Array.isArray(quote.opportunities) ? quote.opportunities[0] : quote.opportunities
  const { data: project } = await ctx.supabase
    .from('projects')
    .insert({
      workspace_id: ctx.workspaceId,
      name: oppData?.name || 'Nuevo proyecto',
      client_id: quote.client_id || oppData?.client_id || null,
      opportunity_id: opportunityId,
      quote_id: quoteId,
      approved_budget: quote.total_price,
      status: 'active',
      start_date: new Date().toISOString().split('T')[0],
    })
    .select('id')
    .single()

  // 4. Link project back to quote
  if (project) {
    await ctx.supabase
      .from('quotes')
      .update({ project_id: project.id })
      .eq('id', quoteId)
  }

  revalidatePath(`/pipeline/${opportunityId}`)
  revalidatePath('/pipeline')
  revalidatePath('/proyectos')
  return { success: true, projectId: project?.id }
}

export async function rejectQuote(quoteId: string, opportunityId: string, reason?: string) {
  const ctx = await getWorkspace()
  if (!ctx) return { error: 'No autenticado' }

  const { error } = await ctx.supabase
    .from('quotes')
    .update({
      status: 'rechazada',
      rejected_reason: reason || null,
    })
    .eq('id', quoteId)
    .eq('workspace_id', ctx.workspaceId)

  if (error) return { error: error.message }
  revalidatePath(`/pipeline/${opportunityId}`)
  return { success: true }
}

export async function reopenQuote(quoteId: string, opportunityId: string) {
  const ctx = await getWorkspace()
  if (!ctx) return { error: 'No autenticado' }

  // Check no other enviada
  const { data: others } = await ctx.supabase
    .from('quotes')
    .select('id')
    .eq('opportunity_id', opportunityId)
    .eq('workspace_id', ctx.workspaceId)
    .eq('status', 'enviada')

  if (others && others.length > 0) {
    return { error: 'Ya hay una cotización enviada. Resuélvela primero.' }
  }

  const { error } = await ctx.supabase
    .from('quotes')
    .update({ status: 'enviada', rejected_reason: null })
    .eq('id', quoteId)
    .eq('workspace_id', ctx.workspaceId)

  if (error) return { error: error.message }
  revalidatePath(`/pipeline/${opportunityId}`)
  return { success: true }
}

export async function duplicateQuote(quoteId: string, opportunityId: string) {
  const ctx = await getWorkspace()
  if (!ctx) return { error: 'No autenticado' }

  const { data: original } = await ctx.supabase
    .from('quotes')
    .select('*')
    .eq('id', quoteId)
    .eq('workspace_id', ctx.workspaceId)
    .single()

  if (!original) return { error: 'Cotización no encontrada' }

  const validUntil = new Date()
  validUntil.setDate(validUntil.getDate() + (original.valid_days || 15))

  const { data, error } = await ctx.supabase
    .from('quotes')
    .insert({
      workspace_id: ctx.workspaceId,
      opportunity_id: opportunityId,
      client_id: original.client_id,
      mode: original.mode,
      description: original.description,
      total_price: original.total_price,
      estimated_cost: original.estimated_cost,
      iva_amount: original.iva_amount,
      retention_amount: original.retention_amount,
      net_amount: original.net_amount,
      profit_amount: original.profit_amount,
      margin_pct: original.margin_pct,
      status: 'borrador',
      valid_days: original.valid_days,
      valid_until: validUntil.toISOString().split('T')[0],
      notes: original.notes,
    })
    .select('*')
    .single()

  if (error) return { error: error.message }
  revalidatePath(`/pipeline/${opportunityId}`)
  return { success: true, quote: data }
}

export async function updateQuote(quoteId: string, opportunityId: string, formData: {
  description?: string | null
  total_price?: number
  estimated_cost?: number | null
  notes?: string | null
}) {
  const ctx = await getWorkspace()
  if (!ctx) return { error: 'No autenticado' }

  // Recalculate margin if price/cost changed
  const updates: Record<string, unknown> = { ...formData }
  if (formData.total_price && formData.estimated_cost) {
    updates.margin_pct = formData.total_price > 0
      ? Math.round(((formData.total_price - formData.estimated_cost) / formData.total_price) * 1000) / 10
      : 0
    updates.profit_amount = formData.total_price - formData.estimated_cost
  }

  const { error } = await ctx.supabase
    .from('quotes')
    .update(updates)
    .eq('id', quoteId)
    .eq('workspace_id', ctx.workspaceId)

  if (error) return { error: error.message }
  revalidatePath(`/pipeline/${opportunityId}`)
  return { success: true }
}
