'use client'

import { useState, useTransition } from 'react'
import { Plus, Trash2, Check, X, Loader2, Pencil, AlertTriangle, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { createFixedExpense, deleteFixedExpense, toggleFixedExpense, updateFixedExpense } from '../gastos/actions'
import type { ExpenseCategory, FixedExpense } from '@/types/database'

type FixedExpenseWithCategory = FixedExpense & { categoryName: string | null }

interface Props {
  fixedExpenses: FixedExpenseWithCategory[]
  categories: ExpenseCategory[]
  totalFixed: number
  staffNomina?: { nombre: string; salario: number }[]
}

// ── D129: Tooltips por estado de deducibilidad ──────────
const TOOLTIP_DEDUCIBLE = {
  true: 'Este gasto puede reducir lo que le pagas al Estado. Para que cuente, necesitas la factura o documento de pago a nombre de tu empresa. Guardala.',
  partial: 'Solo una parte de este gasto aplica para reducir impuestos — por ejemplo, si usas el carro o el internet tambien para cosas personales. Tu contador te dice exactamente cuanto.',
  false: 'Este gasto no reduce tus impuestos. Si lo registras como gasto empresarial sin que lo sea, la DIAN puede rechazarlo y generar sanciones. Separa siempre lo personal de lo empresarial.',
}

// ── D129: Resolve deducible state from category is_deductible ──
type DeducibleState = 'true' | 'partial' | 'false'

function getDeducibleState(deducible: boolean | null, categoryId: string | null, categories: ExpenseCategory[]): DeducibleState {
  // If user explicitly set it, honor that first
  if (deducible === true) {
    // Check if category says partial
    if (categoryId) {
      const cat = categories.find(c => c.id === categoryId)
      if (cat?.is_deductible === 'partial') return 'partial'
    }
    return 'true'
  }
  if (deducible === false || deducible === null) return 'false'
  return 'false'
}

function getCategoryDeducibleDefault(categoryId: string, categories: ExpenseCategory[]): boolean {
  const cat = categories.find(c => c.id === categoryId)
  if (!cat) return false
  return cat.is_deductible === 'true' || cat.is_deductible === 'partial'
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

const formatAmountInput = (raw: string) => {
  const digits = raw.replace(/[^0-9]/g, '')
  if (!digits) return ''
  return parseInt(digits, 10).toLocaleString('es-CO')
}

const parseAmount = (formatted: string) => parseInt(formatted.replace(/[^0-9]/g, ''), 10) || 0

// ── Deducible toggle + tooltip subcomponent ─────────────
function DeducibleToggle({
  checked,
  onChange,
  categoryId,
  categories,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  categoryId: string
  categories: ExpenseCategory[]
}) {
  const state = getDeducibleState(checked, categoryId, categories)
  const tooltip = TOOLTIP_DEDUCIBLE[state]

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => onChange(!checked)}
          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
            checked
              ? state === 'partial'
                ? 'border-amber-500 bg-amber-500 text-white'
                : 'border-primary bg-primary text-primary-foreground'
              : 'border-input hover:border-primary'
          }`}
        >
          {checked && <Check className="h-3 w-3" />}
        </button>
        <label className="text-xs font-medium text-muted-foreground">
          Puede ayudarte a pagar menos impuestos? {checked ? '💰' : ''}
        </label>
      </div>
      {/* D129: Inline tooltip — always visible when deducible state changes */}
      <p className={`text-[11px] leading-snug pl-7 ${
        state === 'true' ? 'text-green-600 dark:text-green-400'
          : state === 'partial' ? 'text-amber-600 dark:text-amber-400'
          : 'text-muted-foreground'
      }`}>
        {tooltip}
      </p>
    </div>
  )
}

export default function GastosFijosSection({ fixedExpenses: initialExpenses, categories, totalFixed: initialTotal, staffNomina = [] }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [fixedExpenses, setFixedExpenses] = useState(initialExpenses)
  const [totalFixed, setTotalFixed] = useState(initialTotal)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Add form state
  const [newDesc, setNewDesc] = useState('')
  const [newAmount, setNewAmount] = useState('')
  const [newCatId, setNewCatId] = useState('')
  const [newDiaPago, setNewDiaPago] = useState('')
  const [newDeducible, setNewDeducible] = useState(false)

  // Edit form state
  const [editDesc, setEditDesc] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editCatId, setEditCatId] = useState('')
  const [editDiaPago, setEditDiaPago] = useState('')
  const [editDeducible, setEditDeducible] = useState(false)

  const startEdit = (fe: FixedExpenseWithCategory) => {
    setEditingId(fe.id)
    setEditDesc(fe.description)
    setEditAmount(fe.monthly_amount.toLocaleString('es-CO'))
    setEditCatId(fe.category_id ?? '')
    setEditDiaPago(fe.dia_pago ? String(fe.dia_pago) : '')
    setEditDeducible(fe.deducible ?? false)
    setShowAddForm(false)
  }

  const cancelEdit = () => {
    setEditingId(null)
  }

  // D129: Auto-set deducible when category changes (add form)
  const handleNewCatChange = (catId: string) => {
    setNewCatId(catId)
    if (catId) {
      setNewDeducible(getCategoryDeducibleDefault(catId, categories))
    }
  }

  // D129: Auto-set deducible when category changes (edit form)
  const handleEditCatChange = (catId: string) => {
    setEditCatId(catId)
    if (catId) {
      setEditDeducible(getCategoryDeducibleDefault(catId, categories))
    }
  }

  const handleAdd = () => {
    const value = parseAmount(newAmount)
    if (!newDesc.trim()) { toast.error('Agrega una descripcion'); return }
    if (!value || value <= 0) { toast.error('Agrega un monto'); return }

    startTransition(async () => {
      const result = await createFixedExpense({
        description: newDesc.trim(),
        monthlyAmount: value,
        categoryId: newCatId || undefined,
        diaPago: newDiaPago ? parseInt(newDiaPago) : undefined,
        deducible: newDeducible,
      })

      if (!result.success) { toast.error(result.error); return }

      toast.success('Gasto fijo agregado')
      setNewDesc('')
      setNewAmount('')
      setNewCatId('')
      setNewDiaPago('')
      setNewDeducible(false)
      setShowAddForm(false)
      router.refresh()
    })
  }

  const handleUpdate = (id: string) => {
    const value = parseAmount(editAmount)
    if (!editDesc.trim()) { toast.error('La descripcion no puede estar vacia'); return }
    if (!value || value <= 0) { toast.error('El monto debe ser mayor a 0'); return }

    startTransition(async () => {
      const result = await updateFixedExpense(id, {
        description: editDesc.trim(),
        monthlyAmount: value,
        categoryId: editCatId || null,
        diaPago: editDiaPago ? parseInt(editDiaPago) : null,
        deducible: editDeducible,
      })

      if (!result.success) { toast.error(result.error); return }

      const oldItem = fixedExpenses.find(f => f.id === id)
      setFixedExpenses(prev => prev.map(f =>
        f.id === id ? {
          ...f,
          description: editDesc.trim(),
          monthly_amount: value,
          category_id: editCatId || null,
          categoryName: categories.find(c => c.id === editCatId)?.name ?? null,
          dia_pago: editDiaPago ? parseInt(editDiaPago) : null,
          deducible: editDeducible,
        } : f
      ))
      if (oldItem?.is_active) {
        setTotalFixed(prev => prev - oldItem.monthly_amount + value)
      }
      setEditingId(null)
      toast.success('Gasto fijo actualizado')
    })
  }

  const handleDelete = (id: string) => {
    startTransition(async () => {
      const result = await deleteFixedExpense(id)
      if (!result.success) { toast.error(result.error); return }
      const removed = fixedExpenses.find(f => f.id === id)
      setFixedExpenses(prev => prev.filter(f => f.id !== id))
      if (removed?.is_active) {
        setTotalFixed(prev => prev - removed.monthly_amount)
      }
      setEditingId(null)
      toast.success('Gasto fijo eliminado')
    })
  }

  const handleToggle = (id: string, currentActive: boolean) => {
    startTransition(async () => {
      const result = await toggleFixedExpense(id, !currentActive)
      if (!result.success) { toast.error(result.error); return }
      const item = fixedExpenses.find(f => f.id === id)
      setFixedExpenses(prev => prev.map(f =>
        f.id === id ? { ...f, is_active: !currentActive } : f
      ))
      if (item) {
        setTotalFixed(prev => currentActive ? prev - item.monthly_amount : prev + item.monthly_amount)
      }
    })
  }

  // D129: Deducible badge for list items
  const deducibleBadge = (fe: FixedExpenseWithCategory) => {
    const state = getDeducibleState(fe.deducible, fe.category_id, categories)
    if (state === 'true') return <span className="text-green-600 dark:text-green-400">💰 Puede ser deducible</span>
    if (state === 'partial') return <span className="text-amber-600 dark:text-amber-400">💰 Parcialmente deducible</span>
    return null
  }

  const totalNomina = staffNomina.reduce((s, st) => s + st.salario, 0)
  const totalCompuesto = totalNomina + totalFixed

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Gastos fijos mensuales</h3>
          <p className="text-sm text-muted-foreground">
            Total: <span className="font-medium text-foreground">{formatCurrency(totalCompuesto)}</span>/mes
          </p>
        </div>
        <button
          onClick={() => { setShowAddForm(!showAddForm); setEditingId(null) }}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {showAddForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showAddForm ? 'Cancelar' : 'Agregar'}
        </button>
      </div>

      {/* D129: Nómina block (locked, from Mi Equipo) */}
      {staffNomina.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <span className="text-sm">👥</span>
              <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Nomina (desde Mi Equipo)</h4>
              <Lock className="h-3 w-3 text-muted-foreground" />
            </div>
            <span className="text-sm font-semibold">{formatCurrency(totalNomina)}</span>
          </div>
          <div className="rounded-lg border border-dashed bg-muted/30 divide-y divide-dashed">
            {staffNomina.map((s, i) => (
              <div key={i} className="flex items-center justify-between px-3 py-2">
                <span className="text-xs text-muted-foreground">{s.nombre}</span>
                <span className="text-xs font-medium tabular-nums">{formatCurrency(s.salario)}</span>
              </div>
            ))}
          </div>
          <a href="#mi-equipo" className="text-[10px] font-medium text-primary hover:underline">
            Editar en Mi Equipo →
          </a>
        </div>
      )}

      {/* Operational expenses header */}
      {staffNomina.length > 0 && (
        <div className="flex items-center gap-1.5">
          <span className="text-sm">🏢</span>
          <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Gastos operativos</h4>
          <span className="ml-auto text-sm font-semibold">{formatCurrency(totalFixed)}</span>
        </div>
      )}

      {/* List */}
      {fixedExpenses.length > 0 ? (
        <div className="space-y-2">
          {fixedExpenses.map((fe) => (
            editingId === fe.id ? (
              /* ── Edit inline form ── */
              <div key={fe.id} className="space-y-3 rounded-lg border border-primary/30 bg-primary/5 p-4">
                <input
                  type="text"
                  value={editDesc}
                  onChange={(e) => setEditDesc(e.target.value)}
                  className="flex h-9 w-full rounded-lg border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  placeholder="Descripcion"
                />
                <div className="flex gap-3">
                  <div className="relative flex-1">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={editAmount}
                      onChange={(e) => setEditAmount(formatAmountInput(e.target.value))}
                      className="flex h-9 w-full rounded-lg border border-input bg-background pl-7 pr-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onKeyDown={(e) => e.key === 'Enter' && handleUpdate(fe.id)}
                    />
                  </div>
                  <select
                    value={editCatId}
                    onChange={(e) => handleEditCatChange(e.target.value)}
                    className="h-9 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground"
                  >
                    <option value="">Sin categoria</option>
                    {categories.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-center gap-4">
                  <div className="flex-1">
                    <label className="text-xs font-medium text-muted-foreground">Dia de pago</label>
                    <input
                      type="number"
                      min={1}
                      max={31}
                      value={editDiaPago}
                      onChange={e => setEditDiaPago(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-1.5 text-sm"
                      placeholder="1-31"
                    />
                  </div>
                </div>
                {/* D129: Deducible toggle with tooltip */}
                <DeducibleToggle
                  checked={editDeducible}
                  onChange={setEditDeducible}
                  categoryId={editCatId}
                  categories={categories}
                />
                <div className="flex gap-2">
                  <button
                    onClick={() => handleUpdate(fe.id)}
                    disabled={isPending}
                    className="flex h-9 flex-1 items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar'}
                  </button>
                  <button
                    onClick={cancelEdit}
                    className="flex h-9 items-center justify-center rounded-lg border px-4 text-sm font-medium hover:bg-muted"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={() => handleDelete(fe.id)}
                    disabled={isPending}
                    className="flex h-9 items-center justify-center rounded-lg border border-destructive/30 px-3 text-destructive hover:bg-destructive/10 disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ) : (
              /* ── Read-only row ── */
              <div key={fe.id} className={`flex items-center gap-3 rounded-lg border p-3 ${!fe.is_active ? 'opacity-50' : ''}`}>
                <button
                  onClick={() => handleToggle(fe.id, fe.is_active ?? true)}
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                    fe.is_active
                      ? 'border-green-500 bg-green-500 text-white'
                      : 'border-input hover:border-primary'
                  }`}
                >
                  {fe.is_active && <Check className="h-3 w-3" />}
                </button>
                <button
                  onClick={() => startEdit(fe)}
                  className="flex flex-1 min-w-0 text-left"
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{fe.description}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      {fe.categoryName && <span>{fe.categoryName}</span>}
                      {fe.dia_pago && <span>Dia {fe.dia_pago}</span>}
                      {deducibleBadge(fe)}
                    </div>
                  </div>
                </button>
                <p className="text-sm font-medium">{formatCurrency(fe.monthly_amount)}</p>
                <button
                  onClick={() => startEdit(fe)}
                  className="rounded p-1 text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
              </div>
            )
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
            placeholder="Descripcion (ej: Arriendo oficina)"
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
                onChange={(e) => setNewAmount(formatAmountInput(e.target.value))}
                className="flex h-10 w-full rounded-lg border border-input bg-background pl-7 pr-3 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
              />
            </div>
            <select
              value={newCatId}
              onChange={(e) => handleNewCatChange(e.target.value)}
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground"
            >
              <option value="">Categoria (opcional)</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          <div className="flex-1">
            <label className="text-xs font-medium text-muted-foreground">Dia de pago</label>
            <input
              type="number"
              min={1}
              max={31}
              value={newDiaPago}
              onChange={e => setNewDiaPago(e.target.value)}
              className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-sm"
              placeholder="1-31"
            />
          </div>

          {/* D129: Deducible toggle with tooltip */}
          <DeducibleToggle
            checked={newDeducible}
            onChange={setNewDeducible}
            categoryId={newCatId}
            categories={categories}
          />

          <button
            onClick={handleAdd}
            disabled={isPending}
            className="flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Agregar gasto fijo'}
          </button>
        </div>
      )}

      {/* D129 CAMBIO 3: Disclaimer pie de sección */}
      {fixedExpenses.length > 0 && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/20">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
          <p className="text-[11px] leading-snug text-amber-700 dark:text-amber-400">
            La deducibilidad depende de tu regimen tributario y de tener los soportes al dia. Estos indicadores son orientativos y no constituyen asesoria tributaria — tu contador tiene la palabra final.
          </p>
        </div>
      )}
    </div>
  )
}
