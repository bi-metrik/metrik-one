'use client'

import { useState, useTransition } from 'react'
import { Banknote, CheckCircle2, Clock, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { confirmarPagoCobro } from '../../negocio-v2-actions'

interface Cobro {
  id: string
  concepto: string | null
  monto: number
  estado_causacion: string
  tipo_cobro: string | null
  fecha: string | null
  notas: string | null
}

interface BloqueCobrosProps {
  negocioId: string
  cobros: Cobro[]
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
}

const TIPO_LABELS: Record<string, string> = {
  regular: 'Regular',
  anticipo: 'Anticipo',
  saldo: 'Saldo',
}

export default function BloqueCobros({ negocioId, cobros }: BloqueCobrosProps) {
  const [ref, setRef] = useState('')
  const [valor, setValor] = useState('')
  const [selectedCobro, setSelectedCobro] = useState<string>('')
  const [isPending, startTransition] = useTransition()

  const cobrado = cobros.filter(c => c.estado_causacion === 'CAUSADO' || c.estado_causacion === 'APROBADO')
  const porCobrar = cobros.filter(c => c.estado_causacion === 'PENDIENTE')
  const cartera = porCobrar.reduce((sum, c) => sum + c.monto, 0)

  function handleConfirmar() {
    if (!selectedCobro) {
      toast.error('Selecciona el cobro a confirmar')
      return
    }
    startTransition(async () => {
      const result = await confirmarPagoCobro(selectedCobro, ref, valor ? Number(valor) : undefined)
      if (result.error) {
        toast.error(result.error)
      } else {
        toast.success('Pago registrado correctamente')
        setRef('')
        setValor('')
        setSelectedCobro('')
      }
    })
  }

  return (
    <div className="space-y-4">
      {/* Resumen */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-green-50 border border-green-100 p-2.5 text-center">
          <p className="text-[10px] text-green-600 font-medium">Cobrado</p>
          <p className="text-sm font-bold text-green-700 tabular-nums">
            {fmt(cobrado.reduce((s, c) => s + c.monto, 0))}
          </p>
        </div>
        <div className="rounded-lg bg-blue-50 border border-blue-100 p-2.5 text-center">
          <p className="text-[10px] text-blue-600 font-medium">Por cobrar</p>
          <p className="text-sm font-bold text-blue-700 tabular-nums">
            {fmt(porCobrar.reduce((s, c) => s + c.monto, 0))}
          </p>
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-100 p-2.5 text-center">
          <p className="text-[10px] text-amber-600 font-medium">Cartera</p>
          <p className="text-sm font-bold text-amber-700 tabular-nums">{fmt(cartera)}</p>
        </div>
      </div>

      {/* Lista de cobros */}
      {cobros.length === 0 ? (
        <p className="text-center text-xs text-[#6B7280] py-2">Sin cobros registrados</p>
      ) : (
        <div className="space-y-1.5">
          {cobros.map(cobro => (
            <div key={cobro.id} className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] p-2.5">
              {cobro.estado_causacion === 'CAUSADO' || cobro.estado_causacion === 'APROBADO' ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />
              ) : cobro.estado_causacion === 'PENDIENTE' ? (
                <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
              ) : (
                <AlertCircle className="h-3.5 w-3.5 text-[#6B7280]/40 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-[#1A1A1A] truncate">
                  {cobro.concepto ?? 'Cobro'}
                  {cobro.tipo_cobro && cobro.tipo_cobro !== 'regular' && (
                    <span className="ml-1 inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0 text-[9px] font-medium text-slate-600">
                      {TIPO_LABELS[cobro.tipo_cobro]}
                    </span>
                  )}
                </p>
                <p className="text-[10px] text-[#6B7280]">{fmtDate(cobro.fecha)}</p>
              </div>
              <span className="text-xs font-semibold text-[#1A1A1A] tabular-nums shrink-0">
                {fmt(cobro.monto)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Registrar pago */}
      {porCobrar.length > 0 && (
        <div className="rounded-lg border border-[#10B981]/30 bg-[#10B981]/5 p-3 space-y-2">
          <div className="flex items-center gap-1.5">
            <Banknote className="h-3.5 w-3.5 text-[#10B981]" />
            <p className="text-xs font-semibold text-[#1A1A1A]">Confirmar pago</p>
          </div>
          <select
            value={selectedCobro}
            onChange={e => setSelectedCobro(e.target.value)}
            className="w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none"
          >
            <option value="">Seleccionar cobro...</option>
            {porCobrar.map(c => (
              <option key={c.id} value={c.id}>
                {c.concepto ?? 'Cobro'} — {fmt(c.monto)}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <input
              type="text"
              placeholder="Referencia de pago"
              value={ref}
              onChange={e => setRef(e.target.value)}
              className="flex-1 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none"
            />
            <input
              type="number"
              placeholder="Valor (opcional)"
              value={valor}
              onChange={e => setValor(e.target.value)}
              className="w-28 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none"
            />
          </div>
          <button
            onClick={handleConfirmar}
            disabled={isPending || !selectedCobro}
            className="w-full rounded-lg bg-[#10B981] py-1.5 text-xs font-semibold text-white hover:bg-[#059669] disabled:opacity-40 transition-colors"
          >
            {isPending ? 'Confirmando...' : 'Confirmar pago'}
          </button>
        </div>
      )}
    </div>
  )
}
