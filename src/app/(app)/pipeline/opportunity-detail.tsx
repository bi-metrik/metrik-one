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
  Plus,
  FileText,
  Send,
  Copy,
  Trash2,
  ChevronDown,
  ChevronUp,
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
import {
  createQuote,
  sendQuote,
  acceptQuote,
  rejectQuote,
  reopenQuote,
  duplicateQuote,
} from './[id]/cotizaciones/actions'
import {
  getEstadoBadgeColor,
  ESTADO_LABELS,
  getAccionesDisponibles,
  isEditable,
  type EstadoCotizacion,
  type AccionCotizacion,
} from '@/lib/cotizaciones/state-machine'
import type { Opportunity, Quote } from '@/types/database'

type OpportunityWithClient = Opportunity & {
  clients: { name: string } | null
}

interface OpportunityDetailProps {
  opportunity: OpportunityWithClient
  quotes?: Quote[]
  onClose: () => void
  onUpdated: (updated: OpportunityWithClient) => void
}

// ── Line item for detailed quotes ──
interface LineItem {
  id: string
  description: string
  quantity: number
  unit_price: number
}

function newLineItem(): LineItem {
  return { id: crypto.randomUUID(), description: '', quantity: 1, unit_price: 0 }
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
  quotes: initialQuotes = [],
  onClose,
  onUpdated,
}: OpportunityDetailProps) {
  const [isPending, startTransition] = useTransition()
  const [lostReason, setLostReason] = useState('')
  const [showLostOptions, setShowLostOptions] = useState(false)

  // ── Cotizaciones state ──
  const [quotes, setQuotes] = useState<Quote[]>(initialQuotes)
  const [showQuoteForm, setShowQuoteForm] = useState(false)
  const [quoteMode, setQuoteMode] = useState<'quick' | 'detailed'>('quick')
  const [quoteForm, setQuoteForm] = useState({ description: '', total_price: '', estimated_cost: '', valid_days: '15' })
  const [lineItems, setLineItems] = useState<LineItem[]>([newLineItem()])
  const [expandedQuote, setExpandedQuote] = useState<string | null>(null)
  const lineItemsTotal = lineItems.reduce((sum, li) => sum + (li.quantity * li.unit_price), 0)

  // Fetch quotes on mount
  useEffect(() => {
    if (initialQuotes.length === 0) {
      // Load quotes for this opportunity
      import('./[id]/cotizaciones/actions').then(async (mod) => {
        // We don't have a getQuotes action, so we'll rely on what's passed
      })
    }
  }, [initialQuotes])

  const resetQuoteForm = () => {
    setQuoteForm({ description: '', total_price: '', estimated_cost: '', valid_days: '15' })
    setLineItems([newLineItem()])
    setShowQuoteForm(false)
    setQuoteMode('quick')
  }

  const handleCreateQuote = () => {
    if (quoteMode === 'detailed') {
      const validItems = lineItems.filter(li => li.description.trim() && li.unit_price > 0)
      if (validItems.length === 0) { toast.error('Agrega al menos un ítem con descripción y precio'); return }
      const descLines = validItems.map(li =>
        `${li.description} (${li.quantity} × ${formatCurrency(li.unit_price)})`
      ).join('\n')

      startTransition(async () => {
        const res = await createQuote(opportunity.id, {
          description: descLines,
          total_price: lineItemsTotal,
          estimated_cost: Number(quoteForm.estimated_cost) || undefined,
          valid_days: Number(quoteForm.valid_days) || 15,
          mode: 'detailed',
        })
        if (res.success && res.quote) {
          setQuotes(prev => [res.quote!, ...prev])
          toast.success('Cotización detallada creada')
          resetQuoteForm()
        } else { toast.error(res.error || 'Error') }
      })
    } else {
      const price = Number(quoteForm.total_price)
      if (!price || price <= 0) { toast.error('Precio es requerido'); return }

      startTransition(async () => {
        const res = await createQuote(opportunity.id, {
          description: quoteForm.description || undefined,
          total_price: price,
          estimated_cost: Number(quoteForm.estimated_cost) || undefined,
          valid_days: Number(quoteForm.valid_days) || 15,
          mode: 'quick',
        })
        if (res.success && res.quote) {
          setQuotes(prev => [res.quote!, ...prev])
          toast.success('Cotización creada')
          resetQuoteForm()
        } else { toast.error(res.error || 'Error') }
      })
    }
  }

  const handleQuoteAction = (quoteId: string, action: AccionCotizacion) => {
    startTransition(async () => {
      let res: { success?: boolean; error?: string; quote?: Quote; projectId?: string }
      switch (action) {
        case 'send':
          res = await sendQuote(quoteId, opportunity.id)
          if (res.success) { setQuotes(prev => prev.map(q => q.id === quoteId ? { ...q, status: 'enviada', sent_at: new Date().toISOString() } : q)); toast.success('Cotización enviada') }
          break
        case 'accept':
          res = await acceptQuote(quoteId, opportunity.id)
          if (res.success) { setQuotes(prev => prev.map(q => q.id === quoteId ? { ...q, status: 'aceptada', accepted_at: new Date().toISOString() } : q)); toast.success('Cotización aceptada. Proyecto creado.') }
          break
        case 'reject':
          res = await rejectQuote(quoteId, opportunity.id)
          if (res.success) { setQuotes(prev => prev.map(q => q.id === quoteId ? { ...q, status: 'rechazada' } : q)); toast.success('Cotización rechazada') }
          break
        case 'reopen':
          res = await reopenQuote(quoteId, opportunity.id)
          if (res.success) { setQuotes(prev => prev.map(q => q.id === quoteId ? { ...q, status: 'enviada' } : q)); toast.success('Cotización reabierta') }
          break
        case 'duplicate':
          res = await duplicateQuote(quoteId, opportunity.id)
          if (res.success && res.quote) { setQuotes(prev => [res.quote!, ...prev]); toast.success('Cotización duplicada') }
          break
        default: return
      }
      if (res! && !res!.success && res!.error) toast.error(res!.error)
    })
  }

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
                  {formatDate(opportunity.created_at ?? '')}
                </p>
              </div>
            </div>

            {/* Cotización Flash — D32, D50 */}
            <CotizacionFlash
              valorBruto={opportunity.estimated_value}
              hasFiscalProfile={false}
            />

            {/* ── Cotizaciones Section ── */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  Cotizaciones {quotes.length > 0 && `(${quotes.length})`}
                </p>
                {!showQuoteForm && (
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => { resetQuoteForm(); setQuoteMode('quick'); setShowQuoteForm(true) }}
                      className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90"
                    >
                      <Plus className="h-3 w-3" /> Rápida
                    </button>
                    <button
                      onClick={() => { resetQuoteForm(); setQuoteMode('detailed'); setShowQuoteForm(true) }}
                      className="flex items-center gap-1 rounded-md border border-primary px-2 py-1 text-[10px] font-medium text-primary hover:bg-primary/5"
                    >
                      <FileText className="h-3 w-3" /> Detallada
                    </button>
                  </div>
                )}
              </div>

              {/* Quote creation form */}
              {showQuoteForm && (
                <div className="space-y-3 rounded-lg border bg-muted/30 p-3">
                  <div className="flex items-center gap-2">
                    <p className="text-xs font-medium">
                      {quoteMode === 'quick' ? 'Cotización rápida' : 'Cotización detallada'}
                    </p>
                    <button
                      onClick={() => setQuoteMode(quoteMode === 'quick' ? 'detailed' : 'quick')}
                      className="text-[10px] text-primary hover:underline"
                    >
                      Cambiar a {quoteMode === 'quick' ? 'detallada' : 'rápida'}
                    </button>
                  </div>

                  {quoteMode === 'quick' ? (
                    <div className="space-y-2">
                      <div>
                        <label className="text-[10px] text-muted-foreground">Descripción</label>
                        <input type="text" value={quoteForm.description} onChange={e => setQuoteForm({ ...quoteForm, description: e.target.value })} className="mt-0.5 w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="Ej: Diseño de marca" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-muted-foreground">Precio total *</label>
                          <input type="number" value={quoteForm.total_price} onChange={e => setQuoteForm({ ...quoteForm, total_price: e.target.value })} className="mt-0.5 w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="0" />
                        </div>
                        <div>
                          <label className="text-[10px] text-muted-foreground">Costo estimado</label>
                          <input type="number" value={quoteForm.estimated_cost} onChange={e => setQuoteForm({ ...quoteForm, estimated_cost: e.target.value })} className="mt-0.5 w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="0" />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <div className="space-y-1.5">
                        <div className="grid grid-cols-[1fr_60px_90px_24px] gap-1.5 text-[9px] font-medium text-muted-foreground">
                          <span>Descripción</span>
                          <span className="text-center">Cant.</span>
                          <span className="text-right">P. unit.</span>
                          <span></span>
                        </div>
                        {lineItems.map(li => (
                          <div key={li.id} className="grid grid-cols-[1fr_60px_90px_24px] gap-1.5">
                            <input type="text" value={li.description} onChange={e => setLineItems(prev => prev.map(l => l.id === li.id ? { ...l, description: e.target.value } : l))} className="rounded-md border bg-background px-2 py-1 text-xs" placeholder="Ítem..." />
                            <input type="number" min="1" value={li.quantity || ''} onChange={e => setLineItems(prev => prev.map(l => l.id === li.id ? { ...l, quantity: Number(e.target.value) || 1 } : l))} className="rounded-md border bg-background px-1 py-1 text-center text-xs" />
                            <input type="number" value={li.unit_price || ''} onChange={e => setLineItems(prev => prev.map(l => l.id === li.id ? { ...l, unit_price: Number(e.target.value) || 0 } : l))} className="rounded-md border bg-background px-1 py-1 text-right text-xs" placeholder="0" />
                            <button onClick={() => { if (lineItems.length > 1) setLineItems(prev => prev.filter(l => l.id !== li.id)) }} disabled={lineItems.length <= 1} className="flex items-center justify-center rounded-md hover:bg-accent disabled:opacity-30">
                              <Trash2 className="h-3 w-3 text-muted-foreground" />
                            </button>
                          </div>
                        ))}
                        <button onClick={() => setLineItems(prev => [...prev, newLineItem()])} className="flex items-center gap-1 text-[10px] text-primary hover:underline">
                          <Plus className="h-2.5 w-2.5" /> Agregar ítem
                        </button>
                      </div>
                      <div className="flex items-center justify-between rounded-md bg-primary/5 px-2 py-1.5">
                        <span className="text-xs font-medium">Total</span>
                        <span className="text-xs font-bold">{formatCurrency(lineItemsTotal)}</span>
                      </div>
                      <div>
                        <label className="text-[10px] text-muted-foreground">Costo estimado (opcional)</label>
                        <input type="number" value={quoteForm.estimated_cost} onChange={e => setQuoteForm({ ...quoteForm, estimated_cost: e.target.value })} className="mt-0.5 w-full rounded-md border bg-background px-2 py-1.5 text-sm" placeholder="0" />
                      </div>
                    </div>
                  )}

                  <div className="flex justify-end gap-2">
                    <button onClick={resetQuoteForm} className="flex items-center gap-1 rounded-md border px-2 py-1 text-[10px] hover:bg-accent">
                      <X className="h-2.5 w-2.5" /> Cancelar
                    </button>
                    <button onClick={handleCreateQuote} disabled={isPending} className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[10px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                      <Check className="h-2.5 w-2.5" /> Crear borrador
                    </button>
                  </div>
                </div>
              )}

              {/* Quotes list */}
              {quotes.length === 0 && !showQuoteForm ? (
                <div className="rounded-lg border border-dashed p-4 text-center">
                  <FileText className="mx-auto h-6 w-6 text-muted-foreground/30" />
                  <p className="mt-1 text-xs text-muted-foreground">Sin cotizaciones aún</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {quotes.map(q => {
                    const status = q.status as EstadoCotizacion
                    const actions = getAccionesDisponibles(status).filter(a => a !== 'view' && a !== 'edit')
                    const isExpanded = expandedQuote === q.id
                    const isDetailed = q.mode === 'detailed'
                    return (
                      <div key={q.id} className="rounded-lg border">
                        <div
                          className="flex items-center gap-2 p-2 cursor-pointer hover:bg-accent/30"
                          onClick={() => setExpandedQuote(isExpanded ? null : q.id)}
                        >
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-medium ${getEstadoBadgeColor(status)}`}>
                                {ESTADO_LABELS[status]}
                              </span>
                              {isDetailed && (
                                <span className="shrink-0 rounded-full bg-purple-100 px-1 py-0.5 text-[8px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                                  Detallada
                                </span>
                              )}
                              <p className="text-xs font-medium truncate">{q.description?.split('\n')[0] || 'Cotización'}</p>
                            </div>
                            <p className="mt-0.5 text-[10px] text-muted-foreground">
                              {formatCurrency(q.total_price)} · {new Date(q.created_at ?? '').toLocaleDateString('es-CO')}
                            </p>
                          </div>
                          {isExpanded ? <ChevronUp className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />}
                        </div>
                        {isExpanded && (
                          <div className="border-t p-2 space-y-2">
                            {isDetailed && q.description && (
                              <div className="space-y-0.5 rounded-md border p-2">
                                <p className="text-[9px] font-medium text-muted-foreground uppercase">Desglose</p>
                                {q.description.split('\n').map((line: string, i: number) => (
                                  <p key={i} className="text-[11px]">{line}</p>
                                ))}
                              </div>
                            )}
                            {!isDetailed && q.description && <p className="text-xs text-muted-foreground">{q.description}</p>}
                            <div className="flex flex-wrap gap-1">
                              {actions.map(action => {
                                const iconMap: Record<string, typeof Send> = { send: Send, accept: Check, reject: X, reopen: RotateCcw, duplicate: Copy }
                                const labelMap: Record<string, string> = { send: 'Enviar', accept: 'Aceptar', reject: 'Rechazar', reopen: 'Reabrir', duplicate: 'Duplicar' }
                                const colorMap: Record<string, string> = { send: 'text-blue-600', accept: 'text-green-600', reject: 'text-red-600', reopen: 'text-amber-600', duplicate: 'text-muted-foreground' }
                                const Icon = iconMap[action] || FileText
                                return (
                                  <button
                                    key={action}
                                    onClick={(e) => { e.stopPropagation(); handleQuoteAction(q.id, action) }}
                                    disabled={isPending}
                                    className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium hover:bg-accent disabled:opacity-50 ${colorMap[action] || ''}`}
                                  >
                                    <Icon className="h-2.5 w-2.5" /> {labelMap[action] || action}
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

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
