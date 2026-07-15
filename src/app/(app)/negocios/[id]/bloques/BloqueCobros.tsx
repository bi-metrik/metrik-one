'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { CheckCircle2, Clock, AlertTriangle, Trash2, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { confirmarCobroProgramado } from './plan-recurrente-actions'
import { eliminarPorcionPago } from '@/lib/actions/conciliacion-actions'
import type { PendienteHandoff, ModeloDinero } from '@/lib/upme/modelo-dinero'

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
  /** true si es una porción de un reparto propuesto por el comercial (split_json.origen==='comercial'). */
  es_reparto_comercial?: boolean
}

interface BloqueCobrosProps {
  negocioId: string
  cobros: Cobro[]
  modo: 'editable' | 'visible'
  precioTotal: number
  /** Pendiente para pasar a operaciones (solo cuando la etapa tiene el gate saldo:handoff). */
  pendienteHandoff?: PendienteHandoff | null
  /** Modelo de dinero del negocio (plan de pago + honorario + tarifa UPME) leído de la propuesta aprobada. */
  modeloDinero?: ModeloDinero | null
  /**
   * Stage del negocio. Cuando es 'venta' Y modo='editable', el comercial puede
   * eliminar una porción de pago que él propuso (es_reparto_comercial) — el server
   * (eliminarPorcionPago) valida además que no esté conciliada.
   */
  stageActual?: string | null
}

/** Etiqueta legible del plan de pago elegido por el cliente en la propuesta. */
const PLAN_PAGO_LABEL: Record<1 | 2, { titulo: string; detalle: string }> = {
  1: { titulo: 'Plan 1 · 50/50', detalle: 'Anticipo (tarifa UPME + 50% honorario) y saldo del honorario a la certificación' },
  2: { titulo: 'Plan 2 · Pago único', detalle: 'Tarifa UPME + 100% del honorario en un solo pago' },
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

function CobroConfirmadoRow({ cobro, eliminable }: { cobro: Cobro; eliminable: boolean }) {
  const router = useRouter()
  const [confirmando, setConfirmando] = useState(false)
  const [isPending, startTransition] = useTransition()

  const handleEliminar = () => {
    startTransition(async () => {
      const res = await eliminarPorcionPago(cobro.id)
      if (res.success) {
        toast.success('Porción eliminada. La referencia queda con saldo sin asignar.')
        setConfirmando(false)
        router.refresh()
      } else {
        toast.error(res.error)
        setConfirmando(false)
      }
    })
  }

  return (
    <div className="rounded-lg border border-[#E5E7EB] p-2.5">
      <div className="flex items-center gap-2">
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
            {cobro.es_reparto_comercial && (
              <span className="ml-1 inline-flex items-center rounded-full bg-[#EEF2FF] px-1.5 py-0 text-[9px] font-medium text-[#4F46E5]">
                Reparto propuesto
              </span>
            )}
          </p>
          {cobro.external_ref && <p className="text-[10px] text-[#6B7280]">Ref: {cobro.external_ref}</p>}
          {cobro.fecha && <p className="text-[10px] text-[#6B7280]">{fmtDate(cobro.fecha)}</p>}
        </div>
        <span className="text-xs font-semibold text-[#1A1A1A] tabular-nums shrink-0">
          {fmt(cobro.monto)}
        </span>
        {eliminable && !confirmando && (
          <button
            onClick={() => setConfirmando(true)}
            title="Eliminar esta porción (libera la referencia)"
            className="shrink-0 rounded p-1 hover:bg-red-50"
          >
            <Trash2 className="h-3.5 w-3.5 text-[#DC2626]" />
          </button>
        )}
      </div>

      {eliminable && confirmando && (
        <div className="mt-2 flex items-center justify-between gap-2 rounded-md border border-[#FECACA] bg-[#FEF2F2] px-2.5 py-2">
          <p className="text-[11px] text-[#B91C1C]">¿Eliminar esta porción? Libera la referencia para volver a repartir.</p>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => setConfirmando(false)}
              disabled={isPending}
              className="rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[11px] font-medium text-[#6B7280] hover:bg-[#F5F4F2] disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              onClick={handleEliminar}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-md bg-[#DC2626] px-2 py-1 text-[11px] font-semibold text-white hover:bg-[#B91C1C] disabled:opacity-50"
            >
              {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
              Eliminar
            </button>
          </div>
        </div>
      )}
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

export default function BloqueCobros({ cobros, precioTotal, modo, pendienteHandoff, modeloDinero, stageActual }: BloqueCobrosProps) {
  // El comercial puede eliminar una porción que él propuso mientras el negocio esté
  // en venta (modo editable). El server valida además "no conciliada".
  const permiteEliminar = modo === 'editable' && stageActual === 'venta'
  // Confirmados = todos los cobros con fecha (entraron). Cuentan en saldo.
  const confirmados = cobros.filter(c => c.fecha !== null)
  // Programados pendientes = tipo programado + sin fecha confirmada
  const programados = cobros.filter(c => c.tipo_cobro === 'programado' && c.fecha === null)

  const totalCobrado = confirmados.reduce((s, c) => s + c.monto, 0)
  const saldoPendiente = precioTotal - totalCobrado
  const programadosVencidos = programados.filter(c => c.vencido).length
  const bloqueaHandoff = pendienteHandoff != null && pendienteHandoff.pendienteTotal > 0
  const plan = modeloDinero?.aprobado_plan
  const planLabel = plan === 1 || plan === 2 ? PLAN_PAGO_LABEL[plan] : null

  return (
    <div className="space-y-4">
      {/* Plan de pago elegido por el cliente (de la propuesta aprobada). Visible para
          que financiera haga seguimiento sin buscarlo en la propuesta. */}
      {planLabel && (
        <div className="rounded-lg border border-[#10B981]/30 bg-[#10B981]/5 p-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[#6B7280]">Plan de pago</p>
            <span className="inline-flex items-center rounded-full bg-[#10B981]/10 px-2 py-0.5 text-[11px] font-semibold text-[#059669]">
              {planLabel.titulo}
            </span>
          </div>
          <p className="mt-1 text-[10px] text-[#6B7280]">{planLabel.detalle}</p>
          {(modeloDinero?.aprobado_honorario != null || (modeloDinero?.tarifa_upme ?? 0) > 0) && (
            <div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-[#6B7280]">
              {modeloDinero?.aprobado_honorario != null && (
                <span>Honorario: <span className="font-medium text-[#1A1A1A] tabular-nums">{fmt(modeloDinero.aprobado_honorario)}</span></span>
              )}
              {(modeloDinero?.tarifa_upme ?? 0) > 0 && (
                <span>Tarifa UPME: <span className="font-medium text-[#1A1A1A] tabular-nums">{fmt(modeloDinero!.tarifa_upme)}</span></span>
              )}
            </div>
          )}
        </div>
      )}

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
              <CobroConfirmadoRow
                key={c.id}
                cobro={c}
                eliminable={permiteEliminar && c.es_reparto_comercial === true}
              />
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
