'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

// ── Helper ──────────────────────────────────────────────

async function getWorkspace() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) throw new Error('No autenticado')

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id')
    .eq('id', user.id)
    .single()

  if (!profile) throw new Error('Sin workspace')
  return { supabase, workspaceId: profile.workspace_id }
}

// ── Types ──────────────────────────────────────────────

export interface FiscalWizardData {
  personType: 'natural' | 'juridica'
  taxRegime: 'ordinario' | 'simple' | null   // null = "no sé"
  ivaResponsible: boolean | null               // null = "no sé"
  isDeclarante: boolean
  selfWithholder: boolean
  icaCity: string
  icaRate: number
}

// ── Get Fiscal Profile ──────────────────────────────────

export async function getFiscalProfile() {
  const { supabase, workspaceId } = await getWorkspace()

  const { data, error } = await supabase
    .from('fiscal_profiles')
    .select('*')
    .eq('workspace_id', workspaceId)
    .single()

  if (error && error.code !== 'PGRST116') {
    return { success: false as const, error: error.message }
  }

  return { success: true as const, data }
}

// ── Save Fiscal Profile (Wizard Felipe) ─────────────────

export async function saveFiscalProfile(wizardData: FiscalWizardData) {
  const { supabase, workspaceId } = await getWorkspace()

  // Determine completeness:
  // Complete = all fields answered explicitly (no "no sé")
  // Estimated = user answered some with "no sé" → defaults used
  const hasUnknowns = wizardData.taxRegime === null || wizardData.ivaResponsible === null
  const isComplete = !hasUnknowns
  const isEstimated = hasUnknowns

  // Apply defaults for unknowns (D51: conservative defaults)
  const resolved = {
    person_type: wizardData.personType,
    tax_regime: wizardData.taxRegime || 'ordinario',        // Default: ordinario
    iva_responsible: wizardData.ivaResponsible ?? true,      // Default: sí (conservative)
    is_declarante: wizardData.isDeclarante,
    self_withholder: wizardData.selfWithholder,
    ica_city: wizardData.icaCity || 'Bogotá',
    ica_rate: wizardData.icaRate || 9.66,                    // Default: Bogotá
    is_complete: isComplete,
    is_estimated: isEstimated,
    updated_at: new Date().toISOString(),
  }

  const { error } = await supabase
    .from('fiscal_profiles')
    .update(resolved)
    .eq('workspace_id', workspaceId)

  if (error) {
    return { success: false as const, error: error.message }
  }

  revalidatePath('/config')
  revalidatePath('/numeros')
  revalidatePath('/pipeline')

  return {
    success: true as const,
    isComplete,
    isEstimated,
  }
}

// ── Skip Fiscal Setup (D234: "Configurar después") ─────

export async function skipFiscalSetup() {
  const { supabase, workspaceId } = await getWorkspace()

  // Increment nudge count — D236: max 3 nudges
  const { data: current } = await supabase
    .from('fiscal_profiles')
    .select('nudge_count')
    .eq('workspace_id', workspaceId)
    .single()

  const newNudgeCount = (current?.nudge_count || 0) + 1

  const { error } = await supabase
    .from('fiscal_profiles')
    .update({
      nudge_count: newNudgeCount,
      updated_at: new Date().toISOString(),
    })
    .eq('workspace_id', workspaceId)

  if (error) {
    return { success: false as const, error: error.message }
  }

  revalidatePath('/config')
  return { success: true as const, nudgeCount: newNudgeCount }
}

// ── Increment Nudge (called by nudge banner) ───────────

export async function incrementNudge() {
  const { supabase, workspaceId } = await getWorkspace()

  const { data: current } = await supabase
    .from('fiscal_profiles')
    .select('nudge_count')
    .eq('workspace_id', workspaceId)
    .single()

  const newCount = (current?.nudge_count || 0) + 1

  await supabase
    .from('fiscal_profiles')
    .update({ nudge_count: newCount, updated_at: new Date().toISOString() })
    .eq('workspace_id', workspaceId)

  revalidatePath('/config')
  return { success: true as const, nudgeCount: newCount }
}
