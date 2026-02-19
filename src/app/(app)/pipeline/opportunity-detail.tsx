'use client'

import { useState, useTransition } from 'react'
import {
  X,
  ChevronRight,
  RotateCcw,
  Calendar,
  DollarSign,
  User2,
  Briefcase,
} from 'lucide-react'
import { toast } from 'sonner'
import CotizacionFlash from './cotizacion-flash'
import {
  STAGE_CONFIG,
  ACTIVE_STAGES,
  LOST_REASONS,
  type PipelineStage,
} from './pipeline-config'
import {
  moveOpportunity,
  reactivateOpportunity,
} from './actions'
import type { Opportunity } from '@/types/database'

type OpportunityWithClient = Opportunity & {
  clients: { name: string } | null
}

interface OpportunityDetailProps {
  opportunity: OpportunityWithClient
  onClose: () => void
  onUpdated: (updated: OpportunityWithClient) => void
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(date: string): string {
  return new Date(date).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

function getNextStage(current: PipelineStage): PipelineStage | null {
  const idx = ACTIVE_STAGES.indexOf(current as PipelineStage)
  if (idx === -1 || idx >= ACTIVE_STAGES.length - 1) return null
  return ACTIVE_STAGES[idx + 1]
}

export default function OpportunityDetail({
  opportunity,
  onClose,
  onUpdated,
}: OpportunityDetailProps) {
  const [isPending, startTransition] = useTransition()
  const [lostReason, setLostReason] = useState('')
  const [showLostOptions, setShowLostOptions] = useState(false)

  const stage = opportunity.stage as PipelineStage
  const config = STAGE_CONFIG[stage]
  const nextStage = getNextStage(stage)

  const handleMove = (targetStage: PipelineStage, reason?: string) => {
    startTransition(async () => {
      const result = await moveOpportunity(opportunity.id, targetStage, reason)
      if (!result.success) {
        toast.error(result.error || 'Error moviendo oportunidad')
        return
      }
      onUpdated({
        ...opportunity,
        stage: targetStage,
        probability: STAGE_CONFIG[targetStage].probability,
        lost_reason: reason || null,
      })
      if (targetStage === 'won') toast.success('¡Oportunidad ganada! Proyecto creado.')
      else if (targetStage === 'lost') toast.info('Oportunidad marcada como perdida')
      else toast.success(`Movida a ${STAGE_CONFIG[targetStage].label}`)
    })
  }

  const handleReactivate = (targetStage: 'lead' | 'prospect') => {
    startTransition(async () => {
      const result = await reactivateOpportunity(opportunity.id, targetStage)
      if (!result.success) {
        toast.error(result.error || 'Error reactivando')
        return
      }
      onUpdated({
        ...opportunity,
        stage: targetStage,
        probability: STAGE_CONFIG[targetStage].probability,
        lost_reason: null,
      })
      toast.success(`Reactivada como ${STAGE_CONFIG[targetStage].label}`)
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end bg-black/50" onClick={onClose}>
      <div
        className="flex h-full w-full max-w-lg flex-col border-l bg-background shadow-xl animate-in slide-in-from-right duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div className="flex items-center gap-3">
            <div className={`h-3 w-3 rounded-full ${config?.color || 'bg-gray-400'}`} />
            <span className="text-sm font-medium text-muted-foreground">
              {config?.label || stage} · {config?.probability ?? 0}%
            </span>
          </div>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="space-y-6">
            {/* Title + client */}
            <div>
              {opportunity.clients?.name && (
                <div className="mb-1 flex items-center gap-1.5 text-sm text-muted-foreground">
                  <User2 className="h-3.5 w-3.5" />
                  {opportunity.clients.name}
                </div>
              )}
              <h2 className="text-xl font-bold">{opportunity.name}</h2>
            </div>

            {/* Key info */}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <DollarSign className="h-3.5 w-3.5" />
                  Valor estimado
                </div>
                <p className="mt-1 text-lg font-bold text-primary">
                  {formatCurrency(opportunity.estimated_value)}
                </p>
              </div>
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  Creada
                </div>
                <p className="mt-1 text-sm font-medium">
                  {formatDate(opportunity.created_at)}
                </p>
              </div>
            </div>

            {/* Cotización Flash — D32, D50 */}
            <CotizacionFlash
              valorBruto={opportunity.estimated_value}
              hasFiscalProfile={false}
            />

            {/* Stage actions */}
            {stage !== 'won' && stage !== 'lost' && (
              <div className="space-y-3">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Acciones
                </p>
                <div className="flex flex-wrap gap-2">
                  {/* Advance */}
                  {nextStage && (
                    <button
                      onClick={() => handleMove(nextStage)}
                      disabled={isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      Avanzar a {STAGE_CONFIG[nextStage].label}
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  )}

                  {/* Won */}
                  <button
                    onClick={() => handleMove('won')}
                    disabled={isPending}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-green-500 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-green-600 disabled:opacity-50"
                  >
                    <Briefcase className="h-4 w-4" />
                    Marcar ganada
                  </button>

                  {/* Lost */}
                  {!showLostOptions ? (
                    <button
                      onClick={() => setShowLostOptions(true)}
                      disabled={isPending}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-destructive/30 px-4 py-2 text-sm font-medium text-destructive transition-colors hover:bg-destructive/5 disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                      Marcar perdida
                    </button>
                  ) : (
                    <div className="w-full space-y-2 rounded-lg border border-destructive/20 p-3">
                      <p className="text-sm font-medium text-destructive">¿Por qué se perdió?</p>
                      <div className="grid grid-cols-2 gap-2">
                        {LOST_REASONS.map((reason) => (
                          <button
                            key={reason.value}
                            onClick={() => setLostReason(reason.value)}
                            className={`rounded-md border px-3 py-2 text-xs transition-colors ${
                              lostReason === reason.value
                                ? 'border-destructive bg-destructive/10 text-destructive'
                                : 'border-border hover:bg-accent'
                            }`}
                          >
                            {reason.label}
                          </button>
                        ))}
                      </div>
                      <div className="flex gap-2 pt-1">
                        <button
                          onClick={() => { setShowLostOptions(false); setLostReason('') }}
                          className="flex-1 rounded-md border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() => lostReason && handleMove('lost', lostReason)}
                          disabled={!lostReason || isPending}
                          className="flex-1 rounded-md bg-destructive px-3 py-1.5 text-xs font-medium text-destructive-foreground transition-colors hover:bg-destructive/90 disabled:opacity-50"
                        >
                          Confirmar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Won info */}
            {stage === 'won' && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900 dark:bg-green-950/30">
                <p className="text-sm font-medium text-green-700 dark:text-green-400">
                  ✅ Oportunidad ganada
                </p>
                <p className="mt-1 text-xs text-green-600 dark:text-green-500">
                  Proyecto creado automáticamente. Revisa en la sección Proyectos.
                </p>
              </div>
            )}

            {/* Lost info + reactivate — D173 */}
            {stage === 'lost' && (
              <div className="space-y-3">
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950/30">
                  <p className="text-sm font-medium text-red-700 dark:text-red-400">
                    Oportunidad perdida
                  </p>
                  {opportunity.lost_reason && (
                    <p className="mt-1 text-xs text-red-600 dark:text-red-500">
                      Razón: {LOST_REASONS.find(r => r.value === opportunity.lost_reason)?.label || opportunity.lost_reason}
                    </p>
                  )}
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleReactivate('lead')}
                    disabled={isPending}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reactivar como Lead
                  </button>
                  <button
                    onClick={() => handleReactivate('prospect')}
                    disabled={isPending}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    <RotateCcw className="h-4 w-4" />
                    Reactivar como Prospecto
                  </button>
                </div>
              </div>
            )}

            {/* Notes */}
            {opportunity.notes && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Notas
                </p>
                <p className="text-sm text-muted-foreground">{opportunity.notes}</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
