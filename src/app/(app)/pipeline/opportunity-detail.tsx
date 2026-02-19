'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import {
  X,
  ChevronRight,
  RotateCcw,
  Calendar,
  DollarSign,
  User2,
  Briefcase,
  Pencil,
  Check,
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
  updateOpportunity,
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

function formatCurrencyInput(digits: string): string {
  if (!digits) return ''
  const num = parseInt(digits, 10)
  return num.toLocaleString('es-CO')
}

function getNextStage(current: PipelineStage): PipelineStage | null {
  const idx = ACTIVE_STAGES.indexOf(current as PipelineStage)
  if (idx === -1 || idx >= ACTIVE_STAGES.length - 1) return null
  return ACTIVE_STAGES[idx + 1]
}

// ── Inline editable field ─────────────────────────────

function EditableText({
  value,
  onSave,
  className = '',
  inputClassName = '',
  placeholder = '',
}: {
  value: string
  onSave: (newValue: string) => void
  className?: string
  inputClassName?: string
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const save = () => {
    if (draft.trim() && draft.trim() !== value) {
      onSave(draft.trim())
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <input
        ref={inputRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save()
          if (e.key === 'Escape') { setDraft(value); setEditing(false) }
        }}
        className={`w-full rounded-md border border-input bg-background px-2 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${inputClassName}`}
        placeholder={placeholder}
      />
    )
  }

  return (
    <div
      className={`group/edit flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 -mx-2 transition-colors hover:bg-accent ${className}`}
      onClick={() => { setDraft(value); setEditing(true) }}
    >
      <span className="flex-1">{value || placeholder}</span>
      <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover/edit:opacity-100 transition-opacity" />
    </div>
  )
}

function EditableValue({
  value,
  onSave,
}: {
  value: number
  onSave: (newValue: number) => void
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value.toLocaleString('es-CO'))
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus()
      inputRef.current?.select()
    }
  }, [editing])

  const save = () => {
    const num = parseInt(draft.replace(/[^0-9]/g, ''), 10)
    if (num > 0 && num !== value) {
      onSave(num)
    }
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="relative">
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            const digits = e.target.value.replace(/[^0-9]/g, '')
            setDraft(formatCurrencyInput(digits))
          }}
          onBlur={save}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') { setDraft(value.toLocaleString('es-CO')); setEditing(false) }
          }}
          inputMode="numeric"
          className="w-full rounded-md border border-input bg-background pl-6 pr-2 py-1 text-lg font-bold text-primary ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    )
  }

  return (
    <div
      className="group/edit flex cursor-pointer items-center gap-1.5 rounded-md transition-colors hover:bg-accent px-1 py-0.5 -mx-1"
      onClick={() => { setDraft(value.toLocaleString('es-CO')); setEditing(true) }}
    >
      <p className="text-lg font-bold text-primary">
        {formatCurrency(value)}
      </p>
      <Pencil className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 group-hover/edit:opacity-100 transition-opacity" />
    </div>
  )
}

// ── Main component ────────────────────────────────────

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

  const handleFieldSave = (field: 'name' | 'clientName' | 'estimatedValue', value: string | number) => {
    startTransition(async () => {
      const input: { id: string; name?: string; clientName?: string; estimatedValue?: number } = { id: opportunity.id }

      if (field === 'name') input.name = value as string
      if (field === 'clientName') input.clientName = value as string
      if (field === 'estimatedValue') input.estimatedValue = value as number

      const result = await updateOpportunity(input)
      if (!result.success) {
        toast.error(result.error || 'Error actualizando')
        return
      }

      const updated = { ...opportunity }
      if (field === 'name') updated.name = value as string
      if (field === 'clientName') updated.clients = { name: value as string }
      if (field === 'estimatedValue') updated.estimated_value = value as number

      onUpdated(updated)
      toast.success('Actualizado')
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
            {/* Title + client — editable */}
            <div>
              <EditableText
                value={opportunity.clients?.name || ''}
                onSave={(v) => handleFieldSave('clientName', v)}
                className="mb-1 text-sm text-muted-foreground"
                placeholder="Agregar cliente"
              />
              <EditableText
                value={opportunity.name}
                onSave={(v) => handleFieldSave('name', v)}
                className="text-xl font-bold"
                inputClassName="text-xl font-bold"
              />
            </div>

            {/* Key info — editable value */}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg border p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <DollarSign className="h-3.5 w-3.5" />
                  Valor estimado
                </div>
                <div className="mt-1">
                  <EditableValue
                    value={opportunity.estimated_value}
                    onSave={(v) => handleFieldSave('estimatedValue', v)}
                  />
                </div>
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
