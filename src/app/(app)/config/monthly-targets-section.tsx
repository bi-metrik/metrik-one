'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight, Save } from 'lucide-react'
import { toast } from 'sonner'
import type { MonthlyTarget } from '@/types/database'
import { bulkUpsertMonthlyTargets } from './monthly-targets-actions'

interface MonthlyTargetsSectionProps {
  initialData: MonthlyTarget[]
  initialYear: number
}

const MONTH_LABELS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic']

const fmt = (v: number) =>
  v > 0
    ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)
    : '—'

interface MonthRow {
  month: number
  sales_target: number
  collection_target: number
}

export default function MonthlyTargetsSection({ initialData, initialYear }: MonthlyTargetsSectionProps) {
  const router = useRouter()
  const [year, setYear] = useState(initialYear)
  const [isPending, startTransition] = useTransition()
  const [saved, setSaved] = useState(false)

  // Build 12-month grid from initial data
  const buildGrid = (data: MonthlyTarget[]): MonthRow[] => {
    return Array.from({ length: 12 }, (_, i) => {
      const existing = data.find(t => t.month === i + 1)
      return {
        month: i + 1,
        sales_target: existing?.sales_target || 0,
        collection_target: existing?.collection_target || 0,
      }
    })
  }

  const [grid, setGrid] = useState<MonthRow[]>(buildGrid(initialData))

  const updateCell = (month: number, field: 'sales_target' | 'collection_target', value: number) => {
    setGrid(prev => prev.map(r =>
      r.month === month ? { ...r, [field]: value } : r
    ))
    setSaved(false)
  }

  const handleSave = () => {
    startTransition(async () => {
      const res = await bulkUpsertMonthlyTargets(year, grid)
      if (res.success) {
        toast.success('Metas guardadas')
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
        router.refresh()
      } else {
        toast.error('Error al guardar metas')
      }
    })
  }

  // Applyall: copy month 1 to all months
  const applyToAll = (field: 'sales_target' | 'collection_target') => {
    const val = grid[0][field]
    if (val <= 0) return
    setGrid(prev => prev.map(r => ({ ...r, [field]: val })))
    setSaved(false)
  }

  const totalSales = grid.reduce((s, r) => s + r.sales_target, 0)
  const totalCollection = grid.reduce((s, r) => s + r.collection_target, 0)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Metas mensuales</h3>
          <p className="text-xs text-muted-foreground">
            Define tus metas de venta y cobro por mes
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setYear(y => y - 1)}
            className="rounded p-1 hover:bg-accent"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-medium w-12 text-center">{year}</span>
          <button
            onClick={() => setYear(y => y + 1)}
            className="rounded p-1 hover:bg-accent"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b">
              <th className="pb-2 text-left text-xs font-medium text-muted-foreground w-16">Mes</th>
              <th className="pb-2 text-right text-xs font-medium text-muted-foreground">
                Meta ventas
                <button
                  onClick={() => applyToAll('sales_target')}
                  className="ml-1 text-[9px] text-primary hover:underline"
                  title="Copiar Ene a todos"
                >
                  (todos)
                </button>
              </th>
              <th className="pb-2 text-right text-xs font-medium text-muted-foreground">
                Meta cobros
                <button
                  onClick={() => applyToAll('collection_target')}
                  className="ml-1 text-[9px] text-primary hover:underline"
                  title="Copiar Ene a todos"
                >
                  (todos)
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {grid.map(row => (
              <tr key={row.month} className="border-b last:border-0">
                <td className="py-1.5 text-muted-foreground font-medium">
                  {MONTH_LABELS[row.month - 1]}
                </td>
                <td className="py-1.5">
                  <input
                    type="number"
                    value={row.sales_target || ''}
                    onChange={e => updateCell(row.month, 'sales_target', Number(e.target.value))}
                    className="w-full rounded border bg-background px-2 py-1 text-right text-sm"
                    placeholder="0"
                  />
                </td>
                <td className="py-1.5">
                  <input
                    type="number"
                    value={row.collection_target || ''}
                    onChange={e => updateCell(row.month, 'collection_target', Number(e.target.value))}
                    className="w-full rounded border bg-background px-2 py-1 text-right text-sm"
                    placeholder="0"
                  />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t-2">
              <td className="py-2 font-bold text-xs">TOTAL</td>
              <td className="py-2 text-right font-bold text-xs">{fmt(totalSales)}</td>
              <td className="py-2 text-right font-bold text-xs">{fmt(totalCollection)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={handleSave}
          disabled={isPending}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          <Save className="h-3.5 w-3.5" />
          {isPending ? 'Guardando...' : saved ? '¡Guardado!' : 'Guardar metas'}
        </button>
      </div>
    </div>
  )
}
