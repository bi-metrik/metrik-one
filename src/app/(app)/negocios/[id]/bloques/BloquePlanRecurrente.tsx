'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Calendar, RefreshCw, CheckCircle2, AlertCircle } from 'lucide-react'
import { toast } from 'sonner'
import { formatCOP } from '@/lib/contacts/constants'
import { crearPlanRecurrente, cancelarPlan } from './plan-recurrente-actions'

type Frecuencia = 'mensual' | 'trimestral' | 'anual'
type Pasarela = 'wompi' | 'manual' | 'mixto'

interface PlanData {
  plan_id?: string
  monto?: number
  frecuencia?: Frecuencia
  fecha_inicio?: string
  fecha_fin?: string
  total_cuotas?: number
  pasarela?: Pasarela
  auto_renovar?: boolean
}

interface BloqueInstancia {
  id: string
  completado: boolean
  data: Record<string, unknown> | null
}

interface ConfigExtra {
  label?: string
  pasarela_default?: Pasarela
  permite_auto_renovar?: boolean
  frecuencia_default?: Frecuencia
}

interface Props {
  negocioId: string
  negocioBloqueId: string
  instancia: BloqueInstancia | null
  modo: 'editable' | 'visible'
  configExtra: ConfigExtra
}

const FREC_LABEL: Record<Frecuencia, string> = {
  mensual: 'Mensual',
  trimestral: 'Trimestral',
  anual: 'Anual',
}

const PASARELA_LABEL: Record<Pasarela, string> = {
  wompi: 'Wompi',
  manual: 'Pago manual',
  mixto: 'Wompi + manual',
}

function addMeses(fechaIso: string, meses: number): string {
  const d = new Date(fechaIso + 'T00:00:00Z')
  d.setUTCMonth(d.getUTCMonth() + meses)
  return d.toISOString().split('T')[0]
}

function calcularFechaFin(fechaInicio: string, frecuencia: Frecuencia, totalCuotas: number): string {
  if (!fechaInicio || totalCuotas <= 0) return ''
  const offset = frecuencia === 'trimestral' ? 3 : frecuencia === 'anual' ? 12 : 1
  return addMeses(fechaInicio, (totalCuotas - 1) * offset)
}

function formatFechaCorta(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso + 'T00:00:00Z')
  return d.toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export default function BloquePlanRecurrente({
  negocioId,
  negocioBloqueId,
  instancia,
  modo,
  configExtra,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const completado = instancia?.completado === true
  const planData = (instancia?.data ?? null) as PlanData | null

  // Form state
  const [monto, setMonto] = useState('')
  const [frecuencia, setFrecuencia] = useState<Frecuencia>(configExtra.frecuencia_default ?? 'mensual')
  const [fechaInicio, setFechaInicio] = useState(new Date().toISOString().split('T')[0])
  const [totalCuotas, setTotalCuotas] = useState('12')
  const [pasarela, setPasarela] = useState<Pasarela>(configExtra.pasarela_default ?? 'manual')
  const [autoRenovar, setAutoRenovar] = useState(false)
  const [notas, setNotas] = useState('')

  const montoNum = parseFloat(monto) || 0
  const cuotasNum = parseInt(totalCuotas) || 0
  const fechaFinPreview = calcularFechaFin(fechaInicio, frecuencia, cuotasNum)
  const precioTotal = montoNum * cuotasNum

  const handleCrear = () => {
    if (montoNum <= 0) { toast.error('Ingresa un monto valido'); return }
    if (cuotasNum <= 0) { toast.error('Ingresa el numero de cuotas'); return }
    startTransition(async () => {
      const res = await crearPlanRecurrente({
        negocioId,
        negocioBloqueId,
        monto: montoNum,
        frecuencia,
        fechaInicio,
        totalCuotas: cuotasNum,
        pasarela,
        autoRenovar: configExtra.permite_auto_renovar ? autoRenovar : false,
        notas: notas.trim() || undefined,
      })
      if (res.success) {
        toast.success('Plan recurrente creado')
        router.refresh()
      } else {
        toast.error(res.error ?? 'Error creando plan')
      }
    })
  }

  const handleCancelar = () => {
    if (!planData?.plan_id) return
    if (!confirm('Cancelar el plan? Los cobros futuros dejaran de generarse. Los ya cobrados permanecen.')) return
    startTransition(async () => {
      const res = await cancelarPlan(planData.plan_id!)
      if (res.success) {
        toast.success('Plan cancelado')
        router.refresh()
      } else {
        toast.error(res.error ?? 'Error cancelando plan')
      }
    })
  }

  // ── Vista plan creado ─────────────────────────────────
  if (completado && planData) {
    const total = (planData.monto ?? 0) * (planData.total_cuotas ?? 0)
    return (
      <div className="space-y-3">
        <div className="rounded-lg border border-[#10B981]/30 bg-[#10B981]/5 p-3">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 text-[#10B981] shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-[#1A1A1A]">Plan recurrente activo</p>
              <p className="text-xs text-[#6B7280]">
                {formatCOP(planData.monto ?? 0)} {FREC_LABEL[planData.frecuencia ?? 'mensual'].toLowerCase()} ·{' '}
                {planData.total_cuotas} cuotas
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <p className="text-[#6B7280]">Inicio</p>
              <p className="font-medium text-[#1A1A1A]">{formatFechaCorta(planData.fecha_inicio)}</p>
            </div>
            <div>
              <p className="text-[#6B7280]">Fin</p>
              <p className="font-medium text-[#1A1A1A]">{formatFechaCorta(planData.fecha_fin)}</p>
            </div>
            <div>
              <p className="text-[#6B7280]">Pasarela</p>
              <p className="font-medium text-[#1A1A1A]">{PASARELA_LABEL[planData.pasarela ?? 'manual']}</p>
            </div>
            <div>
              <p className="text-[#6B7280]">Total contrato</p>
              <p className="font-medium text-[#1A1A1A]">{formatCOP(total)}</p>
            </div>
          </div>

          {planData.auto_renovar && (
            <div className="mt-2 flex items-center gap-1.5 text-[10px] text-[#6B7280]">
              <RefreshCw className="h-3 w-3" />
              Auto-renovacion activada al fin del contrato
            </div>
          )}
        </div>

        {modo === 'editable' && (
          <button
            onClick={handleCancelar}
            disabled={isPending}
            className="text-[11px] text-[#6B7280] hover:text-[#EF4444] underline disabled:opacity-50"
          >
            Cancelar plan
          </button>
        )}
      </div>
    )
  }

  // ── Vista read-only sin plan ──────────────────────────
  if (modo !== 'editable') {
    return (
      <div className="rounded-lg border border-dashed border-[#E5E7EB] p-3 text-center">
        <p className="text-xs text-[#6B7280]">Plan recurrente sin configurar</p>
      </div>
    )
  }

  // ── Form de captura ───────────────────────────────────
  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2 rounded-md border border-[#E5E7EB] bg-[#F5F4F2] p-2.5">
        <Calendar className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6B7280]" />
        <p className="text-[11px] leading-relaxed text-[#6B7280]">
          Define monto y duracion del contrato recurrente. El sistema generara cobros programados 3 dias antes de cada fecha y notificara si una cuota se vence sin pago.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">Monto por cuota *</label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[#6B7280]">$</span>
            <input
              type="number"
              value={monto}
              onChange={e => setMonto(e.target.value)}
              min="1"
              placeholder="500000"
              className="w-full rounded-md border border-[#E5E7EB] bg-white py-2 pl-7 pr-3 text-sm"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">Frecuencia *</label>
          <select
            value={frecuencia}
            onChange={e => setFrecuencia(e.target.value as Frecuencia)}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
          >
            <option value="mensual">Mensual</option>
            <option value="trimestral">Trimestral</option>
            <option value="anual">Anual</option>
          </select>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">Fecha primera cuota *</label>
          <input
            type="date"
            value={fechaInicio}
            onChange={e => setFechaInicio(e.target.value)}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
          />
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">Total cuotas *</label>
          <input
            type="number"
            value={totalCuotas}
            onChange={e => setTotalCuotas(e.target.value)}
            min="1"
            placeholder="12"
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
          />
        </div>

        <div className="col-span-2">
          <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">Pasarela *</label>
          <select
            value={pasarela}
            onChange={e => setPasarela(e.target.value as Pasarela)}
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
          >
            <option value="manual">Pago manual (transferencia, efectivo)</option>
            <option value="wompi">Wompi (recurrente automatico)</option>
            <option value="mixto">Mixto (Wompi con fallback manual)</option>
          </select>
        </div>

        {configExtra.permite_auto_renovar && (
          <div className="col-span-2">
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={autoRenovar}
                onChange={e => setAutoRenovar(e.target.checked)}
                className="rounded border-[#E5E7EB]"
              />
              <span className="text-xs text-[#1A1A1A]">Auto-renovar al fin del contrato</span>
            </label>
          </div>
        )}

        <div className="col-span-2">
          <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">Notas (opcional)</label>
          <input
            type="text"
            value={notas}
            onChange={e => setNotas(e.target.value)}
            placeholder="Ej: Suscripcion ONE plan basico"
            className="w-full rounded-md border border-[#E5E7EB] bg-white px-3 py-2 text-sm"
          />
        </div>
      </div>

      {/* Preview */}
      {montoNum > 0 && cuotasNum > 0 && fechaFinPreview && (
        <div className="rounded-md border border-[#E5E7EB] bg-[#F5F4F2] p-2.5">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7280]">Resumen del plan</p>
          <div className="mt-1.5 grid grid-cols-2 gap-2 text-[11px]">
            <div>
              <span className="text-[#6B7280]">Total contrato </span>
              <span className="font-semibold text-[#1A1A1A]">{formatCOP(precioTotal)}</span>
            </div>
            <div>
              <span className="text-[#6B7280]">Hasta </span>
              <span className="font-semibold text-[#1A1A1A]">{formatFechaCorta(fechaFinPreview)}</span>
            </div>
          </div>
          {pasarela === 'wompi' && (
            <p className="mt-2 flex items-center gap-1 text-[10px] text-[#F59E0B]">
              <AlertCircle className="h-3 w-3" />
              Wompi se conecta cuando MeTRIK active la cuenta empresarial.
            </p>
          )}
        </div>
      )}

      <button
        onClick={handleCrear}
        disabled={isPending || montoNum <= 0 || cuotasNum <= 0}
        className="w-full rounded-lg bg-[#10B981] py-2.5 text-sm font-medium text-white hover:bg-[#059669] disabled:opacity-50"
      >
        {isPending ? 'Creando plan...' : 'Crear plan recurrente'}
      </button>
    </div>
  )
}
