'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Clock, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { confirmarCobroProgramado } from './plan-recurrente-actions'
import type { PendienteHandoff } from '@/lib/upme/modelo-dinero'

interface Cobro {
  id: string
  concepto: string | null
  monto: number
  revisado: boolean
  tipo_cobro: string | null
  fecha: string | null
  fecha_esperada: string | null
  numero_cuota: number | null
  vencido: boolean
  notas: string | null
  external_ref: string | null
}

interface BloqueCobrosProps {
  negocioId: string
  cobros: Cobro[]
  modo: 'editable' | 'visible'
  precioTotal: number
  /** Pendiente para pasar a operaciones (solo cuando la etapa tiene el gate saldo:handoff). */
  pendienteHandoff?: PendienteHandoff | null
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

function fmtDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
}

const TIPO_LABELS: Record<string, string> = {
  regular: 'Regular',
  anticipo: 'Anticipo',
  saldo: 'Saldo',
  pago: 'Pago',
  programado: 'Cuota',
  // Recaudo a favor de terceros (ej. tarifa UPME): cuadra el saldo pero NO es
  // ingreso de SOENA (excluido de recaudo/MC/EBITDA).
  pasante: 'Pasante',
}

function CobroConfirmadoRow({ cobro }: { cobro: Cobro }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] p-2.5">
      <CheckCircle2 className="h-4 w-4 text-[#10B981] shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[#1A1A1A] truncate">
          {cobro.concepto ?? 'Cobro'}
          {cobro.tipo_cobro && cobro.tipo_cobro !== 'regular' && (
            <span className="ml-1 inline-flex items-center rounded-full bg-[#F5F4F2] px-1.5 py-0 text-[9px] font-medium text-[#6B7280]">
              {TIPO_LABELS[cobro.tipo_cobro] ?? cobro.tipo_cobro}
              {cobro.numero_cuota ? ` ${cobro.numero_cuota}` : ''}
            </span>
          )}
        </p>
        {cobro.external_ref && <p className="text-[10px] text-[#6B7280]">Ref: {cobro.external_ref}</p>}
        {cobro.fecha && <p className="text-[10px] text-[#6B7280]">{fmtDate(cobro.fecha)}</p>}
      </div>
      <span className="text-xs font-semibold text-[#1A1A1A] tabular-nums shrink-0">
        {fmt(cobro.monto)}
      </span>
    </div>
  )
}

function CobroProgramadoRow({ cobro, modo }: { cobro: Cobro; modo: 'editable' | 'visible' }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const vencido = cobro.vencido === true

  const handleConfirmar = () => {
    startTransition(async () => {
      const res = await confirmarCobroProgramado(cobro.id)
      if (res.success) {
        toast.success('Cobro confirmado')
        router.refresh()
      } else {
        toast.error(res.error ?? 'Error confirmando cobro')
      }
    })
  }

  return (
    <div className={`rounded-lg border p-2.5 ${
      vencido ? 'border-[#EF4444]/40 bg-[#EF4444]/5' : 'border-[#E5E7EB] bg-[#F5F4F2]'
    }`}>
      <div className="flex items-center gap-2">
        {vencido ? (
          <AlertTriangle className="h-4 w-4 text-[#EF4444] shrink-0" />
        ) : (
          <Clock className="h-4 w-4 text-[#6B7280] shrink-0" />
        )}
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[#1A1A1A]">
            {cobro.numero_cuota ? `Cuota ${cobro.numero_cuota}` : 'Cuota'}
            <span className={`ml-2 text-[10px] font-normal ${vencido ? 'text-[#EF4444]' : 'text-[#6B7280]'}`}>
              {vencido ? 'Vencida' : 'Esperada'} el {fmtDate(cobro.fecha_esperada)}
            </span>
          </p>
        </div>
        <span className="text-xs font-semibold text-[#1A1A1A] tabular-nums shrink-0">
          {fmt(cobro.monto)}
        </span>
      </div>

      {modo === 'editable' && (
        <div className="mt-2 flex justify-end">
          <button
            onClick={handleConfirmar}
            disabled={isPending}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
              vencido
                ? 'bg-[#10B981] text-white hover:bg-[#059669]'
                : 'border border-[#E5E7EB] bg-white text-[#1A1A1A] hover:bg-[#F5F4F2]'
            }`}
          >
            {isPending ? 'Confirmando...' : 'Confirmar pago manual'}
          </button>
        </div>
      )}
    </div>
  )
}

export default function BloqueCobros({ cobros, precioTotal, modo, pendienteHandoff }: BloqueCobrosProps) {
  // Confirmados = todos los cobros con fecha (entraron). Cuentan en saldo.
  const confirmados = cobros.filter(c => c.fecha !== null)
  // Programados pendientes = tipo programado + sin fecha confirmada
  const programados = cobros.filter(c => c.tipo_cobro === 'programado' && c.fecha === null)

  const totalCobrado = confirmados.reduce((s, c) => s + c.monto, 0)
  const saldoPendiente = precioTotal - totalCobrado
  const programadosVencidos = programados.filter(c => c.vencido).length
  const bloqueaHandoff = pendienteHandoff != null && pendienteHandoff.pendienteTotal > 0

  return (
    <div className="space-y-4">
      {/* Resumen */}
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-[#10B981]/30 bg-[#10B981]/5 p-2.5 text-center">
          <p className="text-[10px] font-medium text-[#059669]">Cobrado</p>
          <p className="text-sm font-bold text-[#059669] tabular-nums">{fmt(totalCobrado)}</p>
        </div>
        <div className="rounded-lg border border-[#E5E7EB] bg-[#F5F4F2] p-2.5 text-center">
          <p className="text-[10px] font-medium text-[#6B7280]">Saldo</p>
          <p className="text-sm font-bold text-[#1A1A1A] tabular-nums">
            {fmt(saldoPendiente > 0 ? saldoPendiente : 0)}
          </p>
        </div>
      </div>

      {/* Pendiente para pasar a operaciones (gate saldo:handoff). El cliente debe
          cubrir el 100% de la tarifa UPME + el honorario del plan antes del handoff. */}
      {bloqueaHandoff && (
        <div className="rounded-lg border border-[#EF4444]/30 bg-[#EF4444]/5 p-2.5">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#EF4444] shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-[#1A1A1A]">Pendiente para pasar a operaciones</p>
              <p className="text-[10px] text-[#6B7280]">
                El cliente debe cubrir la tarifa UPME y el honorario del plan antes del handoff.
              </p>
            </div>
            <span className="text-sm font-bold text-[#EF4444] tabular-nums shrink-0">
              {fmt(pendienteHandoff!.pendienteTotal)}
            </span>
          </div>
          {(pendienteHandoff!.pendienteUpme > 0 || pendienteHandoff!.pendienteHonorario > 0) && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 pl-6 text-[10px] text-[#6B7280]">
              {pendienteHandoff!.pendienteUpme > 0 && (
                <span>UPME: <span className="font-medium text-[#1A1A1A] tabular-nums">{fmt(pendienteHandoff!.pendienteUpme)}</span></span>
              )}
              {pendienteHandoff!.pendienteHonorario > 0 && (
                <span>Honorario: <span className="font-medium text-[#1A1A1A] tabular-nums">{fmt(pendienteHandoff!.pendienteHonorario)}</span></span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Programados pendientes */}
      {programados.length > 0 && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
              Pendientes de pago ({programados.length})
            </p>
            {programadosVencidos > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-[#EF4444]/10 px-2 py-0.5 text-[10px] font-medium text-[#EF4444]">
                <AlertTriangle className="h-2.5 w-2.5" />
                {programadosVencidos} vencido{programadosVencidos > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="space-y-1.5">
            {programados.map(c => (
              <CobroProgramadoRow key={c.id} cobro={c} modo={modo} />
            ))}
          </div>
        </div>
      )}

      {/* Confirmados */}
      {confirmados.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6B7280]">
            Cobros recibidos ({confirmados.length})
          </p>
          <div className="space-y-1.5">
            {confirmados.map(c => (
              <CobroConfirmadoRow key={c.id} cobro={c} />
            ))}
          </div>
        </div>
      ) : (
        programados.length === 0 && (
          <p className="text-center text-xs text-[#6B7280] py-4">Sin cobros registrados</p>
        )
      )}
    </div>
  )
}
