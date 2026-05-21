'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { AlertCircle, XCircle, Ban } from 'lucide-react'
import {
  validarCierrePerdido,
  cerrarNegocioPerdido,
  cerrarNegocioCancelado,
} from '@/lib/actions/cierre-adelantado'

const formatCOP = (v: number) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(v)

export type CierreMotivoUI = 'perdido' | 'cancelado'

interface ConfirmCierreModalProps {
  negocioId: string
  motivo: CierreMotivoUI
  /** Decision A1: post-cierre se queda inline. Solo refresca. */
  onClose: () => void
}

/**
 * Modal de confirmacion de cierre adelantado. Cubre 2 modos:
 *   - perdido: valida cero cobros (cliente + server). Si hay cobros, bloquea.
 *   - cancelado: solicita textarea razon + (si cobros) manejo de pagos + placeholder legal.
 *
 * Decision A3: disclaimer legal cancelacion con cobros es placeholder
 * hasta que Emilio entregue copy canonico.
 *
 * Decision A1: tras exito, NO redirect — solo router.refresh() y onClose.
 */
export default function ConfirmCierreModal({
  negocioId,
  motivo,
  onClose,
}: ConfirmCierreModalProps) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [razon, setRazon] = useState('')
  const [manejoPagos, setManejoPagos] = useState('')
  const [validacion, setValidacion] = useState<{
    loading: boolean
    cobrosCount: number
    cobrosTotal: number
    bloqueado: boolean
  }>({ loading: true, cobrosCount: 0, cobrosTotal: 0, bloqueado: false })

  // Cargar validacion al montar
  useEffect(() => {
    let cancelled = false
    void (async () => {
      const res = await validarCierrePerdido(negocioId)
      if (cancelled) return
      const bloqueado = motivo === 'perdido' && !res.ok
      setValidacion({
        loading: false,
        cobrosCount: res.cobrosCount,
        cobrosTotal: res.cobrosTotal,
        bloqueado,
      })
    })()
    return () => {
      cancelled = true
    }
  }, [negocioId, motivo])

  const tieneCobros = validacion.cobrosCount > 0
  const necesitaManejoPagos = motivo === 'cancelado' && tieneCobros
  const minRazon = 1
  const minManejo = 30

  const canSubmit =
    !validacion.loading &&
    !validacion.bloqueado &&
    razon.trim().length >= minRazon &&
    (!necesitaManejoPagos || manejoPagos.trim().length >= minManejo)

  function handleSubmit() {
    startTransition(async () => {
      const res =
        motivo === 'perdido'
          ? await cerrarNegocioPerdido(negocioId, { razon: razon.trim() })
          : await cerrarNegocioCancelado(negocioId, {
              razon: razon.trim(),
              manejoPagos: necesitaManejoPagos ? manejoPagos.trim() : undefined,
            })
      if (res.ok) {
        toast.success(
          motivo === 'perdido'
            ? 'Negocio cerrado como perdido'
            : 'Negocio cancelado. Notificamos al owner.',
        )
        onClose()
        router.refresh()
      } else {
        toast.error(res.error ?? 'Error al cerrar')
      }
    })
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        {/* Header */}
        <div className="mb-3 flex items-start gap-3">
          {motivo === 'perdido' ? (
            <XCircle className="h-5 w-5 shrink-0 text-[#6B7280]" />
          ) : (
            <Ban className="h-5 w-5 shrink-0 text-[#EF4444]" />
          )}
          <div>
            <h3 className="text-base font-semibold text-[#1A1A1A]">
              Cerrar negocio como {motivo === 'perdido' ? 'perdido' : 'cancelado'}
            </h3>
            <p className="text-xs text-[#6B7280]">
              {motivo === 'perdido'
                ? 'El cliente no convirtio. Solo aplica si no hay cobros registrados.'
                : 'Detener el negocio con recursos ya invertidos.'}
            </p>
          </div>
        </div>

        {validacion.loading ? (
          <div className="h-32 animate-pulse rounded-lg bg-[#F5F4F2]" />
        ) : validacion.bloqueado ? (
          <BloqueoPerdidoConCobros
            cobrosCount={validacion.cobrosCount}
            cobrosTotal={validacion.cobrosTotal}
            onCancel={onClose}
          />
        ) : (
          <div className="space-y-3">
            {/* Aviso para cancelado */}
            {motivo === 'cancelado' && (
              <div className="rounded-lg border border-[#F59E0B]/40 bg-[#F59E0B]/10 p-3">
                <p className="flex items-start gap-2 text-xs text-[#1A1A1A]">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#F59E0B]" />
                  <span>
                    Esta accion notificara al owner del workspace por email y
                    in-app cuando confirmes.
                  </span>
                </p>
              </div>
            )}

            {/* Razon */}
            <div>
              <label className="mb-1 block text-xs font-medium text-[#1A1A1A]">
                Razon del cierre
                <span className="ml-1 text-[#EF4444]">*</span>
              </label>
              <textarea
                value={razon}
                onChange={(e) => setRazon(e.target.value.slice(0, 500))}
                rows={3}
                placeholder={
                  motivo === 'perdido'
                    ? 'Por que no convirtio?'
                    : 'Por que cancelamos el negocio?'
                }
                className="w-full resize-none rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15"
              />
              <p className="mt-0.5 text-right text-[10px] text-[#6B7280]">
                {razon.length}/500
              </p>
            </div>

            {/* Manejo de pagos (cancelado con cobros) */}
            {necesitaManejoPagos && (
              <div>
                <label className="mb-1 block text-xs font-medium text-[#1A1A1A]">
                  Manejo de pagos realizados
                  <span className="ml-1 text-[#EF4444]">*</span>
                </label>
                <textarea
                  value={manejoPagos}
                  onChange={(e) =>
                    setManejoPagos(e.target.value.slice(0, 1000))
                  }
                  rows={3}
                  placeholder="Describe si se devuelve, se reconoce como anticipo a otro negocio, o queda como ingreso por trabajo ejecutado."
                  className="w-full resize-none rounded-md border border-[#E5E7EB] px-3 py-2 text-sm text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15"
                />
                <div className="mt-1 flex justify-between text-[10px]">
                  <span className="text-[#6B7280]">
                    Cobros registrados: {validacion.cobrosCount} · Total{' '}
                    {formatCOP(validacion.cobrosTotal)}
                  </span>
                  <span
                    className={
                      manejoPagos.trim().length < minManejo
                        ? 'text-[#EF4444]'
                        : 'text-[#6B7280]'
                    }
                  >
                    {manejoPagos.trim().length}/{minManejo} min
                  </span>
                </div>
                {/* Disclaimer legal placeholder (pendiente Emilio) */}
                <p className="mt-2 rounded border border-[#E5E7EB] bg-[#F5F4F2] p-2 text-[10px] italic text-[#6B7280]">
                  Confirmo que el manejo de cobros realizados queda registrado
                  en activity log conforme a Ley 1581.
                </p>
              </div>
            )}

            {/* Footer */}
            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isPending}
                className="flex-1 rounded-md border border-[#E5E7EB] py-2 text-sm font-medium text-[#1A1A1A] hover:bg-[#F5F4F2] disabled:opacity-50"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!canSubmit || isPending}
                className="flex-1 rounded-md bg-[#EF4444] py-2 text-sm font-medium text-white hover:bg-[#DC2626] disabled:opacity-50"
              >
                {isPending ? 'Cerrando...' : 'Confirmar cierre'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Estado bloqueante perdido con cobros ─────────────────────────────

function BloqueoPerdidoConCobros({
  cobrosCount,
  cobrosTotal,
  onCancel,
}: {
  cobrosCount: number
  cobrosTotal: number
  onCancel: () => void
}) {
  return (
    <div>
      <div className="rounded-lg border border-[#EF4444]/40 bg-[#EF4444]/5 p-3">
        <p className="text-sm font-semibold text-[#1A1A1A]">
          No se puede marcar como perdido
        </p>
        <p className="mt-1 text-xs text-[#6B7280]">
          Este negocio tiene {cobrosCount} cobro{cobrosCount !== 1 ? 's' : ''}{' '}
          registrado{cobrosCount !== 1 ? 's' : ''} ({formatCOP(cobrosTotal)}).
          Usa Cancelar en su lugar y define el manejo de los pagos.
        </p>
      </div>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="flex-1 rounded-md border border-[#E5E7EB] py-2 text-sm font-medium text-[#1A1A1A] hover:bg-[#F5F4F2]"
        >
          Cerrar
        </button>
      </div>
    </div>
  )
}
