'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ── Types ──────────────────────────────────────────────

export type PipelineStage = 'lead' | 'prospect' | 'quotation' | 'negotiation' | 'won' | 'lost'

export const STAGE_CONFIG: Record<PipelineStage, { label: string; probability: number; color: string }> = {
  lead:        { label: 'Lead',        probability: 10,  color: 'bg-blue-500' },
  prospect:    { label: 'Prospecto',   probability: 25,  color: 'bg-indigo-500' },
  quotation:   { label: 'Cotización',  probability: 50,  color: 'bg-yellow-500' },
  negotiation: { label: 'Negociación', probability: 75,  color: 'bg-orange-500' },
  won:         { label: 'Ganada',      probability: 100, color: 'bg-green-500' },
  lost:        { label: 'Perdida',     probability: 0,   color: 'bg-red-500' },
}

export const PIPELINE_STAGES: PipelineStage[] = ['lead', 'prospect', 'quotation', 'negotiation', 'won', 'lost']
export const ACTIVE_STAGES: PipelineStage[] = ['lead', 'prospect', 'quotation', 'negotiation']

export const LOST_REASONS = [
  { value: 'price', label: 'Precio muy alto' },
  { value: 'timing', label: 'No es el momento' },
  { value: 'competition', label: 'Eligieron a otro' },
  { value: 'no_budget', label: 'No tienen presupuesto' },
  { value: 'ghosting', label: 'No me respondieron' },
  { value: 'not_a_fit', label: 'No era para mí' },
] as const

export type LostReason = typeof LOST_REASONS[number]['value']

// ── Fetch opportunities ────────────────────────────────

export async function getOpportunities() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { opportunities: [], error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) return { opportunities: [], error: 'Sin perfil' }

  const { data: opportunities, error } = await supabase
    .from('opportunities')
    .select('*, clients(name)')
    .eq('workspace_id', profile.workspace_id)
    .order('created_at', { ascending: false })

  if (error) return { opportunities: [], error: error.message }

  return { opportunities: opportunities || [], error: null }
}

// ── Create opportunity ─────────────────────────────────

interface CreateOpportunityInput {
  clientName: string
  name: string
  estimatedValue: number
  stage: PipelineStage
}

export async function createOpportunity(input: CreateOpportunityInput) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) return { success: false, error: 'Sin perfil' }

  const workspaceId = profile.workspace_id

  // D29: Create client inline — upsert by name
  let clientId: string | null = null
  if (input.clientName.trim()) {
    // Check if client already exists
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('workspace_id', workspaceId)
      .ilike('name', input.clientName.trim())
      .limit(1)
      .single()

    if (existingClient) {
      clientId = existingClient.id
    } else {
      // D30: NIT optional — create client with just name
      const { data: newClient, error: clientErr } = await supabase
        .from('clients')
        .insert({ workspace_id: workspaceId, name: input.clientName.trim() })
        .select('id')
        .single()

      if (clientErr) return { success: false, error: `Error creando cliente: ${clientErr.message}` }
      clientId = newClient.id
    }
  }

  // Probability from stage config
  const probability = STAGE_CONFIG[input.stage].probability

  // Create opportunity
  const { data: opportunity, error: oppErr } = await supabase
    .from('opportunities')
    .insert({
      workspace_id: workspaceId,
      client_id: clientId,
      name: input.name.trim(),
      estimated_value: input.estimatedValue,
      stage: input.stage,
      probability,
    })
    .select()
    .single()

  if (oppErr) return { success: false, error: `Error creando oportunidad: ${oppErr.message}` }

  // D48: If stage is 'won', auto-create project (D176: active, not draft)
  let projectId: string | null = null
  if (input.stage === 'won') {
    const { data: project, error: projErr } = await supabase
      .from('projects')
      .insert({
        workspace_id: workspaceId,
        client_id: clientId,
        opportunity_id: opportunity.id,
        name: input.name.trim(),
        approved_budget: input.estimatedValue,
        status: 'active',
      })
      .select('id')
      .single()

    if (projErr) {
      console.error('Project creation error:', projErr)
      // Don't fail the opportunity — project can be created later
    } else {
      projectId = project.id
    }
  }

  revalidatePath('/pipeline')
  revalidatePath('/dashboard')
  revalidatePath('/proyectos')

  return { success: true, opportunityId: opportunity.id, projectId }
}

// ── Create opportunity + completed project (Ya entregué) ──

export async function createCompletedOpportunity(input: Omit<CreateOpportunityInput, 'stage'>) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) return { success: false, error: 'Sin perfil' }

  const workspaceId = profile.workspace_id

  // Create/find client
  let clientId: string | null = null
  if (input.clientName.trim()) {
    const { data: existingClient } = await supabase
      .from('clients')
      .select('id')
      .eq('workspace_id', workspaceId)
      .ilike('name', input.clientName.trim())
      .limit(1)
      .single()

    if (existingClient) {
      clientId = existingClient.id
    } else {
      const { data: newClient, error: clientErr } = await supabase
        .from('clients')
        .insert({ workspace_id: workspaceId, name: input.clientName.trim() })
        .select('id')
        .single()

      if (clientErr) return { success: false, error: `Error creando cliente: ${clientErr.message}` }
      clientId = newClient.id
    }
  }

  // Create opportunity as won
  const { data: opportunity, error: oppErr } = await supabase
    .from('opportunities')
    .insert({
      workspace_id: workspaceId,
      client_id: clientId,
      name: input.name.trim(),
      estimated_value: input.estimatedValue,
      stage: 'won',
      probability: 100,
    })
    .select()
    .single()

  if (oppErr) return { success: false, error: `Error creando oportunidad: ${oppErr.message}` }

  // Create project as completed
  const { error: projErr } = await supabase
    .from('projects')
    .insert({
      workspace_id: workspaceId,
      client_id: clientId,
      opportunity_id: opportunity.id,
      name: input.name.trim(),
      approved_budget: input.estimatedValue,
      status: 'completed',
      progress_pct: 100,
      closed_at: new Date().toISOString(),
    })

  if (projErr) console.error('Project creation error:', projErr)

  revalidatePath('/pipeline')
  revalidatePath('/dashboard')
  revalidatePath('/proyectos')

  return { success: true, opportunityId: opportunity.id }
}

// ── Move opportunity to new stage ──────────────────────

export async function moveOpportunity(opportunityId: string, newStage: PipelineStage, lostReason?: string) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'No autenticado' }

  // Get current opportunity
  const { data: opp } = await supabase
    .from('opportunities')
    .select('stage, workspace_id, client_id, name, estimated_value')
    .eq('id', opportunityId)
    .single()

  if (!opp) return { success: false, error: 'Oportunidad no encontrada' }

  // D174: Lost reason is mandatory
  if (newStage === 'lost' && !lostReason) {
    return { success: false, error: 'Selecciona una razón de pérdida' }
  }

  const probability = STAGE_CONFIG[newStage].probability

  const updateData: Record<string, unknown> = {
    stage: newStage,
    probability,
    updated_at: new Date().toISOString(),
  }

  if (newStage === 'lost') {
    updateData.lost_reason = lostReason
  } else {
    updateData.lost_reason = null
  }

  const { error: updateErr } = await supabase
    .from('opportunities')
    .update(updateData)
    .eq('id', opportunityId)

  if (updateErr) return { success: false, error: `Error actualizando: ${updateErr.message}` }

  // Record stage history
  await supabase
    .from('opportunity_stage_history')
    .insert({
      workspace_id: opp.workspace_id,
      opportunity_id: opportunityId,
      from_stage: opp.stage,
      to_stage: newStage,
      changed_by: user.id,
    })

  // D48: If moved to 'won', auto-create project
  if (newStage === 'won' && opp.stage !== 'won') {
    // Check if project already exists for this opportunity
    const { data: existingProject } = await supabase
      .from('projects')
      .select('id')
      .eq('opportunity_id', opportunityId)
      .limit(1)
      .single()

    if (!existingProject) {
      await supabase
        .from('projects')
        .insert({
          workspace_id: opp.workspace_id,
          client_id: opp.client_id,
          opportunity_id: opportunityId,
          name: opp.name,
          approved_budget: opp.estimated_value,
          status: 'active',
        })
    }
  }

  revalidatePath('/pipeline')
  revalidatePath('/dashboard')
  revalidatePath('/proyectos')

  return { success: true }
}

// ── Reactivate lost opportunity (D173) ─────────────────

export async function reactivateOpportunity(opportunityId: string, targetStage: 'lead' | 'prospect' = 'lead') {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { success: false, error: 'No autenticado' }

  const { data: opp } = await supabase
    .from('opportunities')
    .select('stage, workspace_id')
    .eq('id', opportunityId)
    .single()

  if (!opp) return { success: false, error: 'Oportunidad no encontrada' }
  if (opp.stage !== 'lost') return { success: false, error: 'Solo puedes reactivar oportunidades perdidas' }

  const probability = STAGE_CONFIG[targetStage].probability

  const { error } = await supabase
    .from('opportunities')
    .update({
      stage: targetStage,
      probability,
      lost_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', opportunityId)

  if (error) return { success: false, error: error.message }

  await supabase
    .from('opportunity_stage_history')
    .insert({
      workspace_id: opp.workspace_id,
      opportunity_id: opportunityId,
      from_stage: 'lost',
      to_stage: targetStage,
      changed_by: user.id,
    })

  revalidatePath('/pipeline')
  return { success: true }
}
