'use client'

import { CheckCircle2, Clock, AlertCircle } from 'lucide-react'

interface Cobro {
  id: string
  concepto: string | null
  monto: number
  revisado: boolean
  tipo_cobro: string | null
  fecha: string | null
  notas: string | null
  external_ref: string | null
}

interface BloqueCobrosProps {
  negocioId: string
  cobros: Cobro[]
  modo: 'editable' | 'visible'
  precioTotal: number
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
}

function CobroRow({ cobro }: { cobro: Cobro }) {
  const isPendiente = !cobro.revisado
  const isValidado = cobro.revisado === true

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] p-2.5">
      {/* Estado del cobro (solo lectura — aprobación desde Movimientos) */}
      {isValidado ? (
        <CheckCircle2 className="h-4 w-4 text-green-500 shrink-0" />
      ) : isPendiente ? (
        <Clock className="h-4 w-4 text-amber-400 shrink-0" />
      ) : (
        <AlertCircle className="h-4 w-4 text-[#6B7280]/40 shrink-0" />
      )}

      {/* Info */}
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-[#1A1A1A] truncate">
          {cobro.concepto ?? 'Cobro'}
          {cobro.tipo_cobro && cobro.tipo_cobro !== 'regular' && (
            <span className="ml-1 inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0 text-[9px] font-medium text-slate-600">
              {TIPO_LABELS[cobro.tipo_cobro] ?? cobro.tipo_cobro}
            </span>
          )}
        </p>
        {cobro.external_ref && (
          <p className="text-[10px] text-[#6B7280]">Ref: {cobro.external_ref}</p>
        )}
        {cobro.fecha && (
          <p className="text-[10px] text-[#6B7280]">{fmtDate(cobro.fecha)}</p>
        )}
      </div>

      {/* Monto */}
      <span className="text-xs font-semibold text-[#1A1A1A] tabular-nums shrink-0">
        {fmt(cobro.monto)}
      </span>
    </div>
  )
}

export default function BloqueCobros({ cobros, precioTotal }: BloqueCobrosProps) {
  const cobrado = cobros.filter(c => c.revisado === true)
  const totalCobrado = cobrado.reduce((s, c) => s + c.monto, 0)
  const totalRegistrado = cobros.reduce((s, c) => s + c.monto, 0)
  const saldoPendiente = precioTotal - totalRegistrado

  return (
    <div className="space-y-4">
      {/* Resumen */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-lg bg-green-50 border border-green-100 p-2.5 text-center">
          <p className="text-[10px] text-green-600 font-medium">Cobrado</p>
          <p className="text-sm font-bold text-green-700 tabular-nums">
            {fmt(totalCobrado)}
          </p>
        </div>
        <div className="rounded-lg bg-blue-50 border border-blue-100 p-2.5 text-center">
          <p className="text-[10px] text-blue-600 font-medium">Registrado</p>
          <p className="text-sm font-bold text-blue-700 tabular-nums">
            {fmt(totalRegistrado)}
          </p>
        </div>
        <div className="rounded-lg bg-amber-50 border border-amber-100 p-2.5 text-center">
          <p className="text-[10px] text-amber-600 font-medium">Saldo</p>
          <p className="text-sm font-bold text-amber-700 tabular-nums">
            {fmt(saldoPendiente > 0 ? saldoPendiente : 0)}
          </p>
        </div>
      </div>

      {/* Lista de cobros */}
      {cobros.length === 0 ? (
        <p className="text-center text-xs text-[#6B7280] py-2">Sin cobros registrados</p>
      ) : (
        <div className="space-y-1.5">
          {cobros.map(cobro => (
            <CobroRow key={cobro.id} cobro={cobro} />
          ))}
        </div>
      )}

      {/* Indicador de pendientes */}
      {cobros.some(c => !c.revisado) && (
        <div className="flex items-center gap-1.5 text-[10px] text-[#6B7280]">
          <Clock className="h-3 w-3" />
          <span>Aprobación desde Movimientos</span>
        </div>
      )}
    </div>
  )
}
