// ── Pipeline Configuration ──────────────────────────────
// Shared constants used by both server actions and client components.
// This file intentionally has NO 'use server' or 'use client' directive
// so it can be imported from either context.

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
