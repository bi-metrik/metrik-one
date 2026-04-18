'use client'

import { useState, useTransition } from 'react'
import { Search } from 'lucide-react'
import { toast } from 'sonner'
import { consultarEpayco, registrarPagoEpayco } from '@/lib/actions/epayco-actions'
import type { EpaycoDesglose } from '@/lib/epayco'
import type { NegocioBloque } from '../../negocio-v2-actions'

export interface PagoRegistrado {
  ref_payco: number
  monto_bruto: number
  pagador_nombre: string
  total_descuentos: number
  monto_neto: number
  tipo_cobro: string
  fecha: string
}

interface BloquePagosEpaycoProps {
  negocioBloqueId: string
  negocioId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  tipoCobro: string // 'anticipo' | 'pago'
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function BloquePagosEpayco({
  negocioBloqueId,
  negocioId,
  instancia,
  modo,
  tipoCobro,
}: BloquePagosEpaycoProps) {
  const [pagos, setPagos] = useState<PagoRegistrado[]>(
    () => ((instancia?.data as { pagos?: PagoRegistrado[] } | null)?.pagos) ?? []
  )
  const [newRef, setNewRef] = useState('')
  const [previewDesglose, setPreviewDesglose] = useState<EpaycoDesglose | null>(null)
  const [consultando, setConsultando] = useState(false)
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const total = pagos.reduce((s, p) => s + p.monto_bruto, 0)

  async function handleConsultar() {
    if (!newRef.trim()) return
    setConsultando(true)
    setError(null)
    setPreviewDesglose(null)
    try {
      const result = await consultarEpayco(newRef.trim())
      if (!result.success) {
        setError(result.error)
      } else {
        // Check if already registered
        if (pagos.some(p => p.ref_payco === result.data.ref_payco)) {
          setError('Este pago ya esta registrado')
        } else {
          setPreviewDesglose(result.data)
        }
      }
    } catch {
      setError('Error consultando ePayco')
    } finally {
      setConsultando(false)
    }
  }

  function handleRegistrar() {
    if (!previewDesglose) return
    startTransition(async () => {
      const result = await registrarPagoEpayco(negocioBloqueId, negocioId, previewDesglose, tipoCobro)
      if (!result.success) {
        toast.error(result.error)
      } else {
        setPagos(result.pagos)
        setPreviewDesglose(null)
        setNewRef('')
        setError(null)
        toast.success('Pago registrado')
      }
    })
  }

  // ── Modo visible ────────────────────────────────────────────────────────────
  if (modo === 'visible') {
    return (
      <div className="space-y-1.5">
        {pagos.length === 0 && <p className="text-xs text-[#6B7280] italic">Sin pagos registrados</p>}
        {pagos.map((p, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] p-2.5">
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[#1A1A1A]">Ref: {p.ref_payco}</p>
              <p className="text-[10px] text-[#6B7280]">{p.pagador_nombre}</p>
            </div>
            <span className="text-xs font-semibold text-[#1A1A1A] tabular-nums shrink-0">
              {fmt(p.monto_bruto)}
            </span>
          </div>
        ))}
        {pagos.length > 0 && (
          <div className="rounded-lg bg-slate-50 border border-slate-100 p-2 text-center">
            <p className="text-[10px] text-[#6B7280] font-medium">{pagos.length} pago{pagos.length > 1 ? 's' : ''}</p>
            <p className="text-sm font-bold text-[#1A1A1A] tabular-nums">
              {fmt(total)}
            </p>
          </div>
        )}
      </div>
    )
  }

  // ── Modo editable ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* Existing payments list */}
      {pagos.length > 0 && (
        <div className="space-y-1.5">
          {pagos.map((p, i) => (
            <div key={i} className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] bg-white p-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-[#1A1A1A]">Ref: {p.ref_payco}</span>
                  <span className="rounded bg-[#F0FDF4] px-1.5 py-0.5 text-[9px] font-medium text-[#10B981] border border-[#BBF7D0]">
                    verificado
                  </span>
                </div>
                <p className="text-[10px] text-[#6B7280] mt-0.5">{p.pagador_nombre}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs font-semibold text-[#1A1A1A] tabular-nums">{fmt(p.monto_bruto)}</p>
                <p className="text-[10px] text-[#6B7280] tabular-nums">Neto: {fmt(p.monto_neto)}</p>
              </div>
            </div>
          ))}

          {/* Total bar */}
          <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5 flex items-center justify-between">
            <span className="text-[10px] text-[#6B7280] font-medium">{pagos.length} pago{pagos.length > 1 ? 's' : ''} registrado{pagos.length > 1 ? 's' : ''}</span>
            <span className="text-sm font-bold text-[#1A1A1A] tabular-nums">{fmt(total)}</span>
          </div>
        </div>
      )}

      {/* New payment section */}
      <div className="border-t border-[#E5E7EB] pt-3 mt-1">
        <p className="text-[11px] font-medium text-[#6B7280] mb-2">Nuevo pago</p>
        <div className="flex gap-2">
          <div className="flex-1">
            <input
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={9}
              value={newRef}
              onChange={e => {
                const v = e.target.value.replace(/\D/g, '')
                if (v.length <= 9) setNewRef(v)
              }}
              placeholder="Ej: 344799998"
              disabled={consultando || isPending}
              className={`w-full rounded-lg border bg-white px-3 py-2 text-xs text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 disabled:opacity-60 ${
                newRef.length > 0 && newRef.length !== 9
                  ? 'border-amber-400 focus:border-amber-400'
                  : 'border-[#E5E7EB] focus:border-[#10B981]'
              }`}
            />
            <p className="mt-1 text-[10px] text-[#6B7280]">
              La referencia debe tener 9 digitos{newRef.length > 0 && newRef.length !== 9 && (
                <span className="text-amber-600 font-medium"> ({newRef.length}/9)</span>
              )}
            </p>
          </div>
          <button
            onClick={handleConsultar}
            disabled={consultando || newRef.length !== 9}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[#3B82F6] px-3 py-2 text-[10px] font-medium text-white hover:bg-[#2563EB] disabled:opacity-60 transition-colors whitespace-nowrap self-start"
          >
            {consultando ? 'Consultando...' : <><Search className="h-3 w-3" />Consultar</>}
          </button>
        </div>
      </div>

      {/* Error */}
      {error && <p className="text-[11px] text-red-600 font-medium">{error}</p>}

      {/* Preview card */}
      {previewDesglose && (
        <div className="rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] p-3 space-y-1">
          <p className="text-xs font-semibold text-[#10B981]">Transaccion verificada</p>
          <p className="text-xs text-[#1A1A1A]">Pagador: {previewDesglose.pagador_nombre}</p>
          <p className="text-xs text-[#1A1A1A] tabular-nums">Monto: {fmt(previewDesglose.monto_bruto)}</p>
          <p className="text-xs text-[#1A1A1A] tabular-nums">Comision ePayco: -{fmt(previewDesglose.total_descuentos)}</p>
          {(previewDesglose.comision > 0 || previewDesglose.iva_comision > 0 || previewDesglose.retefuente > 0 || previewDesglose.reteica > 0) && (
            <p className="text-[10px] text-[#6B7280] tabular-nums pl-2">
              {[
                previewDesglose.comision > 0 && `Comision: ${fmt(previewDesglose.comision)}`,
                previewDesglose.iva_comision > 0 && `IVA: ${fmt(previewDesglose.iva_comision)}`,
                previewDesglose.retefuente > 0 && `ReteFuente: -${fmt(previewDesglose.retefuente)}`,
                previewDesglose.reteica > 0 && `ReteICA: -${fmt(previewDesglose.reteica)}`,
              ].filter(Boolean).join(' + ')}
            </p>
          )}
          <p className="text-xs font-semibold text-[#1A1A1A] tabular-nums">Neto: {fmt(previewDesglose.monto_neto)}</p>
          <button
            onClick={handleRegistrar}
            disabled={isPending}
            className="w-full mt-2 rounded-lg bg-[#10B981] py-2 text-xs font-semibold text-white hover:bg-[#059669] disabled:opacity-40 transition-colors"
          >
            {isPending ? 'Registrando...' : 'Registrar pago'}
          </button>
        </div>
      )}
    </div>
  )
}
