'use client'

import { useState, useTransition, useEffect } from 'react'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  registrarPagoExterno,
  type PagoExternoRegistrado,
} from '@/lib/actions/pago-externo-actions'
import { todayBogotaISO } from '@/lib/dates/bogota'
import type { NegocioBloque } from '../../negocio-v2-actions'

interface BloquePagoExternoProps {
  negocioBloqueId: string
  negocioId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  nota?: string // texto guía explícito sobre qué referencia ingresar
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(v)

function fmtDate(iso: string) {
  if (!iso) return ''
  // iso 'YYYY-MM-DD' — construir Date local sin sufijo Z para no correr el día
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export default function BloquePagoExterno({
  negocioBloqueId,
  negocioId,
  instancia,
  modo,
  nota,
}: BloquePagoExternoProps) {
  const [pagos, setPagos] = useState<PagoExternoRegistrado[]>(
    () => ((instancia?.data as { pagos_externos?: PagoExternoRegistrado[] } | null)?.pagos_externos) ?? [],
  )

  // Re-sincronizar con la prop tras revalidatePath (mismo patrón que BloquePagosEpayco).
  useEffect(() => {
    const dbPagos =
      ((instancia?.data as { pagos_externos?: PagoExternoRegistrado[] } | null)?.pagos_externos) ?? []
    setPagos(dbPagos)
  }, [instancia?.data])

  const [showForm, setShowForm] = useState(false)
  const [monto, setMonto] = useState('')
  const [referencia, setReferencia] = useState('')
  const [fecha, setFecha] = useState(() => todayBogotaISO())
  const [retefuente, setRetefuente] = useState('')
  const [reteica, setReteica] = useState('')
  const [isPending, startTransition] = useTransition()

  const total = pagos.reduce((s, p) => s + p.monto_bruto, 0)

  function resetForm() {
    setMonto('')
    setReferencia('')
    setFecha(todayBogotaISO())
    setRetefuente('')
    setReteica('')
    setShowForm(false)
  }

  function handleRegistrar() {
    const montoNum = Number(monto)
    if (!Number.isFinite(montoNum) || montoNum <= 0) {
      toast.error('Ingresa un monto válido')
      return
    }
    if (!referencia.trim()) {
      toast.error('Ingresa la referencia o comprobante')
      return
    }
    startTransition(async () => {
      const result = await registrarPagoExterno(negocioBloqueId, negocioId, {
        monto: montoNum,
        referencia: referencia.trim(),
        fecha,
        retefuente: retefuente ? Number(retefuente) : undefined,
        reteica: reteica ? Number(reteica) : undefined,
      })
      if (!result.success) {
        toast.error(result.error)
      } else {
        setPagos(result.pagos)
        resetForm()
        toast.success('Pago externo registrado')
      }
    })
  }

  // ── Lista de pagos (compartida entre modos) ─────────────────────────────────
  const lista = (
    <>
      {pagos.length === 0 && (
        <p className="text-xs text-[#6B7280] italic">Sin pagos externos registrados</p>
      )}
      {pagos.map((p, i) => (
        <div
          key={p.cobro_id ?? i}
          className="flex items-center gap-3 rounded-lg border border-[#E5E7EB] bg-white p-3"
        >
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-[#1A1A1A]">Ref: {p.referencia}</span>
              <span className="rounded bg-[#EFF6FF] px-1.5 py-0.5 text-[9px] font-medium text-[#3B82F6] border border-[#BFDBFE]">
                externo
              </span>
            </div>
            <p className="text-[10px] text-[#6B7280] mt-0.5">{fmtDate(p.fecha)}</p>
            {(p.retefuente > 0 || p.reteica > 0) && (
              <p className="text-[10px] text-[#6B7280] tabular-nums">
                {[
                  p.retefuente > 0 && `ReteFuente: -${fmt(p.retefuente)}`,
                  p.reteica > 0 && `ReteICA: -${fmt(p.reteica)}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-xs font-semibold text-[#1A1A1A] tabular-nums">{fmt(p.monto_bruto)}</p>
            {(p.retefuente > 0 || p.reteica > 0) && (
              <p className="text-[10px] text-[#6B7280] tabular-nums">Neto: {fmt(p.monto_neto)}</p>
            )}
          </div>
        </div>
      ))}
      {pagos.length > 0 && (
        <div className="rounded-lg bg-slate-50 border border-slate-100 p-2.5 flex items-center justify-between">
          <span className="text-[10px] text-[#6B7280] font-medium">
            {pagos.length} pago{pagos.length > 1 ? 's' : ''} externo{pagos.length > 1 ? 's' : ''}
          </span>
          <span className="text-sm font-bold text-[#1A1A1A] tabular-nums">{fmt(total)}</span>
        </div>
      )}
    </>
  )

  // ── Modo visible ────────────────────────────────────────────────────────────
  if (modo === 'visible') {
    return <div className="space-y-1.5">{lista}</div>
  }

  // ── Modo editable ───────────────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {pagos.length > 0 && <div className="space-y-1.5">{lista}</div>}

      {nota && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] leading-relaxed text-amber-900">
          {nota}
        </div>
      )}

      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-medium text-[#1A1A1A] hover:bg-[#F5F4F2] transition-colors"
        >
          <Plus className="h-3.5 w-3.5" />
          Agregar pago externo
        </button>
      ) : (
        <div className="rounded-lg border border-[#E5E7EB] bg-white p-3 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium text-[#6B7280]">Nuevo pago externo</p>
            <button
              onClick={resetForm}
              disabled={isPending}
              className="text-[#6B7280] hover:text-[#1A1A1A] disabled:opacity-50"
              aria-label="Cancelar"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="col-span-2">
              <label className="block text-[10px] font-medium text-[#6B7280] mb-1">Monto recibido</label>
              <input
                type="text"
                inputMode="numeric"
                value={monto}
                onChange={e => setMonto(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="Ej: 1500000"
                disabled={isPending}
                className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 focus:border-[#10B981] disabled:opacity-60"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-[10px] font-medium text-[#6B7280] mb-1">
                Referencia / comprobante
              </label>
              <input
                type="text"
                value={referencia}
                onChange={e => setReferencia(e.target.value)}
                placeholder="Ej: consignación, transferencia, recibo #..."
                disabled={isPending}
                className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 focus:border-[#10B981] disabled:opacity-60"
              />
            </div>

            <div className="col-span-2">
              <label className="block text-[10px] font-medium text-[#6B7280] mb-1">Fecha del pago</label>
              <input
                type="date"
                value={fecha}
                onChange={e => setFecha(e.target.value)}
                disabled={isPending}
                className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 focus:border-[#10B981] disabled:opacity-60"
              />
            </div>

            <div>
              <label className="block text-[10px] font-medium text-[#6B7280] mb-1">ReteFuente (opc.)</label>
              <input
                type="text"
                inputMode="numeric"
                value={retefuente}
                onChange={e => setRetefuente(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="0"
                disabled={isPending}
                className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 focus:border-[#10B981] disabled:opacity-60"
              />
            </div>

            <div>
              <label className="block text-[10px] font-medium text-[#6B7280] mb-1">ReteICA (opc.)</label>
              <input
                type="text"
                inputMode="numeric"
                value={reteica}
                onChange={e => setReteica(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="0"
                disabled={isPending}
                className="w-full rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs text-[#1A1A1A] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 focus:border-[#10B981] disabled:opacity-60"
              />
            </div>
          </div>

          <button
            onClick={handleRegistrar}
            disabled={isPending}
            className="w-full rounded-lg bg-[#10B981] py-2 text-xs font-semibold text-white hover:bg-[#059669] disabled:opacity-40 transition-colors"
          >
            {isPending ? 'Registrando...' : 'Registrar pago externo'}
          </button>
        </div>
      )}
    </div>
  )
}
