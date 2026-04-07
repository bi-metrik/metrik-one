'use client'

import { useState, useTransition, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { actualizarBloqueData, marcarBloqueCompleto } from '../../negocio-v2-actions'
import type { NegocioBloque } from '../../negocio-v2-actions'

export interface MultiPagoField {
  slug: string
  label: string
  tipo: 'texto' | 'numero'
  required: boolean
}

interface PagoRow {
  referencia_epayco: string
  valor_pago: number | ''
}

interface BloqueDatosMultiPagoProps {
  negocioBloqueId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  fields: MultiPagoField[]
  onComplete?: () => void
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function BloqueDatosMultiPago({
  negocioBloqueId,
  instancia,
  modo,
  fields,
  onComplete,
}: BloqueDatosMultiPagoProps) {
  const saved = (instancia?.data ?? {}) as Record<string, unknown>
  const savedPagos = (saved.pagos ?? []) as PagoRow[]

  const [pagos, setPagos] = useState<PagoRow[]>(() =>
    savedPagos.length > 0 ? savedPagos : [{ referencia_epayco: '', valor_pago: '' }]
  )
  const [isPending, startTransition] = useTransition()
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Determinar labels from fields config
  const refLabel = fields.find(f => f.slug === 'referencia_epayco')?.label ?? 'Referencia ePayco'
  const valorLabel = fields.find(f => f.slug === 'valor_pago')?.label ?? 'Valor del pago'

  function isAllComplete(rows: PagoRow[]) {
    return rows.length > 0 && rows.every(r =>
      r.referencia_epayco.trim() !== '' && r.valor_pago !== '' && Number(r.valor_pago) > 0
    )
  }

  function scheduleAutoSave(rows: PagoRow[]) {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      startTransition(async () => {
        const data = { pagos: rows }
        const complete = isAllComplete(rows)
        let result
        if (complete) {
          result = await marcarBloqueCompleto(negocioBloqueId, data)
          if (!result.error && onComplete) onComplete()
        } else {
          result = await actualizarBloqueData(negocioBloqueId, data)
        }
        if (result.error) toast.error(result.error)
      })
    }, 800)
  }

  function updateRow(index: number, field: keyof PagoRow, value: string) {
    const next: PagoRow[] = pagos.map((p, i) => {
      if (i !== index) return p
      if (field === 'valor_pago') {
        return { ...p, valor_pago: value ? Number(value) : '' as const }
      }
      return { ...p, referencia_epayco: value }
    })
    setPagos(next)
    scheduleAutoSave(next)
  }

  function addRow() {
    const next = [...pagos, { referencia_epayco: '', valor_pago: '' as const }]
    setPagos(next)
  }

  function removeRow(index: number) {
    if (pagos.length <= 1) return
    const next = pagos.filter((_, i) => i !== index)
    setPagos(next)
    scheduleAutoSave(next)
  }

  // Modo visible: tabla read-only
  if (modo === 'visible') {
    if (savedPagos.length === 0) {
      return <p className="text-xs text-[#6B7280] italic">Sin pagos registrados</p>
    }
    return (
      <div className="space-y-1.5">
        {savedPagos.map((p, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] p-2.5">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[#1A1A1A]">Ref: {p.referencia_epayco || '---'}</p>
            </div>
            <span className="text-xs font-semibold text-[#1A1A1A] tabular-nums shrink-0">
              {p.valor_pago ? fmt(Number(p.valor_pago)) : '---'}
            </span>
          </div>
        ))}
        <div className="rounded-lg bg-slate-50 border border-slate-100 p-2 text-center">
          <p className="text-[10px] text-[#6B7280] font-medium">Total</p>
          <p className="text-sm font-bold text-[#1A1A1A] tabular-nums">
            {fmt(savedPagos.reduce((s, p) => s + (Number(p.valor_pago) || 0), 0))}
          </p>
        </div>
      </div>
    )
  }

  // Modo editable: filas dinamicas
  return (
    <div className="space-y-3">
      {pagos.map((pago, i) => (
        <div key={i} className="flex items-start gap-2">
          <div className="flex-1 space-y-2">
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">
                {refLabel}
                <span className="ml-0.5 text-red-500">*</span>
              </label>
              <input
                type="text"
                value={pago.referencia_epayco}
                onChange={e => updateRow(i, 'referencia_epayco', e.target.value)}
                disabled={isPending}
                placeholder="Ej: REF-12345"
                className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 disabled:opacity-60"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">
                {valorLabel}
                <span className="ml-0.5 text-red-500">*</span>
              </label>
              <input
                type="number"
                value={pago.valor_pago}
                onChange={e => updateRow(i, 'valor_pago', e.target.value)}
                disabled={isPending}
                placeholder="0"
                className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 disabled:opacity-60"
              />
            </div>
          </div>
          {pagos.length > 1 && (
            <button
              onClick={() => removeRow(i)}
              disabled={isPending}
              className="mt-6 shrink-0 rounded-lg p-1.5 text-[#6B7280] hover:bg-red-50 hover:text-red-500 transition-colors disabled:opacity-40"
              title="Eliminar pago"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}

      <button
        onClick={addRow}
        disabled={isPending}
        className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#E5E7EB] py-2 text-xs font-medium text-[#6B7280] hover:border-[#10B981] hover:text-[#10B981] transition-colors disabled:opacity-40"
      >
        <Plus className="h-3.5 w-3.5" />
        Agregar pago
      </button>

      {isPending && (
        <p className="text-[10px] text-[#6B7280]">Guardando...</p>
      )}
    </div>
  )
}
