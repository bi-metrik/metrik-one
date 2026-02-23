'use client'

import { useState, useTransition } from 'react'
import { Plus, Trash2, Check, X, Loader2, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import { createFixedExpense, deleteFixedExpense, toggleFixedExpense, updateFixedExpense } from '../gastos/actions'
import type { ExpenseCategory, FixedExpense } from '@/types/database'

type FixedExpenseWithCategory = FixedExpense & { categoryName: string | null }

interface Props {
  fixedExpenses: FixedExpenseWithCategory[]
  categories: ExpenseCategory[]
  totalFixed: number
}

const formatCurrency = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

const formatAmountInput = (raw: string) => {
  const digits = raw.replace(/[^0-9]/g, '')
  if (!digits) return ''
  return parseInt(digits, 10).toLocaleString('es-CO')
}

const parseAmount = (formatted: string) => parseInt(formatted.replace(/[^0-9]/g, ''), 10) || 0

export default function GastosFijosSection({ fixedExpenses: initialExpenses, categories, totalFixed: initialTotal }: Props) {
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

      // Update local state
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

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Gastos fijos mensuales</h3>
          <p className="text-sm text-muted-foreground">
            Total: <span className="font-medium text-foreground">{formatCurrency(totalFixed)}</span>/mes
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
                    onChange={(e) => setEditCatId(e.target.value)}
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
                  <div className="flex items-center gap-2 pt-4">
                    <button
                      type="button"
                      onClick={() => setEditDeducible(!editDeducible)}
                      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                        editDeducible
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-input hover:border-primary'
                      }`}
                    >
                      {editDeducible && <Check className="h-3 w-3" />}
                    </button>
                    <label className="text-xs font-medium text-muted-foreground">Deducible</label>
                  </div>
                </div>
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
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {fe.categoryName && <span>{fe.categoryName}</span>}
                      {fe.dia_pago && <span>Dia {fe.dia_pago}</span>}
                      {fe.deducible && <span className="text-green-600">Deducible</span>}
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
              onChange={(e) => setNewCatId(e.target.value)}
              className="h-10 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground"
            >
              <option value="">Categoria (opcional)</option>
              {categories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* New fields: dia_pago + deducible */}
          <div className="flex items-center gap-4">
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
            <div className="flex items-center gap-2 pt-4">
              <button
                type="button"
                onClick={() => setNewDeducible(!newDeducible)}
                className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                  newDeducible
                    ? 'border-primary bg-primary text-primary-foreground'
                    : 'border-input hover:border-primary'
                }`}
              >
                {newDeducible && <Check className="h-3 w-3" />}
              </button>
              <label className="text-xs font-medium text-muted-foreground">Deducible</label>
            </div>
          </div>

          <button
            onClick={handleAdd}
            disabled={isPending}
            className="flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Agregar gasto fijo'}
          </button>
        </div>
      )}
    </div>
  )
}
