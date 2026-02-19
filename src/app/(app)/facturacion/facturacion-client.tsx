'use client'

import { useState, useTransition } from 'react'
import {
  Plus, FileText, DollarSign, Clock, Check, X,
  Search, Filter, Loader2, Trash2, Receipt, Download,
} from 'lucide-react'
import { toast } from 'sonner'
import { createInvoice, markInvoicePaid, deleteInvoice } from './actions'
import CuentaCobroPdf from './cuenta-cobro-pdf'
import type { Invoice, Payment } from '@/types/database'

interface Props {
  invoices: Invoice[]
  payments: Payment[]
  projects: { id: string; name: string; client_id: string | null }[]
  clients: { id: string; name: string }[]
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

const fmtDate = (d: string) => {
  const date = new Date(d + 'T12:00:00')
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  scheduled: { label: 'Pendiente', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300' },
  partial: { label: 'Parcial', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300' },
  collected: { label: 'Cobrado', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' },
}

export default function FacturacionClient({ invoices: initialInvoices, payments: initialPayments, projects, clients }: Props) {
  const [invoices, setInvoices] = useState(initialInvoices)
  const [payments, setPayments] = useState(initialPayments)
  const [isPending, startTransition] = useTransition()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [showCreate, setShowCreate] = useState(false)
  const [payingInvoice, setPayingInvoice] = useState<string | null>(null)
  const [payAmount, setPayAmount] = useState('')
  const [pdfInvoice, setPdfInvoice] = useState<Invoice | null>(null)

  // Create form
  const [formProject, setFormProject] = useState('')
  const [formConcept, setFormConcept] = useState('')
  const [formAmount, setFormAmount] = useState('')
  const [formDueDate, setFormDueDate] = useState('')

  // Stats
  const totalInvoiced = invoices.reduce((s, i) => s + i.gross_amount, 0)
  const totalCollected = payments.reduce((s, p) => s + p.net_received, 0)
  const totalRetentions = payments.reduce((s, p) => s + (p.retention_applied || 0), 0)
  const pendingInvoices = invoices.filter(i => i.status === 'scheduled' || i.status === 'partial')
  const pendingAmount = pendingInvoices.reduce((s, i) => s + i.gross_amount, 0)

  // Filtered list
  const filtered = invoices.filter(inv => {
    if (statusFilter !== 'all' && inv.status !== statusFilter) return false
    if (search) {
      const projectName = projects.find(p => p.id === inv.project_id)?.name || ''
      const q = search.toLowerCase()
      return inv.concept.toLowerCase().includes(q) ||
        projectName.toLowerCase().includes(q) ||
        (inv.invoice_number || '').toLowerCase().includes(q)
    }
    return true
  })

  const handleAmountChange = (raw: string, setter: (v: string) => void) => {
    const digits = raw.replace(/[^0-9]/g, '')
    if (!digits) { setter(''); return }
    setter(parseInt(digits, 10).toLocaleString('es-CO'))
  }

  const handleCreate = () => {
    if (!formProject) { toast.error('Selecciona un proyecto'); return }
    if (!formConcept.trim()) { toast.error('Agrega un concepto'); return }
    const amount = parseInt(formAmount.replace(/[^0-9]/g, ''), 10)
    if (!amount || amount <= 0) { toast.error('Agrega un monto'); return }

    startTransition(async () => {
      const res = await createInvoice({
        project_id: formProject,
        concept: formConcept,
        gross_amount: amount,
        due_date: formDueDate || undefined,
      })
      if (res.success && res.invoice) {
        setInvoices(prev => [res.invoice, ...prev])
        setShowCreate(false)
        setFormProject('')
        setFormConcept('')
        setFormAmount('')
        setFormDueDate('')
        toast.success('Cobro programado')
      } else {
        toast.error(res.error)
      }
    })
  }

  const handlePay = (invoiceId: string) => {
    const amount = parseInt(payAmount.replace(/[^0-9]/g, ''), 10)
    if (!amount || amount <= 0) { toast.error('Ingresa el monto recibido'); return }

    startTransition(async () => {
      const res = await markInvoicePaid(invoiceId, { netReceived: amount })
      if (res.success) {
        toast.success('Pago registrado')
        if (res.retentionWarning) toast.warning(res.retentionWarning)
        // Optimistic update
        const inv = invoices.find(i => i.id === invoiceId)
        if (inv) {
          const existingPayments = payments.filter(p => p.invoice_id === invoiceId)
          const totalCol = existingPayments.reduce((s, p) => s + p.net_received, 0) + amount
          const newStatus = totalCol >= inv.gross_amount * 0.9 ? 'collected' : 'partial'
          setInvoices(prev => prev.map(i => i.id === invoiceId ? { ...i, status: newStatus } : i))
          setPayments(prev => [{
            id: crypto.randomUUID(),
            workspace_id: '',
            invoice_id: invoiceId,
            net_received: amount,
            payment_date: new Date().toISOString().split('T')[0],
            payment_method: 'transfer',
            retention_applied: inv.gross_amount - amount,
            source: 'app',
            reference: null,
            created_at: new Date().toISOString(),
          }, ...prev])
        }
        setPayingInvoice(null)
        setPayAmount('')
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleDelete = (invoiceId: string) => {
    if (!confirm('¿Eliminar este cobro programado?')) return
    startTransition(async () => {
      const res = await deleteInvoice(invoiceId)
      if (res.success) {
        setInvoices(prev => prev.filter(i => i.id !== invoiceId))
        toast.success('Cobro eliminado')
      } else {
        toast.error(res.error)
      }
    })
  }

  const getProjectName = (id: string) => projects.find(p => p.id === id)?.name || '—'
  const getClientForProject = (projectId: string) => {
    const proj = projects.find(p => p.id === projectId)
    if (!proj?.client_id) return '—'
    return clients.find(c => c.id === proj.client_id)?.name || '—'
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Facturación</h1>
          <p className="text-sm text-muted-foreground">Gestiona tus cobros y genera cuentas de cobro</p>
        </div>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Nuevo cobro
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Receipt className="h-3.5 w-3.5" /> Facturado
          </div>
          <p className="mt-1 text-xl font-bold">{fmt(totalInvoiced)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <DollarSign className="h-3.5 w-3.5" /> Cobrado
          </div>
          <p className="mt-1 text-xl font-bold text-green-600">{fmt(totalCollected)}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Clock className="h-3.5 w-3.5" /> Pendiente
          </div>
          <p className="mt-1 text-xl font-bold text-amber-600">{fmt(pendingAmount)}</p>
          <p className="text-[10px] text-muted-foreground">{pendingInvoices.length} cobro{pendingInvoices.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <FileText className="h-3.5 w-3.5" /> Retenciones
          </div>
          <p className="mt-1 text-xl font-bold text-red-500">{fmt(totalRetentions)}</p>
        </div>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-5 space-y-4">
          <h3 className="font-semibold">Programar cobro</h3>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">Proyecto *</label>
              <select
                value={formProject}
                onChange={e => setFormProject(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              >
                <option value="">Seleccionar...</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Concepto *</label>
              <input
                type="text"
                value={formConcept}
                onChange={e => setFormConcept(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
                placeholder="Ej: Anticipo 50%"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Monto bruto *</label>
              <div className="relative mt-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={formAmount}
                  onChange={e => handleAmountChange(e.target.value, setFormAmount)}
                  className="w-full rounded-md border bg-background pl-7 pr-3 py-2 text-sm"
                  placeholder="0"
                />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">Fecha de vencimiento</label>
              <input
                type="date"
                value={formDueDate}
                onChange={e => setFormDueDate(e.target.value)}
                className="mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <button onClick={() => setShowCreate(false)} className="rounded-lg border px-4 py-2 text-sm hover:bg-accent">
              Cancelar
            </button>
            <button
              onClick={handleCreate}
              disabled={isPending}
              className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              Programar
            </button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full rounded-lg border bg-background pl-9 pr-3 py-2 text-sm"
            placeholder="Buscar por concepto, proyecto..."
          />
        </div>
        <div className="flex gap-1">
          {[
            { value: 'all', label: 'Todos' },
            { value: 'scheduled', label: 'Pendientes' },
            { value: 'partial', label: 'Parciales' },
            { value: 'collected', label: 'Cobrados' },
          ].map(opt => (
            <button
              key={opt.value}
              onClick={() => setStatusFilter(opt.value)}
              className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                statusFilter === opt.value
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Invoice list */}
      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-8 text-center">
          <Receipt className="mx-auto h-10 w-10 text-muted-foreground/30" />
          <p className="mt-2 text-sm text-muted-foreground">
            {invoices.length === 0 ? 'No has programado cobros aún.' : 'No hay resultados con ese filtro.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(inv => {
            const invPayments = payments.filter(p => p.invoice_id === inv.id)
            const collected = invPayments.reduce((s, p) => s + p.net_received, 0)
            const statusConf = STATUS_CONFIG[inv.status] || STATUS_CONFIG.scheduled
            const isOverdue = inv.due_date && new Date(inv.due_date) < new Date() && inv.status !== 'collected'

            return (
              <div key={inv.id} className={`rounded-xl border bg-card p-4 ${isOverdue ? 'border-red-200 dark:border-red-900/30' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium truncate">{inv.concept}</p>
                      <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${statusConf.color}`}>
                        {statusConf.label}
                      </span>
                      {isOverdue && (
                        <span className="shrink-0 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-300">
                          Vencido
                        </span>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <span>{getProjectName(inv.project_id)}</span>
                      <span>·</span>
                      <span>{getClientForProject(inv.project_id)}</span>
                      {inv.invoice_number && (
                        <>
                          <span>·</span>
                          <span className="font-mono">{inv.invoice_number}</span>
                        </>
                      )}
                      {inv.due_date && (
                        <>
                          <span>·</span>
                          <span>Vence: {fmtDate(inv.due_date)}</span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold">{fmt(inv.gross_amount)}</p>
                    {collected > 0 && (
                      <p className="text-xs text-green-600">Recibido: {fmt(collected)}</p>
                    )}
                  </div>
                </div>

                {/* Payment records */}
                {invPayments.length > 0 && (
                  <div className="mt-3 space-y-1 border-t pt-2">
                    {invPayments.map(pay => (
                      <div key={pay.id} className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{fmtDate(pay.payment_date)}</span>
                        <div className="flex gap-3">
                          <span className="text-green-600">+{fmt(pay.net_received)}</span>
                          {pay.retention_applied > 0 && (
                            <span className="text-red-500">-{fmt(pay.retention_applied)} ret.</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Pay form inline */}
                {payingInvoice === inv.id && (
                  <div className="mt-3 flex gap-2 border-t pt-3">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        value={payAmount}
                        onChange={e => handleAmountChange(e.target.value, setPayAmount)}
                        className="w-full rounded-lg border bg-background pl-6 pr-3 py-2 text-sm"
                        placeholder="Neto consignado"
                        onKeyDown={e => e.key === 'Enter' && handlePay(inv.id)}
                      />
                    </div>
                    <button
                      onClick={() => handlePay(inv.id)}
                      disabled={isPending}
                      className="rounded-lg bg-green-600 px-3 py-2 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                    >
                      {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Registrar'}
                    </button>
                    <button
                      onClick={() => { setPayingInvoice(null); setPayAmount('') }}
                      className="rounded-lg border px-2 hover:bg-accent"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                )}

                {/* Actions */}
                <div className="mt-3 flex flex-wrap gap-2 border-t pt-3">
                  {inv.status !== 'collected' && (
                    <button
                      onClick={() => setPayingInvoice(payingInvoice === inv.id ? null : inv.id)}
                      className="text-xs font-medium text-green-600 hover:underline"
                    >
                      + Registrar pago
                    </button>
                  )}
                  <button
                    onClick={() => setPdfInvoice(inv)}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Cuenta de cobro
                  </button>
                  {inv.status === 'scheduled' && (
                    <button
                      onClick={() => handleDelete(inv.id)}
                      className="text-xs font-medium text-red-500 hover:underline"
                    >
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* PDF Modal */}
      {pdfInvoice && (
        <CuentaCobroPdf
          invoice={{
            concept: pdfInvoice.concept,
            gross_amount: pdfInvoice.gross_amount,
            invoice_number: pdfInvoice.invoice_number,
          }}
          clientName={getClientForProject(pdfInvoice.project_id)}
          projectName={getProjectName(pdfInvoice.project_id)}
          onClose={() => setPdfInvoice(null)}
        />
      )}
    </div>
  )
}
