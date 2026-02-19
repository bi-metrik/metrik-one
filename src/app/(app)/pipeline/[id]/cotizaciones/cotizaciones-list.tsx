'use client'

import { useState, useTransition } from 'react'
import {
  Plus, Send, Check, X, RotateCcw, Copy, FileText,
  DollarSign, Pencil, ChevronDown, ChevronUp, Trash2,
} from 'lucide-react'
import { toast } from 'sonner'
import type { Quote } from '@/types/database'
import {
  getEstadoBadgeColor,
  ESTADO_LABELS,
  getAccionesDisponibles,
  isEditable,
  type EstadoCotizacion,
  type AccionCotizacion,
} from '@/lib/cotizaciones/state-machine'
import {
  createQuote,
  sendQuote,
  acceptQuote,
  rejectQuote,
  reopenQuote,
  duplicateQuote,
  updateQuote,
} from './actions'

interface CotizacionesListProps {
  opportunityId: string
  quotes: Quote[]
  onQuotesChange: (quotes: Quote[]) => void
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

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

export default function CotizacionesList({
  opportunityId,
  quotes,
  onQuotesChange,
}: CotizacionesListProps) {
  const [showForm, setShowForm] = useState(false)
  const [formMode, setFormMode] = useState<'quick' | 'detailed'>('quick')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()
  const [form, setForm] = useState({
    description: '',
    total_price: '',
    estimated_cost: '',
    valid_days: '15',
  })
  const [lineItems, setLineItems] = useState<LineItem[]>([newLineItem()])

  const resetForm = () => {
    setForm({ description: '', total_price: '', estimated_cost: '', valid_days: '15' })
    setLineItems([newLineItem()])
    setShowForm(false)
    setEditingId(null)
    setFormMode('quick')
  }

  // Calculate total from line items
  const lineItemsTotal = lineItems.reduce((sum, li) => sum + (li.quantity * li.unit_price), 0)

  const handleCreate = () => {
    if (formMode === 'detailed') {
      // Validate line items
      const validItems = lineItems.filter(li => li.description.trim() && li.unit_price > 0)
      if (validItems.length === 0) { toast.error('Agrega al menos un ítem con descripción y precio'); return }

      // Build description from line items and use total
      const descLines = validItems.map(li =>
        `${li.description} (${li.quantity} × ${fmt(li.unit_price)})`
      ).join('\n')

      startTransition(async () => {
        const res = await createQuote(opportunityId, {
          description: descLines,
          total_price: lineItemsTotal,
          estimated_cost: Number(form.estimated_cost) || undefined,
          valid_days: Number(form.valid_days) || 15,
          mode: 'detailed',
        })
        if (res.success && res.quote) {
          onQuotesChange([res.quote, ...quotes])
          toast.success('Cotización detallada creada')
          resetForm()
        } else {
          toast.error(res.error)
        }
      })
    } else {
      const price = Number(form.total_price)
      if (!price || price <= 0) { toast.error('Precio es requerido'); return }

      startTransition(async () => {
        const res = await createQuote(opportunityId, {
          description: form.description || undefined,
          total_price: price,
          estimated_cost: Number(form.estimated_cost) || undefined,
          valid_days: Number(form.valid_days) || 15,
          mode: 'quick',
        })
        if (res.success && res.quote) {
          onQuotesChange([res.quote, ...quotes])
          toast.success('Cotización creada')
          resetForm()
        } else {
          toast.error(res.error)
        }
      })
    }
  }

  const handleAction = (quoteId: string, action: AccionCotizacion) => {
    startTransition(async () => {
      let res: { success?: boolean; error?: string; quote?: Quote; projectId?: string }

      switch (action) {
        case 'send':
          res = await sendQuote(quoteId, opportunityId)
          if (res.success) {
            onQuotesChange(quotes.map(q =>
              q.id === quoteId ? { ...q, status: 'enviada', sent_at: new Date().toISOString() } : q
            ))
            toast.success('Cotización enviada')
          }
          break
        case 'accept':
          res = await acceptQuote(quoteId, opportunityId)
          if (res.success) {
            onQuotesChange(quotes.map(q =>
              q.id === quoteId ? { ...q, status: 'aceptada', accepted_at: new Date().toISOString() } : q
            ))
            toast.success(`Cotización aceptada. Proyecto creado.`)
          }
          break
        case 'reject':
          res = await rejectQuote(quoteId, opportunityId)
          if (res.success) {
            onQuotesChange(quotes.map(q =>
              q.id === quoteId ? { ...q, status: 'rechazada' } : q
            ))
            toast.success('Cotización rechazada')
          }
          break
        case 'reopen':
          res = await reopenQuote(quoteId, opportunityId)
          if (res.success) {
            onQuotesChange(quotes.map(q =>
              q.id === quoteId ? { ...q, status: 'enviada' } : q
            ))
            toast.success('Cotización reabierta')
          }
          break
        case 'duplicate':
          res = await duplicateQuote(quoteId, opportunityId)
          if (res.success && res.quote) {
            onQuotesChange([res.quote, ...quotes])
            toast.success('Cotización duplicada (en borrador)')
          }
          break
        default:
          return
      }

      if (res && !res.success && res.error) {
        toast.error(res.error)
      }
    })
  }

  const handleSaveEdit = (quoteId: string) => {
    startTransition(async () => {
      const res = await updateQuote(quoteId, opportunityId, {
        description: form.description || null,
        total_price: Number(form.total_price) || 0,
        estimated_cost: Number(form.estimated_cost) || null,
      })
      if (res.success) {
        onQuotesChange(quotes.map(q =>
          q.id === quoteId
            ? { ...q, description: form.description || null, total_price: Number(form.total_price), estimated_cost: Number(form.estimated_cost) || null }
            : q
        ))
        toast.success('Cotización actualizada')
        resetForm()
      }
    })
  }

  const startEdit = (q: Quote) => {
    setForm({
      description: q.description || '',
      total_price: String(q.total_price),
      estimated_cost: String(q.estimated_cost || ''),
      valid_days: String(q.valid_days || 15),
    })
    setEditingId(q.id)
    setShowForm(false)
  }

  // ── Line item handlers ──
  const addLineItem = () => setLineItems(prev => [...prev, newLineItem()])
  const removeLineItem = (id: string) => {
    if (lineItems.length <= 1) return
    setLineItems(prev => prev.filter(li => li.id !== id))
  }
  const updateLineItem = (id: string, field: keyof LineItem, value: string | number) => {
    setLineItems(prev => prev.map(li => li.id === id ? { ...li, [field]: value } : li))
  }

  const ACTION_CONFIG: Record<AccionCotizacion, { icon: typeof Send; label: string; color: string }> = {
    send: { icon: Send, label: 'Enviar', color: 'text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/30' },
    accept: { icon: Check, label: 'Aceptar', color: 'text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30' },
    reject: { icon: X, label: 'Rechazar', color: 'text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30' },
    reopen: { icon: RotateCcw, label: 'Reabrir', color: 'text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/30' },
    duplicate: { icon: Copy, label: 'Duplicar', color: 'text-muted-foreground hover:bg-accent' },
    edit: { icon: Pencil, label: 'Editar', color: 'text-muted-foreground hover:bg-accent' },
    view: { icon: FileText, label: 'Ver', color: 'text-muted-foreground hover:bg-accent' },
  }

  return (
    <div className="space-y-4">
      {/* Header + New button */}
      <div className="flex items-center justify-between">
        <h3 className="font-semibold">Cotizaciones</h3>
        {!showForm && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => { resetForm(); setFormMode('quick'); setShowForm(true) }}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-3.5 w-3.5" /> Rápida
            </button>
            <button
              onClick={() => { resetForm(); setFormMode('detailed'); setShowForm(true) }}
              className="flex items-center gap-1.5 rounded-lg border border-primary px-3 py-1.5 text-xs font-medium text-primary hover:bg-primary/5"
            >
              <FileText className="h-3.5 w-3.5" /> Detallada
            </button>
          </div>
        )}
      </div>

      {/* New quote form */}
      {showForm && (
        <div className="space-y-3 rounded-lg border bg-muted/30 p-4">
          {/* Mode toggle */}
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">
              {formMode === 'quick' ? 'Cotización rápida' : 'Cotización detallada'}
            </p>
            <button
              onClick={() => setFormMode(formMode === 'quick' ? 'detailed' : 'quick')}
              className="text-[10px] text-primary hover:underline"
            >
              Cambiar a {formMode === 'quick' ? 'detallada' : 'rápida'}
            </button>
          </div>

          {formMode === 'quick' ? (
            /* Quick mode — same as before */
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="text-xs text-muted-foreground">Descripción</label>
                <input type="text" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="Ej: Diseño de marca completo" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Precio total *</label>
                <input type="number" value={form.total_price} onChange={e => setForm({ ...form, total_price: e.target.value })} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="0" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Costo estimado</label>
                <input type="number" value={form.estimated_cost} onChange={e => setForm({ ...form, estimated_cost: e.target.value })} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="0" />
              </div>
            </div>
          ) : (
            /* Detailed mode — line items */
            <div className="space-y-3">
              <div className="space-y-2">
                <div className="grid grid-cols-[1fr_80px_120px_32px] gap-2 text-[10px] font-medium text-muted-foreground">
                  <span>Descripción</span>
                  <span className="text-center">Cant.</span>
                  <span className="text-right">Precio unit.</span>
                  <span></span>
                </div>
                {lineItems.map(li => (
                  <div key={li.id} className="grid grid-cols-[1fr_80px_120px_32px] gap-2">
                    <input
                      type="text"
                      value={li.description}
                      onChange={e => updateLineItem(li.id, 'description', e.target.value)}
                      className="rounded-md border bg-background px-2 py-1.5 text-sm"
                      placeholder="Ítem..."
                    />
                    <input
                      type="number"
                      min="1"
                      value={li.quantity || ''}
                      onChange={e => updateLineItem(li.id, 'quantity', Number(e.target.value) || 1)}
                      className="rounded-md border bg-background px-2 py-1.5 text-center text-sm"
                    />
                    <input
                      type="number"
                      value={li.unit_price || ''}
                      onChange={e => updateLineItem(li.id, 'unit_price', Number(e.target.value) || 0)}
                      className="rounded-md border bg-background px-2 py-1.5 text-right text-sm"
                      placeholder="0"
                    />
                    <button
                      onClick={() => removeLineItem(li.id)}
                      disabled={lineItems.length <= 1}
                      className="flex items-center justify-center rounded-md hover:bg-accent disabled:opacity-30"
                    >
                      <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addLineItem}
                  className="flex items-center gap-1 text-xs text-primary hover:underline"
                >
                  <Plus className="h-3 w-3" /> Agregar ítem
                </button>
              </div>
              {/* Total + cost */}
              <div className="flex items-center justify-between rounded-md bg-primary/5 px-3 py-2">
                <span className="text-sm font-medium">Total</span>
                <span className="text-sm font-bold">{fmt(lineItemsTotal)}</span>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">Costo estimado (opcional)</label>
                <input type="number" value={form.estimated_cost} onChange={e => setForm({ ...form, estimated_cost: e.target.value })} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" placeholder="0" />
              </div>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button onClick={resetForm} className="flex items-center gap-1 rounded-md border px-3 py-1.5 text-xs hover:bg-accent">
              <X className="h-3 w-3" /> Cancelar
            </button>
            <button onClick={handleCreate} disabled={isPending} className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
              <Check className="h-3 w-3" /> Crear borrador
            </button>
          </div>
        </div>
      )}

      {/* Quotes list */}
      {quotes.length === 0 && !showForm ? (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <FileText className="mx-auto h-8 w-8 text-muted-foreground/30" />
          <p className="mt-2 text-sm text-muted-foreground">Aún no hay cotizaciones.</p>
          <p className="text-xs text-muted-foreground">Crea una cotización rápida o detallada para empezar.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {quotes.map(q => {
            const status = q.status as EstadoCotizacion
            const actions = getAccionesDisponibles(status).filter(a => a !== 'view')
            const isExpanded = expandedId === q.id
            const isEditMode = editingId === q.id
            const margin = q.total_price > 0 && q.estimated_cost
              ? Math.round(((q.total_price - q.estimated_cost) / q.total_price) * 100)
              : null
            const isDetailed = q.mode === 'detailed'

            return (
              <div key={q.id} className="rounded-lg border">
                {/* Quote header */}
                <div
                  className="flex items-center gap-3 p-3 cursor-pointer hover:bg-accent/30"
                  onClick={() => setExpandedId(isExpanded ? null : q.id)}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${getEstadoBadgeColor(status)}`}>
                        {ESTADO_LABELS[status]}
                      </span>
                      {isDetailed && (
                        <span className="shrink-0 rounded-full bg-purple-100 px-1.5 py-0.5 text-[9px] font-medium text-purple-700 dark:bg-purple-900/30 dark:text-purple-300">
                          Detallada
                        </span>
                      )}
                      <p className="text-sm font-medium truncate">{q.description?.split('\n')[0] || 'Cotización'}</p>
                    </div>
                    <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="flex items-center gap-0.5">
                        <DollarSign className="h-3 w-3" /> {fmt(q.total_price)}
                      </span>
                      {margin !== null && <span>Margen: {margin}%</span>}
                      <span>{new Date(q.created_at).toLocaleDateString('es-CO')}</span>
                    </div>
                  </div>
                  {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </div>

                {/* Expanded content */}
                {isExpanded && (
                  <div className="border-t p-3 space-y-3">
                    {/* Edit mode */}
                    {isEditMode ? (
                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="col-span-2">
                            <label className="text-xs text-muted-foreground">Descripción</label>
                            <textarea value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" rows={3} />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Precio</label>
                            <input type="number" value={form.total_price} onChange={e => setForm({ ...form, total_price: e.target.value })} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" />
                          </div>
                          <div>
                            <label className="text-xs text-muted-foreground">Costo estimado</label>
                            <input type="number" value={form.estimated_cost} onChange={e => setForm({ ...form, estimated_cost: e.target.value })} className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm" />
                          </div>
                        </div>
                        <div className="flex justify-end gap-2">
                          <button onClick={resetForm} className="text-xs text-muted-foreground hover:underline">Cancelar</button>
                          <button onClick={() => handleSaveEdit(q.id)} disabled={isPending} className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground">Guardar</button>
                        </div>
                      </div>
                    ) : (
                      <>
                        {/* Quote details */}
                        {isDetailed && q.description && (
                          <div className="space-y-1 rounded-md border p-3">
                            <p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Desglose</p>
                            {q.description.split('\n').map((line, i) => (
                              <p key={i} className="text-xs text-foreground">{line}</p>
                            ))}
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2 text-sm">
                          <div><span className="text-muted-foreground">Precio: </span><span className="font-medium">{fmt(q.total_price)}</span></div>
                          {q.estimated_cost && <div><span className="text-muted-foreground">Costo: </span><span className="font-medium">{fmt(q.estimated_cost)}</span></div>}
                          {q.net_amount && <div><span className="text-muted-foreground">Neto: </span><span className="font-medium">{fmt(q.net_amount)}</span></div>}
                          {q.valid_until && <div><span className="text-muted-foreground">Válida hasta: </span><span className="font-medium">{new Date(q.valid_until).toLocaleDateString('es-CO')}</span></div>}
                          {q.sent_at && <div><span className="text-muted-foreground">Enviada: </span><span className="font-medium">{new Date(q.sent_at).toLocaleDateString('es-CO')}</span></div>}
                          {q.accepted_at && <div><span className="text-muted-foreground">Aceptada: </span><span className="font-medium">{new Date(q.accepted_at).toLocaleDateString('es-CO')}</span></div>}
                        </div>
                        {!isDetailed && q.notes && <p className="text-xs text-muted-foreground bg-muted/50 rounded p-2">{q.notes}</p>}
                      </>
                    )}

                    {/* Actions */}
                    {!isEditMode && (
                      <div className="flex flex-wrap gap-1 pt-1 border-t">
                        {actions.map(action => {
                          const cfg = ACTION_CONFIG[action]
                          const Icon = cfg.icon

                          if (action === 'edit') {
                            if (!isEditable(status)) return null
                            return (
                              <button
                                key={action}
                                onClick={(e) => { e.stopPropagation(); startEdit(q) }}
                                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${cfg.color}`}
                              >
                                <Icon className="h-3 w-3" /> {cfg.label}
                              </button>
                            )
                          }

                          return (
                            <button
                              key={action}
                              onClick={(e) => { e.stopPropagation(); handleAction(q.id, action) }}
                              disabled={isPending}
                              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium ${cfg.color} disabled:opacity-50`}
                            >
                              <Icon className="h-3 w-3" /> {cfg.label}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
