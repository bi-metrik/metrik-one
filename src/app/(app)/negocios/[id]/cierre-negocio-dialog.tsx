'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import {
  perderNegocio,
  cancelarNegocio,
  completarNegocio,
} from '../negocio-v2-actions'
import { RAZONES_PERDIDA_NEGOCIO, RAZONES_DESCARTE_LEAD, MOTIVOS_CANCELACION } from '@/lib/negocios/constants'

// ── Helpers ─────────────────────────────────────────────────────────────────

const formatCOP = (v: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(v)

// ── Props ───────────────────────────────────────────────────────────────────

interface CierreNegocioDialogProps {
  negocioId: string
  stage: string // 'venta' | 'ejecucion' | 'cobro'
  isTerminalStage?: boolean
  esBuzonLeads?: boolean // descarte desde el buzón de entrada (Recepción)
  resumenFinanciero: { totalCobrado: number; porCobrar: number; costosEjecutados: number }
  precioAprobado: number | null
  /**
   * El usuario puede autorizar un cierre sin factura. Se resuelve en el servidor
   * con `puedeAutorizarCierreNoFacturable` (rol + areas): el cliente no conoce
   * las areas del staff, y ofrecer la casilla a quien la accion va a rechazar
   * obliga a llenar motivo y nota para chocar contra un error al final.
   * Esto es UX, no seguridad: el guard real vive en `completarNegocio`.
   */
  puedeCierreNoFacturable?: boolean
  onClose: () => void
}

// ── Stage: VENTA — Perder negocio ───────────────────────────────────────────

function PerderForm({ negocioId, esBuzonLeads, onClose }: { negocioId: string; esBuzonLeads?: boolean; onClose: () => void }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [razon, setRazon] = useState('')
  const [notas, setNotas] = useState('')
  // Desde el buzón (Recepción) se descarta un lead → razones de triage; en el
  // resto de la venta → razones de pérdida comercial.
  const razones = esBuzonLeads ? RAZONES_DESCARTE_LEAD : RAZONES_PERDIDA_NEGOCIO

  const handleConfirm = () => {
    if (!razon) return
    startTransition(async () => {
      const res = await perderNegocio(negocioId, razon, notas.trim() || undefined)
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success('Negocio marcado como perdido')
        onClose()
        router.refresh()
      }
    })
  }

  return (
    <>
      <h3 className="text-sm font-bold text-[#1A1A1A]">{esBuzonLeads ? 'Descartar lead' : 'Perder negocio'}</h3>
      <p className="text-xs text-[#6B7280]">
        {esBuzonLeads ? 'Motivo del descarte (obligatorio)' : 'Selecciona la razon principal'}
      </p>

      <div className="space-y-1.5 mt-3">
        {razones.map(r => (
          <button
            key={r.value}
            onClick={() => setRazon(r.value)}
            className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
              razon === r.value
                ? 'border-red-500 bg-red-50 text-red-700'
                : 'border-[#E5E7EB] hover:bg-accent'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <textarea
        value={notas}
        onChange={e => setNotas(e.target.value)}
        placeholder="Notas adicionales (opcional)"
        rows={2}
        className="mt-3 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm resize-none focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/15"
      />

      <div className="mt-4 flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 rounded-lg border border-[#E5E7EB] py-2 text-sm font-medium hover:bg-accent"
        >
          Cancelar
        </button>
        <button
          onClick={handleConfirm}
          disabled={!razon || isPending}
          className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {isPending ? 'Guardando...' : 'Confirmar'}
        </button>
      </div>
    </>
  )
}

// ── Stage: EJECUCION — Cancelar proyecto ────────────────────────────────────

function CancelarForm({ negocioId, onClose }: { negocioId: string; onClose: () => void }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [motivo, setMotivo] = useState('')
  const [descripcion, setDescripcion] = useState('')

  const handleConfirm = () => {
    if (!motivo || descripcion.trim().length < 20) return
    startTransition(async () => {
      const res = await cancelarNegocio(negocioId, motivo, descripcion.trim())
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success('Proyecto cancelado')
        onClose()
        router.refresh()
      }
    })
  }

  return (
    <>
      <h3 className="text-sm font-bold text-[#1A1A1A]">Cancelar proyecto</h3>
      <p className="text-xs text-[#6B7280]">
        Esta accion registra la cancelacion del proyecto en ejecucion
      </p>

      <div className="mt-3">
        <label className="block text-xs font-medium text-[#6B7280] mb-1">Motivo</label>
        <select
          value={motivo}
          onChange={e => setMotivo(e.target.value)}
          className="w-full rounded-md border border-[#E5E7EB] bg-background px-3 py-2 text-sm focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/15"
        >
          <option value="">Selecciona un motivo...</option>
          {MOTIVOS_CANCELACION.map(m => (
            <option key={m.value} value={m.value}>{m.label}</option>
          ))}
        </select>
      </div>

      <div className="mt-3">
        <label className="block text-xs font-medium text-[#6B7280] mb-1">
          Descripcion detallada
        </label>
        <textarea
          value={descripcion}
          onChange={e => setDescripcion(e.target.value)}
          placeholder="Describe la situacion y el motivo de la cancelacion..."
          rows={4}
          className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm resize-none focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-400/15"
        />
        <div className="mt-1 flex justify-end">
          <span className={`text-[10px] tabular-nums ${
            descripcion.trim().length < 20 ? 'text-red-500' : 'text-[#6B7280]'
          }`}>
            {descripcion.trim().length}/20 min
          </span>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={onClose}
          className="flex-1 rounded-lg border border-[#E5E7EB] py-2 text-sm font-medium hover:bg-accent"
        >
          Cancelar
        </button>
        <button
          onClick={handleConfirm}
          disabled={!motivo || descripcion.trim().length < 20 || isPending}
          className="flex-1 rounded-lg bg-red-600 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          {isPending ? 'Cancelando...' : 'Confirmar cancelacion'}
        </button>
      </div>
    </>
  )
}

// ── Stage: COBRO — Completar proyecto ───────────────────────────────────────

function CompletarForm({
  negocioId,
  resumenFinanciero,
  precioAprobado,
  permiteCierreNoFacturable,
  onClose,
}: {
  negocioId: string
  resumenFinanciero: { totalCobrado: number; porCobrar: number; costosEjecutados: number }
  precioAprobado: number | null
  permiteCierreNoFacturable: boolean
  onClose: () => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [step, setStep] = useState<1 | 2>(1)
  const [lecciones, setLecciones] = useState('')
  const [cerrarSinFactura, setCerrarSinFactura] = useState(false)
  const [motivoNoFacturable, setMotivoNoFacturable] = useState('')
  const [notaNoFacturable, setNotaNoFacturable] = useState('')

  const margen = resumenFinanciero.totalCobrado - resumenFinanciero.costosEjecutados
  const requiereNota = motivoNoFacturable === 'otro'
  const cierreNoFacturableValido = !cerrarSinFactura
    || (!!motivoNoFacturable && (!requiereNota || !!notaNoFacturable.trim()))

  const handleConfirm = () => {
    startTransition(async () => {
      const res = await completarNegocio(
        negocioId,
        lecciones.trim() || undefined,
        cerrarSinFactura
          ? {
              motivo: motivoNoFacturable as 'cortesia_compensacion' | 'incluido_otro_acuerdo' | 'otro',
              nota: notaNoFacturable.trim() || undefined,
            }
          : undefined,
      )
      if (res.error) {
        toast.error(res.error)
      } else {
        toast.success('Proyecto completado')
        onClose()
        router.refresh()
      }
    })
  }

  if (step === 1) {
    return (
      <>
        <h3 className="text-sm font-bold text-[#1A1A1A]">Cerrar proyecto</h3>
        <textarea
          value={lecciones}
          onChange={e => setLecciones(e.target.value)}
          placeholder="Que aprendiste de este proyecto? Que mejorarias?"
          rows={4}
          className="mt-3 w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm resize-none focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15"
        />
        {permiteCierreNoFacturable && (
          <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-left">
            <input
              type="checkbox"
              checked={cerrarSinFactura}
              onChange={e => setCerrarSinFactura(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-amber-400 accent-amber-600"
            />
            <span>
              <span className="block text-sm font-medium text-amber-900">Cerrar sin facturación</span>
              <span className="block text-xs text-amber-800">Solo para cortesías, compensaciones o acuerdos que ya incluyen este servicio.</span>
            </span>
          </label>
        )}
        {permiteCierreNoFacturable && cerrarSinFactura && (
          <div className="mt-3 space-y-2 rounded-lg border border-amber-200 p-3">
            <label className="block text-xs font-medium text-[#6B7280]">Motivo del cierre no facturable</label>
            <select
              value={motivoNoFacturable}
              onChange={e => setMotivoNoFacturable(e.target.value)}
              className="w-full rounded-md border border-[#E5E7EB] bg-background px-3 py-2 text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/15"
            >
              <option value="">Selecciona un motivo...</option>
              <option value="cortesia_compensacion">Cortesía o compensación</option>
              <option value="incluido_otro_acuerdo">Incluido en otro acuerdo</option>
              <option value="otro">Otro</option>
            </select>
            {requiereNota && (
              <textarea
                value={notaNoFacturable}
                onChange={e => setNotaNoFacturable(e.target.value)}
                placeholder="Describe el motivo del cierre no facturable..."
                rows={3}
                className="w-full rounded-md border border-[#E5E7EB] px-3 py-2 text-sm resize-none focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/15"
              />
            )}
          </div>
        )}
        <div className="mt-4 flex gap-2">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-[#E5E7EB] py-2 text-sm font-medium hover:bg-accent"
          >
            Cancelar
          </button>
          <button
            onClick={() => setStep(2)}
            disabled={!cierreNoFacturableValido}
            className="flex-1 rounded-lg bg-[#10B981] py-2 text-sm font-medium text-white hover:bg-[#059669] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Ver resumen
          </button>
        </div>
      </>
    )
  }

  // Step 2: Resumen financiero
  return (
    <>
      <h3 className="text-sm font-bold text-[#1A1A1A]">Resumen financiero</h3>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <FinCard label="Precio aprobado" value={formatCOP(precioAprobado ?? 0)} />
        <FinCard label="Total cobrado" value={formatCOP(resumenFinanciero.totalCobrado)} />
        <FinCard label="Costos ejecutados" value={formatCOP(resumenFinanciero.costosEjecutados)} />
        <FinCard
          label="Margen"
          value={`${margen >= 0 ? '+' : ''}${formatCOP(margen)}`}
          highlight={margen}
        />
      </div>

      {cerrarSinFactura && (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          Cierre sin facturación: {motivoNoFacturable === 'cortesia_compensacion'
            ? 'Cortesía o compensación'
            : motivoNoFacturable === 'incluido_otro_acuerdo'
              ? 'Incluido en otro acuerdo'
              : 'Otro'}
          {notaNoFacturable.trim() ? ` — ${notaNoFacturable.trim()}` : ''}
        </div>
      )}

      <div className="mt-4 flex gap-2">
        <button
          onClick={() => setStep(1)}
          className="flex-1 rounded-lg border border-[#E5E7EB] py-2 text-sm font-medium hover:bg-accent"
        >
          Atras
        </button>
        <button
          onClick={handleConfirm}
          disabled={isPending}
          className="flex-1 rounded-lg bg-[#10B981] py-2 text-sm font-medium text-white hover:bg-[#059669] disabled:opacity-50"
        >
          {isPending ? 'Cerrando...' : 'Confirmar cierre'}
        </button>
      </div>
    </>
  )
}

function FinCard({ label, value, highlight }: { label: string; value: string; highlight?: number }) {
  return (
    <div className="rounded-lg border border-[#E5E7EB] p-3">
      <p className="text-[10px] text-[#6B7280]">{label}</p>
      <p className={`text-sm font-bold mt-0.5 tabular-nums ${
        highlight !== undefined
          ? highlight >= 0 ? 'text-green-600' : 'text-red-600'
          : 'text-[#1A1A1A]'
      }`}>
        {value}
      </p>
    </div>
  )
}

// ── Dialog principal ────────────────────────────────────────────────────────

export default function CierreNegocioDialog({
  negocioId,
  stage,
  isTerminalStage,
  esBuzonLeads,
  resumenFinanciero,
  precioAprobado,
  puedeCierreNoFacturable = false,
  onClose,
}: CierreNegocioDialogProps) {
  const showCompletar = stage === 'cobro' || (stage === 'ejecucion' && isTerminalStage)
  const showCancelar = stage === 'ejecucion' && !isTerminalStage

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl bg-white shadow-xl p-6 space-y-1">
        {stage === 'venta' && (
          <PerderForm negocioId={negocioId} esBuzonLeads={esBuzonLeads} onClose={onClose} />
        )}
        {showCancelar && (
          <CancelarForm negocioId={negocioId} onClose={onClose} />
        )}
        {showCompletar && (
          <CompletarForm
            negocioId={negocioId}
            resumenFinanciero={resumenFinanciero}
            precioAprobado={precioAprobado}
            permiteCierreNoFacturable={stage === 'cobro' && puedeCierreNoFacturable}
            onClose={onClose}
          />
        )}
      </div>
    </div>
  )
}
