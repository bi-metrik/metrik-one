'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Clock, Receipt, FileText, BarChart3, MessageSquare,
  Plus, Loader2, AlertTriangle, Check, Pause, Play, X, RotateCcw, Lock,
  Trash2, Search,
} from 'lucide-react'
import { toast } from 'sonner'
import { updateProjectStatus, addTimeEntry, addInvoice, recordPayment, deleteInvoice } from '../actions'
import { createExpense, getExpenseCategories } from '../../gastos/actions'
import type { Project, Expense, TimeEntry, Invoice, Payment, ExpenseCategory } from '@/types/database'
import NotesSection from '@/components/notes-section'

// ── Types ──────────────────────────────────────────────

type ProjectWithClient = Project & { clientName: string | null }
type ExpenseWithCat = Expense & { categoryName: string }

interface ProjectSummary {
  totalExpenses: number
  reworkExpenses: number
  totalHours: number
  totalInvoiced: number
  totalCollected: number
  pendingCollection: number
  budget: number
  marginPct: number
}

interface Props {
  project: ProjectWithClient
  expenses: ExpenseWithCat[]
  timeEntries: TimeEntry[]
  invoices: Invoice[]
  payments: Payment[]
  summary: ProjectSummary
}

// ── Formatters ─────────────────────────────────────────

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

const fmtDate = (d: string) => {
  const date = new Date(d + 'T12:00:00')
  return date.toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })
}

// ── Status config ──────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  active: { label: 'Activo', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', icon: Play },
  paused: { label: 'Pausado', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', icon: Pause },
  completed: { label: 'Completado', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', icon: Check },
  rework: { label: 'Reproceso', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400', icon: RotateCcw },
  cancelled: { label: 'Cancelado', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400', icon: X },
  closed: { label: 'Cerrado', color: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-400', icon: Lock },
}

type Tab = 'info' | 'hours' | 'expenses' | 'cobros' | 'budget' | 'notas'

// ── REWORK_REASONS (D178) ──────────────────────────────

const REWORK_REASONS = [
  'Error de ejecución',
  'Cambio de criterio del cliente',
  'Alcance mal definido',
  'Daño / deterioro',
  'Otro',
]

// ── Component ──────────────────────────────────────────

export default function ProjectDetailClient({
  project,
  expenses,
  timeEntries,
  invoices,
  payments,
  summary,
}: Props) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<Tab>('info')
  const [isPending, startTransition] = useTransition()

  // State forms
  const [showStatusModal, setShowStatusModal] = useState<string | null>(null)
  const [reworkReason, setReworkReason] = useState('')
  const [showAddTime, setShowAddTime] = useState(false)
  const [showAddInvoice, setShowAddInvoice] = useState(false)
  const [showRecordPayment, setShowRecordPayment] = useState<string | null>(null)

  // Time entry form
  const [timeHours, setTimeHours] = useState('')
  const [timeActivity, setTimeActivity] = useState('')

  // Invoice form
  const [invConcept, setInvConcept] = useState('')
  const [invAmount, setInvAmount] = useState('')
  const [invDate, setInvDate] = useState('')

  // Payment form
  const [payAmount, setPayAmount] = useState('')

  // Cobros tab: search + filter
  const [cobrosSearch, setCobrosSearch] = useState('')
  const [cobrosFilter, setCobrosFilter] = useState<'all' | 'scheduled' | 'partial' | 'collected'>('all')

  const status = STATUS_CONFIG[project.status] || STATUS_CONFIG.active
  const StatusIcon = status.icon

  const handleAmountChange = (raw: string, setter: (v: string) => void) => {
    const digits = raw.replace(/[^0-9]/g, '')
    if (!digits) { setter(''); return }
    setter(parseInt(digits, 10).toLocaleString('es-CO'))
  }

  // ── Status transitions ──

  const handleStatusChange = (newStatus: string) => {
    if (newStatus === 'rework') {
      setShowStatusModal('rework')
      return
    }

    startTransition(async () => {
      const result = await updateProjectStatus(project.id, newStatus as any)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`Proyecto → ${STATUS_CONFIG[newStatus]?.label || newStatus}`)
      router.refresh()
    })
  }

  const handleReworkSubmit = () => {
    if (!reworkReason) {
      toast.error('Selecciona la razón del reproceso')
      return
    }
    startTransition(async () => {
      const result = await updateProjectStatus(project.id, 'rework', reworkReason)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Proyecto en reproceso')
      setShowStatusModal(null)
      router.refresh()
    })
  }

  // ── Add time entry ──

  const handleAddTime = () => {
    const hours = parseFloat(timeHours)
    if (!hours || hours <= 0) {
      toast.error('Ingresa las horas')
      return
    }
    startTransition(async () => {
      const result = await addTimeEntry({
        projectId: project.id,
        hours,
        activity: timeActivity || undefined,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success(`${hours}h registradas`)
      setShowAddTime(false)
      setTimeHours('')
      setTimeActivity('')
      router.refresh()
    })
  }

  // ── Add invoice (cobro programado) ──

  const handleAddInvoice = () => {
    const amount = parseInt(invAmount.replace(/[^0-9]/g, ''), 10)
    if (!invConcept.trim()) {
      toast.error('Agrega un concepto')
      return
    }
    if (!amount || amount <= 0) {
      toast.error('Agrega un monto')
      return
    }
    startTransition(async () => {
      const result = await addInvoice({
        projectId: project.id,
        concept: invConcept,
        grossAmount: amount,
        dueDate: invDate || undefined,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Cobro programado')
      setShowAddInvoice(false)
      setInvConcept('')
      setInvAmount('')
      setInvDate('')
      router.refresh()
    })
  }

  // ── Record payment ──

  const handleRecordPayment = () => {
    const amount = parseInt(payAmount.replace(/[^0-9]/g, ''), 10)
    if (!amount || amount <= 0) {
      toast.error('¿Cuánto te consignaron?')
      return
    }
    startTransition(async () => {
      const result = await recordPayment({
        invoiceId: showRecordPayment!,
        netReceived: amount,
      })
      if (!result.success) {
        toast.error(result.error)
        return
      }
      if (result.retentionWarning) {
        toast.warning(result.retentionWarning)
      }
      toast.success('Pago registrado')
      setShowRecordPayment(null)
      setPayAmount('')
      router.refresh()
    })
  }

  // ── Delete invoice ──

  const handleDeleteInvoice = (invoiceId: string) => {
    startTransition(async () => {
      const result = await deleteInvoice(invoiceId)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      toast.success('Cobro eliminado')
      router.refresh()
    })
  }

  // ── Status action buttons ──

  const statusActions: { label: string; target: string; variant: 'default' | 'warning' | 'danger' }[] = []

  if (project.status === 'active') {
    statusActions.push(
      { label: 'Pausar', target: 'paused', variant: 'warning' },
      { label: 'Completar', target: 'completed', variant: 'default' },
    )
  } else if (project.status === 'paused') {
    statusActions.push(
      { label: 'Reanudar', target: 'active', variant: 'default' },
    )
  } else if (project.status === 'completed') {
    statusActions.push(
      { label: 'Reabrir', target: 'active', variant: 'default' },
      { label: 'Reproceso', target: 'rework', variant: 'warning' },
      { label: 'Cerrar', target: 'closed', variant: 'danger' },
    )
  } else if (project.status === 'rework') {
    statusActions.push(
      { label: 'Completar', target: 'completed', variant: 'default' },
    )
  }

  const TABS: { key: Tab; label: string; icon: React.ElementType }[] = [
    { key: 'info', label: 'Info', icon: FileText },
    { key: 'hours', label: 'Horas', icon: Clock },
    { key: 'expenses', label: 'Gastos', icon: Receipt },
    { key: 'cobros', label: 'Cobros', icon: FileText },
    { key: 'budget', label: 'Presupuesto', icon: BarChart3 },
    { key: 'notas', label: 'Notas', icon: MessageSquare },
  ]

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link
          href="/proyectos"
          className="mt-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          {project.clientName && (
            <p className="text-sm text-muted-foreground">{project.clientName}</p>
          )}
          <h1 className="text-2xl font-bold truncate">{project.name}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${status.color}`}>
              <StatusIcon className="h-3.5 w-3.5" />
              {status.label}
            </span>
            {project.approved_budget && (
              <span className="text-sm text-muted-foreground">
                Presupuesto: {fmt(project.approved_budget)}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* D181: Rework banner */}
      {project.status === 'rework' && (
        <div className="flex items-start gap-3 rounded-lg border border-orange-200 bg-orange-50/50 px-4 py-3 dark:border-orange-900/30 dark:bg-orange-950/10">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-orange-600" />
          <div>
            <p className="text-sm font-medium text-orange-800 dark:text-orange-200">
              Proyecto en reproceso
            </p>
            <p className="text-xs text-orange-700 dark:text-orange-300">
              {project.rework_reason || 'Los costos adicionales se separan para ver el impacto real.'}
            </p>
          </div>
        </div>
      )}

      {/* Status actions */}
      {statusActions.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {statusActions.map((action) => (
            <button
              key={action.target}
              onClick={() => handleStatusChange(action.target)}
              disabled={isPending}
              className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 ${
                action.variant === 'danger'
                  ? 'border border-destructive text-destructive hover:bg-destructive/10'
                  : action.variant === 'warning'
                  ? 'border border-yellow-500 text-yellow-700 hover:bg-yellow-50 dark:text-yellow-400 dark:hover:bg-yellow-950/20'
                  : 'border border-input hover:bg-accent'
              }`}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Gastos</p>
          <p className="mt-1 text-lg font-bold">{fmt(summary.totalExpenses)}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Horas</p>
          <p className="mt-1 text-lg font-bold">{summary.totalHours.toFixed(1)}h</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Cobrado</p>
          <p className="mt-1 text-lg font-bold">{fmt(summary.totalCollected)}</p>
        </div>
        <div className="rounded-lg border bg-card p-3">
          <p className="text-xs text-muted-foreground">Margen</p>
          <p className={`mt-1 text-lg font-bold ${summary.marginPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
            {summary.marginPct.toFixed(1)}%
          </p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 rounded-lg border bg-muted/50 p-1">
        {TABS.map((tab) => {
          const TabIcon = tab.icon
          return (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-2 text-xs font-medium transition-colors ${
                activeTab === tab.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              <TabIcon className="h-3.5 w-3.5" />
              {tab.label}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      <div className="space-y-4">
        {/* ── Info Tab ── */}
        {activeTab === 'info' && (
          <div className="space-y-3">
            <div className="rounded-lg border p-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-muted-foreground">Cliente</p>
                  <p className="font-medium">{project.clientName || 'Sin cliente'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Estado</p>
                  <p className="font-medium">{status.label}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Presupuesto</p>
                  <p className="font-medium">{project.approved_budget ? fmt(project.approved_budget) : '—'}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Creado</p>
                  <p className="font-medium">{fmtDate((project.created_at ?? '').split('T')[0])}</p>
                </div>
                {project.rework_reason && (
                  <div className="col-span-2">
                    <p className="text-muted-foreground">Razón reproceso</p>
                    <p className="font-medium">{project.rework_reason}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Hours Tab ── */}
        {activeTab === 'hours' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Total: <span className="font-medium text-foreground">{summary.totalHours.toFixed(1)}h</span>
              </p>
              <button
                onClick={() => setShowAddTime(!showAddTime)}
                className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-3.5 w-3.5" />
                Registrar horas
              </button>
            </div>

            {showAddTime && (
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                <div className="flex gap-3">
                  <input
                    type="number"
                    step="0.5"
                    min="0.5"
                    placeholder="Horas (ej: 2.5)"
                    value={timeHours}
                    onChange={(e) => setTimeHours(e.target.value)}
                    className="flex h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <input
                    type="text"
                    placeholder="Actividad (opcional)"
                    value={timeActivity}
                    onChange={(e) => setTimeActivity(e.target.value)}
                    className="flex h-10 flex-1 rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddTime()}
                  />
                </div>
                <button
                  onClick={handleAddTime}
                  disabled={isPending}
                  className="flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                >
                  {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Registrar'}
                </button>
              </div>
            )}

            {timeEntries.length > 0 ? (
              <div className="space-y-2">
                {timeEntries.map((te) => (
                  <div key={te.id} className="flex items-center gap-3 rounded-lg border p-3">
                    <Clock className="h-4 w-4 text-muted-foreground" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">{te.hours}h</p>
                      {te.activity && <p className="text-xs text-muted-foreground">{te.activity}</p>}
                    </div>
                    <p className="text-xs text-muted-foreground">{fmtDate(te.entry_date)}</p>
                  </div>
                ))}
              </div>
            ) : !showAddTime && (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <Clock className="mx-auto h-8 w-8 text-muted-foreground/30" />
                <p className="mt-2 text-sm text-muted-foreground">Sin horas registradas</p>
              </div>
            )}
          </div>
        )}

        {/* ── Expenses Tab ── */}
        {activeTab === 'expenses' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">
                Total: <span className="font-medium text-foreground">{fmt(summary.totalExpenses)}</span>
                {summary.reworkExpenses > 0 && (
                  <span className="ml-2 text-orange-600">(Reproceso: {fmt(summary.reworkExpenses)})</span>
                )}
              </p>
            </div>

            {expenses.length > 0 ? (
              <div className="space-y-2">
                {expenses.map((exp) => (
                  <div key={exp.id} className={`flex items-center gap-3 rounded-lg border p-3 ${exp.is_rework ? 'border-orange-200 bg-orange-50/30 dark:border-orange-900/20 dark:bg-orange-950/10' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium">{fmt(exp.amount)}</p>
                        {exp.is_rework && (
                          <span className="rounded-full bg-orange-100 px-2 py-0.5 text-[10px] font-medium text-orange-700 dark:bg-orange-900/30 dark:text-orange-400">
                            Reproceso
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground truncate">
                        {exp.categoryName}{exp.description ? ` — ${exp.description}` : ''}
                      </p>
                    </div>
                    <p className="text-xs text-muted-foreground">{fmtDate(exp.expense_date)}</p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-8 text-center">
                <Receipt className="mx-auto h-8 w-8 text-muted-foreground/30" />
                <p className="mt-2 text-sm text-muted-foreground">
                  Sin gastos directos. Usa el FAB + para registrar gastos de este proyecto.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Cobros Tab — Full Facturacion (Sprint F) ── */}
        {activeTab === 'cobros' && (() => {
          const totalRetentions = payments.reduce((s, p) => s + (p.retention_applied || 0), 0)
          const now = new Date()

          // Filter invoices by search + status
          const filteredInvoices = invoices.filter(inv => {
            if (cobrosFilter !== 'all' && inv.status !== cobrosFilter) return false
            if (cobrosSearch) {
              const q = cobrosSearch.toLowerCase()
              const matchConcept = inv.concept?.toLowerCase().includes(q)
              const matchNumber = inv.invoice_number?.toLowerCase().includes(q)
              if (!matchConcept && !matchNumber) return false
            }
            return true
          })

          return (
            <div className="space-y-4">
              {/* Stats cards */}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Facturado</p>
                  <p className="mt-0.5 text-lg font-bold">{fmt(summary.totalInvoiced)}</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Cobrado</p>
                  <p className="mt-0.5 text-lg font-bold text-green-600">{fmt(summary.totalCollected)}</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Pendiente</p>
                  <p className="mt-0.5 text-lg font-bold text-orange-600">{fmt(summary.pendingCollection)}</p>
                </div>
                <div className="rounded-lg border bg-card p-3">
                  <p className="text-[10px] text-muted-foreground uppercase tracking-wider">Retenciones</p>
                  <p className="mt-0.5 text-lg font-bold text-red-500">{fmt(totalRetentions)}</p>
                </div>
              </div>

              {/* Add invoice button + form */}
              <div className="flex items-center justify-between">
                <div />
                <button
                  onClick={() => setShowAddInvoice(!showAddInvoice)}
                  className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Programar cobro
                </button>
              </div>

              {showAddInvoice && (
                <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                  <input
                    type="text"
                    placeholder="Concepto (ej: Anticipo 50%)"
                    value={invConcept}
                    onChange={(e) => setInvConcept(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  <div className="flex gap-3">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        placeholder="Monto bruto"
                        value={invAmount}
                        onChange={(e) => handleAmountChange(e.target.value, setInvAmount)}
                        className="flex h-10 w-full rounded-lg border border-input bg-background pl-7 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      />
                    </div>
                    <input
                      type="date"
                      value={invDate}
                      onChange={(e) => setInvDate(e.target.value)}
                      className="flex h-10 rounded-lg border border-input bg-background px-3 text-sm"
                    />
                  </div>
                  <button
                    onClick={handleAddInvoice}
                    disabled={isPending}
                    className="flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Programar cobro'}
                  </button>
                </div>
              )}

              {/* Search + filter pills */}
              {invoices.length > 0 && (
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="relative flex-1 max-w-xs">
                    <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <input
                      type="text"
                      placeholder="Buscar por concepto o numero..."
                      value={cobrosSearch}
                      onChange={(e) => setCobrosSearch(e.target.value)}
                      className="flex h-9 w-full rounded-lg border border-input bg-background pl-9 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                  </div>
                  <div className="flex gap-1.5">
                    {([
                      { key: 'all', label: 'Todos' },
                      { key: 'scheduled', label: 'Pendientes' },
                      { key: 'partial', label: 'Parciales' },
                      { key: 'collected', label: 'Cobrados' },
                    ] as const).map(f => (
                      <button
                        key={f.key}
                        onClick={() => setCobrosFilter(f.key)}
                        className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                          cobrosFilter === f.key
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-muted-foreground hover:bg-accent'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Invoice list */}
              {filteredInvoices.length > 0 ? (
                <div className="space-y-2">
                  {filteredInvoices.map((inv) => {
                    const invPayments = payments.filter(p => p.invoice_id === inv.id)
                    const collected = invPayments.reduce((s, p) => s + p.net_received, 0)
                    const isCollected = inv.status === 'collected'
                    const isOverdue = !isCollected && inv.due_date && new Date(inv.due_date + 'T23:59:59') < now

                    return (
                      <div key={inv.id} className={`rounded-lg border p-4 ${isCollected ? 'bg-green-50/30 dark:bg-green-950/10' : ''}`}>
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              {inv.invoice_number && (
                                <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono font-medium text-muted-foreground">
                                  {inv.invoice_number}
                                </span>
                              )}
                              <p className="text-sm font-medium truncate">{inv.concept}</p>
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              Bruto: {fmt(inv.gross_amount)}
                              {inv.due_date && ` · Vence: ${fmtDate(inv.due_date)}`}
                            </p>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isOverdue && (
                              <span className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                                Vencida
                              </span>
                            )}
                            <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                              isCollected
                                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                                : inv.status === 'partial'
                                ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400'
                                : 'bg-muted text-muted-foreground'
                            }`}>
                              {isCollected ? 'Cobrado' : inv.status === 'partial' ? 'Parcial' : 'Pendiente'}
                            </span>
                            {/* Delete button — only for scheduled */}
                            {inv.status === 'scheduled' && (
                              <button
                                onClick={() => handleDeleteInvoice(inv.id)}
                                disabled={isPending}
                                className="rounded-md p-1 text-muted-foreground/50 transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950/20 disabled:opacity-50"
                                title="Eliminar cobro"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                        </div>

                        {/* Payments list */}
                        {invPayments.length > 0 && (
                          <div className="mt-3 space-y-1 border-t pt-2">
                            {invPayments.map((pay) => (
                              <div key={pay.id} className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">
                                  {fmtDate(pay.payment_date)}
                                  {pay.retention_applied > 0 && (
                                    <span className="ml-1 text-red-500">(ret: {fmt(pay.retention_applied)})</span>
                                  )}
                                </span>
                                <span className="font-medium text-green-600">+{fmt(pay.net_received)}</span>
                              </div>
                            ))}
                            {collected < inv.gross_amount * 0.9 && (
                              <p className="text-xs text-muted-foreground">
                                Falta: {fmt(inv.gross_amount - collected)}
                              </p>
                            )}
                          </div>
                        )}

                        {/* Record payment */}
                        {!isCollected && (
                          <>
                            {showRecordPayment === inv.id ? (
                              <div className="mt-3 flex gap-2">
                                <div className="relative flex-1">
                                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                                  <input
                                    type="text"
                                    inputMode="numeric"
                                    placeholder="Neto consignado"
                                    value={payAmount}
                                    onChange={(e) => handleAmountChange(e.target.value, setPayAmount)}
                                    className="flex h-9 w-full rounded-lg border border-input bg-background pl-6 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    onKeyDown={(e) => e.key === 'Enter' && handleRecordPayment()}
                                  />
                                </div>
                                <button
                                  onClick={handleRecordPayment}
                                  disabled={isPending}
                                  className="rounded-lg bg-green-600 px-3 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                                >
                                  {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Registrar'}
                                </button>
                                <button
                                  onClick={() => { setShowRecordPayment(null); setPayAmount('') }}
                                  className="rounded-lg border px-2 text-xs"
                                >
                                  <X className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setShowRecordPayment(inv.id)}
                                className="mt-3 text-xs font-medium text-primary hover:underline"
                              >
                                + Registrar pago
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    )
                  })}
                </div>
              ) : invoices.length > 0 ? (
                <div className="rounded-lg border border-dashed p-6 text-center">
                  <Search className="mx-auto h-6 w-6 text-muted-foreground/30" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    No hay cobros que coincidan con tu busqueda
                  </p>
                </div>
              ) : !showAddInvoice && (
                <div className="rounded-lg border border-dashed p-8 text-center">
                  <FileText className="mx-auto h-8 w-8 text-muted-foreground/30" />
                  <p className="mt-2 text-sm text-muted-foreground">
                    Sin cobros programados. Programa cuando te van a pagar.
                  </p>
                </div>
              )}
            </div>
          )
        })()}

        {/* ── Notas Tab (F19) ── */}
        {activeTab === 'notas' && (
          <div className="rounded-xl border bg-card p-6">
            <NotesSection
              entityType="project"
              entityId={project.id}
              {...(project.opportunity_id ? {
                inheritedFrom: {
                  entityType: 'opportunity',
                  entityId: project.opportunity_id,
                  label: 'Oportunidad',
                }
              } : {})}
            />
          </div>
        )}

        {/* ── Budget vs Real Tab (D88 + F13) ── */}
        {activeTab === 'budget' && (
          <div className="space-y-4">
            <div className="rounded-lg border p-4">
              <h3 className="font-semibold mb-4">Presupuesto vs Real</h3>
              <div className="space-y-4">
                {/* Budget bar */}
                <BudgetBar label="Presupuesto" value={summary.budget} max={summary.budget} color="bg-primary" />
                <BudgetBar
                  label="Gastos ejecutados"
                  value={summary.totalExpenses}
                  max={summary.budget}
                  color={summary.budget > 0 && summary.totalExpenses > summary.budget ? 'bg-red-500' : 'bg-green-500'}
                />
                {summary.reworkExpenses > 0 && (
                  <BudgetBar label="Costos reproceso" value={summary.reworkExpenses} max={summary.budget} color="bg-orange-500" labelColor="text-orange-600" />
                )}
                <BudgetBar label="Cobrado" value={summary.totalCollected} max={summary.budget} color="bg-green-500" valueColor="text-green-600" />
              </div>

              {/* D180: Margin comparison */}
              <div className="mt-6 grid grid-cols-2 gap-4 rounded-lg bg-muted/50 p-4">
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Margen presupuestado</p>
                  <p className="mt-1 text-xl font-bold">{summary.budget > 0 ? '100%' : '—'}</p>
                </div>
                <div className="text-center">
                  <p className="text-xs text-muted-foreground">Margen real</p>
                  <p className={`mt-1 text-xl font-bold ${summary.marginPct >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                    {summary.marginPct.toFixed(1)}%
                  </p>
                </div>
              </div>
            </div>

            {/* F13: Category breakdown */}
            {expenses.length > 0 && (
              <div className="rounded-lg border p-4">
                <h3 className="font-semibold mb-3">Desglose por categoría</h3>
                <div className="space-y-2">
                  {(() => {
                    const catMap = new Map<string, number>()
                    for (const e of expenses) {
                      const cat = e.categoryName || 'Sin categoría'
                      catMap.set(cat, (catMap.get(cat) || 0) + e.amount)
                    }
                    const sorted = [...catMap.entries()].sort((a, b) => b[1] - a[1])
                    const maxCat = sorted[0]?.[1] || 0
                    return sorted.map(([cat, total]) => (
                      <div key={cat}>
                        <div className="flex justify-between text-xs mb-0.5">
                          <span className="text-muted-foreground">{cat}</span>
                          <span className="font-medium">{fmt(total)}</span>
                        </div>
                        <div className="h-2 rounded-full bg-muted">
                          <div
                            className="h-2 rounded-full bg-primary/60"
                            style={{ width: maxCat > 0 ? `${(total / maxCat) * 100}%` : '0%' }}
                          />
                        </div>
                      </div>
                    ))
                  })()}
                </div>
              </div>
            )}

            {/* F13: Fiscal overlay */}
            {summary.totalCollected > 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-4 dark:border-amber-900/30 dark:bg-amber-950/10">
                <h3 className="font-semibold text-sm mb-3 flex items-center gap-2">
                  <Receipt className="h-4 w-4 text-amber-600" />
                  Estimación fiscal
                </h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <p className="text-xs text-muted-foreground">Retefuente (~11%)</p>
                    <p className="font-medium text-red-600">{fmt(summary.totalCollected * 0.11)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Seg. social (~11.4%)</p>
                    <p className="font-medium text-red-600">{fmt(summary.totalCollected * 0.4 * 0.285)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Neto estimado</p>
                    <p className="font-medium text-green-600">
                      {fmt(summary.totalCollected - (summary.totalCollected * 0.11) - (summary.totalCollected * 0.4 * 0.285))}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Margen neto</p>
                    <p className={`font-medium ${
                      summary.totalCollected > 0
                        ? ((summary.totalCollected - (summary.totalCollected * 0.11) - (summary.totalCollected * 0.4 * 0.285) - summary.totalExpenses) / summary.totalCollected * 100) >= 0
                          ? 'text-green-600' : 'text-red-600'
                        : ''
                    }`}>
                      {summary.totalCollected > 0
                        ? `${((summary.totalCollected - (summary.totalCollected * 0.11) - (summary.totalCollected * 0.4 * 0.285) - summary.totalExpenses) / summary.totalCollected * 100).toFixed(1)}%`
                        : '—'}
                    </p>
                  </div>
                </div>
                <p className="mt-2 text-[10px] text-muted-foreground">
                  * Estimación conservadora. Consulta configuración fiscal para tu caso.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Rework reason modal */}
      {showStatusModal === 'rework' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl border bg-background p-6 shadow-xl">
            <h3 className="text-lg font-semibold">Razón del reproceso</h3>
            <p className="mt-1 text-sm text-muted-foreground">D178: ¿Por qué necesitas rehacer trabajo?</p>
            <div className="mt-4 space-y-2">
              {REWORK_REASONS.map((reason) => (
                <button
                  key={reason}
                  onClick={() => setReworkReason(reason)}
                  className={`flex w-full rounded-lg border px-4 py-3 text-left text-sm font-medium transition-colors ${
                    reworkReason === reason
                      ? 'border-primary bg-primary/5 text-primary'
                      : 'border-input hover:bg-accent'
                  }`}
                >
                  {reason}
                </button>
              ))}
            </div>
            <div className="mt-6 flex gap-3">
              <button
                onClick={() => setShowStatusModal(null)}
                className="flex h-10 flex-1 items-center justify-center rounded-lg border text-sm font-medium hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                onClick={handleReworkSubmit}
                disabled={isPending || !reworkReason}
                className="flex h-10 flex-1 items-center justify-center rounded-lg bg-orange-600 text-sm font-medium text-white hover:bg-orange-700 disabled:opacity-50"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Confirmar reproceso'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function BudgetBar({
  label, value, max, color, labelColor, valueColor,
}: {
  label: string; value: number; max: number; color: string
  labelColor?: string; valueColor?: string
}) {
  return (
    <div>
      <div className="flex justify-between text-sm mb-1">
        <span className={labelColor || 'text-muted-foreground'}>{label}</span>
        <span className={`font-medium ${valueColor || ''}`}>{fmt(value)}</span>
      </div>
      <div className="h-3 rounded-full bg-muted">
        <div
          className={`h-3 rounded-full ${color}`}
          style={{ width: max > 0 ? `${Math.min(100, (value / max) * 100)}%` : (label === 'Presupuesto' ? '100%' : '0%') }}
        />
      </div>
    </div>
  )
}
