'use client'

import { useState, useTransition } from 'react'
import { Check, ChevronRight, Plus, Trash2, Loader2, AlertCircle, X } from 'lucide-react'
import { toast } from 'sonner'
import { createFixedExpense, deleteFixedExpense, toggleFixedExpense } from '../gastos/actions'
import type { ExpenseCategory, FixedExpense } from '@/types/database'

// ── Types ──────────────────────────────────────────────

type FixedExpenseWithCategory = FixedExpense & { categoryName: string | null }

interface ConfigChecklistItem {
  key: string
  label: string
  description: string
  status: 'complete' | 'partial' | 'pending'
  statusLabel: string
  href?: string
}

interface ConfigClientProps {
  checklist: ConfigChecklistItem[]
  fixedExpenses: FixedExpenseWithCategory[]
  categories: ExpenseCategory[]
  totalFixedExpenses: number
}

// ── Component ──────────────────────────────────────────

export default function ConfigClient({
  checklist: initialChecklist,
  fixedExpenses: initialFixedExpenses,
  categories,
  totalFixedExpenses: initialTotal,
}: ConfigClientProps) {
  const [activeSection, setActiveSection] = useState<string | null>(null)
  const [fixedExpenses, setFixedExpenses] = useState(initialFixedExpenses)
  const [totalFixed, setTotalFixed] = useState(initialTotal)

  // ── Fixed Expenses Section ──

  const [newDesc, setNewDesc] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newCatId, setNewCatId] = useState('')
  const [isPending, startTransition] = useTransition()
  const [showAddForm, setShowAddForm] = useState(false)

  const handleAmountChange = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '')
    if (!digits) { setNewAmount(''); return }
    const num = parseInt(digits, 10)
    setNewAmount(num.toLocaleString('es-CO'))
  }

  const handleAddFixed = () => {
    const value = parseInt(newAmount.replace(/[^0-9]/g, ''), 10)
    if (!newDesc.trim()) {
      toast.error('Agrega una descripción')
      return
    }
    if (!value || value <= 0) {
      toast.error('Agrega un monto')
      return
    }

    startTransition(async () => {
      const result = await createFixedExpense({
        description: newDesc.trim(),
        monthlyAmount: value,
        categoryId: newCatId || undefined,
      })

      if (!result.success) {
        toast.error(result.error)
        return
      }

      toast.success('Gasto fijo agregado')
      setNewDesc('')
      setNewAmount('')
      setNewCatId('')
      setShowAddForm(false)

      // Refresh data — optimistic update
      setFixedExpenses(prev => [...prev, {
        id: Date.now().toString(),
        workspace_id: '',
        category_id: newCatId || null,
        description: newDesc.trim(),
        monthly_amount: value,
        is_active: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        categoryName: newCatId
          ? categories.find(c => c.id === newCatId)?.name || null
          : null,
      }])
      setTotalFixed(prev => prev + value)
    })
  }

  const handleDeleteFixed = (id: string) => {
    startTransition(async () => {
      const result = await deleteFixedExpense(id)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      const removed = fixedExpenses.find(f => f.id === id)
      setFixedExpenses(prev => prev.filter(f => f.id !== id))
      if (removed?.is_active) {
        setTotalFixed(prev => prev - removed.monthly_amount)
      }
      toast.success('Gasto fijo eliminado')
    })
  }

  const handleToggleFixed = (id: string, currentActive: boolean) => {
    startTransition(async () => {
      const result = await toggleFixedExpense(id, !currentActive)
      if (!result.success) {
        toast.error(result.error)
        return
      }
      const item = fixedExpenses.find(f => f.id === id)
      setFixedExpenses(prev => prev.map(f =>
        f.id === id ? { ...f, is_active: !currentActive } : f
      ))
      if (item) {
        setTotalFixed(prev => currentActive
          ? prev - item.monthly_amount
          : prev + item.monthly_amount
        )
      }
    })
  }

  const formatCurrency = (v: number) =>
    new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

  const statusColors = {
    complete: 'bg-green-500',
    partial: 'bg-yellow-500',
    pending: 'bg-muted-foreground/30',
  }

  return (
    <div className="mx-auto max-w-2xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold">Configuración</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configura tu workspace para que tus Números sean más precisos.
        </p>
      </div>

      {/* D241: Checklist de estado */}
      <div className="space-y-2">
        {initialChecklist.map((item) => (
          <button
            key={item.key}
            onClick={() => setActiveSection(activeSection === item.key ? null : item.key)}
            className="flex w-full items-center gap-4 rounded-xl border bg-card p-4 text-left transition-colors hover:bg-accent/50"
          >
            <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full ${statusColors[item.status]}`}>
              {item.status === 'complete' && <Check className="h-3.5 w-3.5 text-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-medium">{item.label}</p>
              <p className="text-xs text-muted-foreground">{item.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`text-xs font-medium ${
                item.status === 'complete' ? 'text-green-600' :
                item.status === 'partial' ? 'text-yellow-600' :
                'text-muted-foreground'
              }`}>
                {item.statusLabel}
              </span>
              <ChevronRight className={`h-4 w-4 text-muted-foreground transition-transform ${
                activeSection === item.key ? 'rotate-90' : ''
              }`} />
            </div>
          </button>
        ))}
      </div>

      {/* ── Gastos Fijos Section ── */}
      {activeSection === 'gastos-fijos' && (
        <div className="space-y-4 rounded-xl border bg-card p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-semibold">Gastos fijos mensuales</h3>
              <p className="text-sm text-muted-foreground">
                Total: <span className="font-medium text-foreground">{formatCurrency(totalFixed)}</span>/mes
              </p>
            </div>
            <button
              onClick={() => setShowAddForm(!showAddForm)}
              className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
            >
              {showAddForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
              {showAddForm ? 'Cancelar' : 'Agregar'}
            </button>
          </div>

          {/* D239: Desglose gastos fijos */}
          {fixedExpenses.length > 0 ? (
            <div className="space-y-2">
              {fixedExpenses.map((fe) => (
                <div key={fe.id} className={`flex items-center gap-3 rounded-lg border p-3 ${!fe.is_active ? 'opacity-50' : ''}`}>
                  <button
                    onClick={() => handleToggleFixed(fe.id, fe.is_active)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                      fe.is_active
                        ? 'border-green-500 bg-green-500 text-white'
                        : 'border-input hover:border-primary'
                    }`}
                  >
                    {fe.is_active && <Check className="h-3 w-3" />}
                  </button>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{fe.description}</p>
                    {fe.categoryName && (
                      <p className="text-xs text-muted-foreground">{fe.categoryName}</p>
                    )}
                  </div>
                  <p className="text-sm font-medium">{formatCurrency(fe.monthly_amount)}</p>
                  <button
                    onClick={() => handleDeleteFixed(fe.id)}
                    className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          ) : !showAddForm && (
            <div className="rounded-lg border border-dashed p-6 text-center">
              <p className="text-sm text-muted-foreground">
                Agrega tus gastos fijos para que ONE calcule tu punto de equilibrio.
              </p>
            </div>
          )}

          {/* Add form */}
          {showAddForm && (
            <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
              <input
                type="text"
                placeholder="Descripción (ej: Arriendo oficina)"
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                className="flex h-10 w-full rounded-lg border border-input bg-background px-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
              <div className="flex gap-3">
                <div className="relative flex-1">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    placeholder="Monto mensual"
                    value={newAmount}
                    onChange={(e) => handleAmountChange(e.target.value)}
                    className="flex h-10 w-full rounded-lg border border-input bg-background pl-7 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onKeyDown={(e) => e.key === 'Enter' && handleAddFixed()}
                  />
                </div>
                <select
                  value={newCatId}
                  onChange={(e) => setNewCatId(e.target.value)}
                  className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground"
                >
                  <option value="">Categoría (opcional)</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <button
                onClick={handleAddFixed}
                disabled={isPending}
                className="flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Agregar gasto fijo'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Mi Tarifa Section ── */}
      {activeSection === 'mi-tarifa' && (
        <div className="space-y-4 rounded-xl border bg-card p-6">
          <div>
            <h3 className="font-semibold">Mi tarifa</h3>
            <p className="text-sm text-muted-foreground">
              D244: Tu ingreso esperado / horas trabajadas = costo hora.
            </p>
          </div>
          <div className="rounded-lg border border-dashed p-6 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground/30" />
            <p className="mt-2 text-sm text-muted-foreground">
              Próximamente. Se calcula automáticamente con tus datos de proyectos y horas.
            </p>
          </div>
        </div>
      )}

      {/* ── Perfil Fiscal Section ── */}
      {activeSection === 'perfil-fiscal' && (
        <div className="space-y-4 rounded-xl border bg-card p-6">
          <div>
            <h3 className="font-semibold">Perfil fiscal</h3>
            <p className="text-sm text-muted-foreground">
              Configura tu perfil para que las cotizaciones y retenciones sean precisas.
            </p>
          </div>
          <div className="rounded-lg border border-dashed p-6 text-center">
            <AlertCircle className="mx-auto h-8 w-8 text-muted-foreground/30" />
            <p className="mt-2 text-sm text-muted-foreground">
              Sprint 6: Wizard Felipe te guiará paso a paso.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Mientras tanto, los cálculos usan valores conservadores por defecto.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
