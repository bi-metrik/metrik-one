'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { X, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { createExpense, getExpenseCategories } from './actions'
import type { ExpenseCategory } from '@/types/database'

// ── Category icons (9 categories D95) ────────────────────
const CATEGORY_ICONS: Record<string, string> = {
  'Materiales': '🧱',
  'Transporte': '🚗',
  'Alimentación': '🍽️',
  'Servicios Profesionales': '👔',
  'Software': '💻',
  'Arriendo': '🏠',
  'Marketing': '📣',
  'Capacitación': '📚',
  'Otros': '📦',
}

interface ExpenseModalProps {
  projectId?: string       // Pre-fill if inside a project context
  projectName?: string
  onClose: () => void
  onCreated?: () => void
}

export default function ExpenseModal({
  projectId,
  projectName,
  onClose,
  onCreated,
}: ExpenseModalProps) {
  const [categories, setCategories] = useState<ExpenseCategory[]>([])
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [isPending, startTransition] = useTransition()
  const [loadingCats, setLoadingCats] = useState(true)
  const amountRef = useRef<HTMLInputElement>(null)

  // Load categories on mount
  useEffect(() => {
    getExpenseCategories().then(({ categories: cats }) => {
      setCategories(cats)
      setLoadingCats(false)
    })
  }, [])

  // Focus amount field
  useEffect(() => {
    amountRef.current?.focus()
  }, [])

  // Escape to close
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleEsc)
    return () => window.removeEventListener('keydown', handleEsc)
  }, [onClose])

  // Format currency while typing
  const handleAmountChange = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '')
    if (!digits) {
      setAmount('')
      return
    }
    const num = parseInt(digits, 10)
    setAmount(num.toLocaleString('es-CO'))
  }

  const handleSubmit = () => {
    setError('')

    const value = parseInt(amount.replace(/[^0-9]/g, ''), 10)
    if (!value || value <= 0) {
      setError('¿Cuánto gastaste?')
      return
    }
    if (!categoryId) {
      setError('Selecciona una categoría')
      return
    }

    startTransition(async () => {
      const result = await createExpense({
        amount: value,
        categoryId,
        description: description.trim() || undefined,
        projectId: projectId || undefined,
      })

      if (!result.success) {
        setError(result.error || 'Error creando gasto')
        return
      }

      toast.success('Gasto registrado', {
        description: 'Tus Números se actualizaron',
        action: {
          label: 'Ver Números',
          onClick: () => {
            window.location.href = '/numeros'
          },
        },
      })

      onCreated?.()
      onClose()
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-2xl border bg-background p-6 shadow-xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Registrar gasto</h2>
          <button
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {projectName && (
          <p className="mt-1 text-sm text-muted-foreground">
            Proyecto: <span className="font-medium text-foreground">{projectName}</span>
          </p>
        )}

        <p className="mt-1 text-sm text-muted-foreground">
          3 datos y listo.
        </p>

        {/* Form — D28: 3 campos obligatorios */}
        <div className="mt-6 space-y-4">
          {/* 1. Amount */}
          <div className="space-y-1.5">
            <label htmlFor="expAmount" className="text-sm font-medium">
              ¿Cuánto?
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <input
                ref={amountRef}
                id="expAmount"
                type="text"
                inputMode="numeric"
                placeholder="50.000"
                value={amount}
                onChange={(e) => handleAmountChange(e.target.value)}
                className="flex h-11 w-full rounded-lg border border-input bg-background pl-8 pr-4 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                onKeyDown={(e) => e.key === 'Enter' && !categoryId && document.getElementById('catGrid')?.focus()}
              />
            </div>
          </div>

          {/* 2. Category — 9 options (D95) */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium">¿En qué?</label>
            {loadingCats ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Cargando categorías...
              </div>
            ) : (
              <div id="catGrid" className="grid grid-cols-3 gap-2">
                {categories.map((cat) => (
                  <button
                    key={cat.id}
                    type="button"
                    onClick={() => setCategoryId(cat.id)}
                    className={`flex flex-col items-center gap-1 rounded-lg border px-2 py-3 text-center transition-colors ${
                      categoryId === cat.id
                        ? 'border-primary bg-primary/5'
                        : 'border-input hover:bg-accent'
                    }`}
                  >
                    <span className="text-lg">{CATEGORY_ICONS[cat.name] || '📦'}</span>
                    <span className={`text-xs font-medium leading-tight ${
                      categoryId === cat.id ? 'text-primary' : 'text-muted-foreground'
                    }`}>
                      {cat.name}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 3. Description (optional) */}
          <div className="space-y-1.5">
            <label htmlFor="expDesc" className="text-sm font-medium">
              Descripción <span className="font-normal text-muted-foreground">(opcional)</span>
            </label>
            <input
              id="expDesc"
              type="text"
              placeholder="Ej: Uber al sitio del cliente"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="flex h-11 w-full rounded-lg border border-input bg-background px-4 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            />
          </div>
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
              'Registrar gasto'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}
