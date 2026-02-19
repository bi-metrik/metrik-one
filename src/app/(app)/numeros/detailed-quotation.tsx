'use client'

import { useState, useTransition } from 'react'
import { Calculator, Loader2, Info } from 'lucide-react'
import { toast } from 'sonner'

/**
 * Sprint 12 — D84/D85: Cotización detallada
 * 6 rubros: Mi trabajo, Terceros, Materiales, Viáticos, Software, Servicios profesionales
 * COSTO_TOTAL = suma rubros → PRECIO_SUGERIDO = COSTO / (1-MARGEN) → editable → MARGEN_REAL
 */

interface QuotationItem {
  key: string
  label: string
  amount: number
  description: string
}

interface DetailedQuotationProps {
  onSave?: (data: QuotationData) => Promise<void>
  initialData?: QuotationData
}

export interface QuotationData {
  items: QuotationItem[]
  targetMargin: number
  finalPrice: number
  notes: string
}

const DEFAULT_ITEMS: QuotationItem[] = [
  { key: 'mi-trabajo', label: 'Mi trabajo', amount: 0, description: 'Horas × tarifa hora' },
  { key: 'terceros', label: 'Terceros', amount: 0, description: 'Subcontratados, freelancers' },
  { key: 'materiales', label: 'Materiales', amount: 0, description: 'Insumos, materiales físicos' },
  { key: 'viaticos', label: 'Viáticos', amount: 0, description: 'Transporte, alimentación, hospedaje' },
  { key: 'software', label: 'Software', amount: 0, description: 'Licencias, suscripciones del proyecto' },
  { key: 'servicios-pro', label: 'Servicios profesionales', amount: 0, description: 'Contadores, abogados, asesores' },
]

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function DetailedQuotation({ onSave, initialData }: DetailedQuotationProps) {
  const [items, setItems] = useState<QuotationItem[]>(initialData?.items || DEFAULT_ITEMS)
  const [targetMargin, setTargetMargin] = useState(initialData?.targetMargin || 30)
  const [finalPrice, setFinalPrice] = useState(initialData?.finalPrice || 0)
  const [manualPrice, setManualPrice] = useState(false)
  const [notes, setNotes] = useState(initialData?.notes || '')
  const [isPending, startTransition] = useTransition()

  // Calculations
  const totalCost = items.reduce((s, i) => s + i.amount, 0)
  const suggestedPrice = targetMargin < 100
    ? Math.ceil(totalCost / (1 - targetMargin / 100))
    : totalCost * 2 // Fallback for 100%+ margin

  const displayPrice = manualPrice ? finalPrice : suggestedPrice
  const realMargin = displayPrice > 0
    ? ((displayPrice - totalCost) / displayPrice) * 100
    : 0
  const profit = displayPrice - totalCost

  const handleItemChange = (key: string, amount: number) => {
    setItems(prev => prev.map(i => i.key === key ? { ...i, amount } : i))
    if (!manualPrice) setFinalPrice(0) // Reset to auto
  }

  const handleAmountInput = (key: string, raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '')
    const num = digits ? parseInt(digits, 10) : 0
    handleItemChange(key, num)
  }

  const handlePriceInput = (raw: string) => {
    const digits = raw.replace(/[^0-9]/g, '')
    const num = digits ? parseInt(digits, 10) : 0
    setFinalPrice(num)
    setManualPrice(true)
  }

  const handleSave = () => {
    if (totalCost === 0) {
      toast.error('Agrega al menos un rubro con valor')
      return
    }

    startTransition(async () => {
      try {
        await onSave?.({
          items,
          targetMargin,
          finalPrice: displayPrice,
          notes,
        })
        toast.success('Cotización guardada')
      } catch {
        toast.error('Error guardando cotización')
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Calculator className="h-5 w-5 text-primary" />
        <h3 className="font-semibold">Cotización detallada</h3>
      </div>

      {/* D85: 6 rubros */}
      <div className="space-y-3">
        {items.map((item) => (
          <div key={item.key} className="space-y-1">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">{item.label}</label>
              <span className="text-xs text-muted-foreground">{item.description}</span>
            </div>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <input
                type="text"
                inputMode="numeric"
                value={item.amount > 0 ? item.amount.toLocaleString('es-CO') : ''}
                onChange={(e) => handleAmountInput(item.key, e.target.value)}
                placeholder="0"
                className="flex h-10 w-full rounded-lg border border-input bg-background pl-7 pr-3 text-sm text-right placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </div>
          </div>
        ))}
      </div>

      {/* Cost total */}
      <div className="rounded-lg border bg-card p-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Costo total</span>
          <span className="text-lg font-bold">{fmt(totalCost)}</span>
        </div>
      </div>

      {/* Target margin */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Margen objetivo</label>
          <span className="text-sm font-bold text-primary">{targetMargin}%</span>
        </div>
        <input
          type="range"
          min="5"
          max="80"
          step="5"
          value={targetMargin}
          onChange={(e) => {
            setTargetMargin(Number(e.target.value))
            setManualPrice(false)
          }}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground">
          <span>5%</span>
          <span>80%</span>
        </div>
      </div>

      {/* Price */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm font-medium">Precio al cliente</label>
          {manualPrice && (
            <button
              onClick={() => { setManualPrice(false); setFinalPrice(0) }}
              className="text-[10px] text-primary hover:underline"
            >
              Usar sugerido
            </button>
          )}
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
          <input
            type="text"
            inputMode="numeric"
            value={displayPrice > 0 ? displayPrice.toLocaleString('es-CO') : ''}
            onChange={(e) => handlePriceInput(e.target.value)}
            placeholder={suggestedPrice > 0 ? suggestedPrice.toLocaleString('es-CO') : '0'}
            className="flex h-12 w-full rounded-lg border border-input bg-background pl-7 pr-3 text-lg font-bold text-right placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
        {!manualPrice && totalCost > 0 && (
          <p className="text-xs text-muted-foreground flex items-center gap-1">
            <Info className="h-3 w-3" />
            Precio sugerido: COSTO ÷ (1 − margen)
          </p>
        )}
      </div>

      {/* Result */}
      {totalCost > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg border p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Margen real</p>
            <p className={`mt-1 text-lg font-bold ${
              realMargin >= targetMargin ? 'text-green-600 dark:text-green-400' :
              realMargin >= 0 ? 'text-amber-600 dark:text-amber-400' :
              'text-red-600 dark:text-red-400'
            }`}>
              {realMargin.toFixed(1)}%
            </p>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Ganancia</p>
            <p className={`mt-1 text-lg font-bold ${profit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`}>
              {fmt(profit)}
            </p>
          </div>
          <div className="rounded-lg border p-3 text-center">
            <p className="text-[10px] text-muted-foreground">Factor</p>
            <p className="mt-1 text-lg font-bold">
              {totalCost > 0 ? (displayPrice / totalCost).toFixed(2) : '—'}×
            </p>
          </div>
        </div>
      )}

      {/* Notes */}
      <div className="space-y-1">
        <label className="text-sm font-medium">Notas</label>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notas adicionales para la cotización..."
          rows={2}
          className="flex w-full rounded-lg border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      {/* Save */}
      {onSave && (
        <button
          onClick={handleSave}
          disabled={isPending || totalCost === 0}
          className="flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Guardar cotización'}
        </button>
      )}
    </div>
  )
}
