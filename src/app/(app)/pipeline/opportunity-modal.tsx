'use client'

import { useState, useTransition, useRef, useEffect } from 'react'
import { X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createOpportunity, createCompletedOpportunity, STAGE_CONFIG, type PipelineStage } from './actions'
import type { Opportunity } from '@/types/database'

// ── Types ──────────────────────────────────────────────

type OpportunityWithClient = Opportunity & {
  clients: { name: string } | null
}

interface OpportunityModalProps {
  defaultStage?: PipelineStage
  /** 'ya-gane' creates won + project active, 'ya-entregue' creates won + project completed */
  quickAction?: 'me-buscan' | 'ya-gane' | 'ya-entregue'
  onClose: () => void
  onCreated: (opp: OpportunityWithClient) => void
}

// ── Timing options (Sprint 2: 3 opciones) ──────────────

const TIMING_OPTIONS = [
  { value: 'lead', label: 'Me están buscando', description: 'Apenas me contactaron' },
  { value: 'won', label: 'Ya lo gané', description: 'Tengo el proyecto confirmado' },
  { value: 'completed', label: 'Ya lo entregué', description: 'Terminé y necesito registrarlo' },
] as const

type TimingValue = typeof TIMING_OPTIONS[number]['value']

// ── Modal Component ────────────────────────────────────

export default function OpportunityModal({
  defaultStage = 'lead',
  quickAction,
  onClose,
  onCreated,
}: OpportunityModalProps) {
  const [clientName, setClientName] = useState('')
  const [oppName, setOppName] = useState('')
  const [estimatedValue, setEstimatedValue] = useState('')
  const [timing, setTiming] = useState<TimingValue>(
    quickAction === 'ya-gane' ? 'won'
    : quickAction === 'ya-entregue' ? 'completed'
    : defaultStage === 'won' ? 'won'
    : 'lead'
  )
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const clientRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    clientRef.current?.focus()
  }, [])

  // Close on Escape
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  const handleSubmit = () => {
    setError('')

    if (!clientName.trim()) {
      setError('¿Quién es el cliente?')
      return
    }
    if (!oppName.trim()) {
      setError('¿Cómo se llama el trabajo?')
      return
    }

    const value = parseFloat(estimatedValue.replace(/[^0-9.]/g, ''))
    if (!value || value <= 0) {
      setError('¿Cuánto vale el trabajo?')
      return
    }

    startTransition(async () => {
      let result

      if (timing === 'completed') {
        // Ya entregué — D48 + D176: won + project completed
        result = await createCompletedOpportunity({
          clientName: clientName.trim(),
          name: oppName.trim(),
          estimatedValue: value,
        })
      } else {
        // Lead or Won
        const stage: PipelineStage = timing === 'won' ? 'won' : defaultStage !== 'won' && defaultStage !== 'lost' ? defaultStage : 'lead'
        result = await createOpportunity({
          clientName: clientName.trim(),
          name: oppName.trim(),
          estimatedValue: value,
          stage,
        })
      }

      if (!result.success) {
        setError(result.error || 'Error creando oportunidad')
        return
      }

      // Build optimistic response for the board
      const finalStage = timing === 'completed' || timing === 'won' ? 'won' : defaultStage
      const newOpp: OpportunityWithClient = {
        id: result.opportunityId!,
        workspace_id: '',
        client_id: null,
        name: oppName.trim(),
        estimated_value: value,
        stage: finalStage,
        probability: STAGE_CONFIG[finalStage].probability,
        source: null,
        lost_reason: null,
        notes: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        clients: { name: clientName.trim() },
      }

      onCreated(newOpp)

      const msg = timing === 'completed'
        ? '¡Proyecto registrado como completado!'
        : timing === 'won'
        ? '¡Oportunidad ganada! Proyecto creado.'
        : 'Oportunidad creada'

      toast.success(msg)
    })
  }

  // Format value as currency while typing
  const handleValueChange = (raw: string) => {
    // Remove everything except digits
    const digits = raw.replace(/[^0-9]/g, '')
    if (!digits) {
      setEstimatedValue('')
      return
    }
    const num = parseInt(digits, 10)
    setEstimatedValue(num.toLocaleString('es-CO'))
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-t-2xl border bg-background p-6 shadow-xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Nueva oportunidad</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mt-1 text-sm text-muted-foreground">
          4 datos y listo. Menos de 45 segundos.
        </p>

        {/* Form — 4 campos (D25) */}
        <div className="mt-6 space-y-4">
          {/* 1. Client name — D29 inline creation */}
          <div className="space-y-1.5">
            <label htmlFor="clientName" className="text-sm font-medium">
              Cliente
            </label>
            <input
              ref={clientRef}
              id="clientName"
              type="text"
              placeholder="Nombre del cliente"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              className="flex h-11 w-full rounded-lg border border-input bg-background px-4 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onKeyDown={(e) => e.key === 'Enter' && document.getElementById('oppName')?.focus()}
            />
          </div>

          {/* 2. Opportunity name */}
          <div className="space-y-1.5">
            <label htmlFor="oppName" className="text-sm font-medium">
              Nombre del trabajo
            </label>
            <input
              id="oppName"
              type="text"
              placeholder="Ej: Diseño casa campestre"
              value={oppName}
              onChange={(e) => setOppName(e.target.value)}
              className="flex h-11 w-full rounded-lg border border-input bg-background px-4 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onKeyDown={(e) => e.key === 'Enter' && document.getElementById('estValue')?.focus()}
            />
          </div>

          {/* 3. Estimated value */}
          <div className="space-y-1.5">
            <label htmlFor="estValue" className="text-sm font-medium">
              ¿Cuánto vale?
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <input
                id="estValue"
                type="text"
                inputMode="numeric"
                placeholder="5.000.000"
                value={estimatedValue}
                onChange={(e) => handleValueChange(e.target.value)}
                className="flex h-11 w-full rounded-lg border border-input bg-background pl-8 pr-4 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
              />
            </div>
          </div>

          {/* 4. Timing — 3 options */}
          {!quickAction && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium">¿En qué momento estás?</label>
              <div className="space-y-2">
                {TIMING_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setTiming(opt.value)}
                    className={`flex w-full items-start rounded-lg border px-4 py-3 text-left transition-colors ${
                      timing === opt.value
                        ? 'border-primary bg-primary/5'
                        : 'border-input hover:bg-accent'
                    }`}
                  >
                    <div>
                      <p className={`text-sm font-medium ${timing === opt.value ? 'text-primary' : ''}`}>
                        {opt.label}
                      </p>
                      <p className="text-xs text-muted-foreground">{opt.description}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <p className="mt-3 text-sm text-destructive">{error}</p>
        )}

        {/* Submit */}
        <div className="mt-6 flex gap-3">
          <button
            onClick={onClose}
            className="flex h-11 flex-1 items-center justify-center rounded-lg border border-input bg-background text-sm font-medium transition-colors hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={isPending}
            className="flex h-11 flex-1 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Guardando...
              </>
            ) : (
              'Crear oportunidad'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
