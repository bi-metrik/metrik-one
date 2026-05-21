'use client'

import { useState } from 'react'
import { AlertCircle, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import type { UseBloqueLockApi } from '@/hooks/use-bloque-lock'

interface BloqueLockBannerProps {
  lock: UseBloqueLockApi
  /** Si true, muestra boton "Forzar edicion" (solo owner/admin). */
  canForceUnlock: boolean
  className?: string
}

function formatRelative(iso: string | null): string {
  if (!iso) return ''
  // Aproximacion grosera: minutos transcurridos desde locked_at
  // (no tenemos locked_at directo, calculamos vs ahora)
  const ms = Date.now() - new Date(iso).getTime()
  if (ms < 0) {
    // expires_at en el futuro — el lock se tomo recien
    return 'hace un momento'
  }
  const min = Math.floor(ms / 60_000)
  if (min < 1) return 'hace un momento'
  if (min === 1) return 'hace 1 min'
  return `hace ${min} min`
}

/**
 * Banner Caso A: otro usuario tiene el lock.
 * Banner Caso C: lock expiro mientras editabamos.
 */
export function BloqueLockBanner({
  lock,
  canForceUnlock,
  className = '',
}: BloqueLockBannerProps) {
  const [showConfirm, setShowConfirm] = useState(false)
  const [forcing, setForcing] = useState(false)

  if (lock.status !== 'theirs' && lock.status !== 'expired') return null

  if (lock.status === 'theirs') {
    return (
      <>
        <div
          className={`flex items-start gap-2 rounded-lg border-l-[3px] border-l-[#F59E0B] bg-[#F59E0B]/10 px-3 py-2.5 text-xs ${className}`}
          role="status"
          aria-live="polite"
        >
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#F59E0B]" />
          <div className="flex-1">
            <p className="font-medium text-[#1A1A1A]">
              Editando: {lock.heldByName ?? 'Otro usuario'}
            </p>
            <p className="mt-0.5 text-[11px] text-[#6B7280]">
              Solo lectura. Te avisaremos cuando libere el bloque.
            </p>
          </div>
          {canForceUnlock && (
            <button
              type="button"
              onClick={() => setShowConfirm(true)}
              className="shrink-0 rounded border border-[#EF4444]/40 px-2 py-1 text-[11px] font-medium text-[#EF4444] hover:bg-[#EF4444]/10"
            >
              Forzar edicion
            </button>
          )}
        </div>

        {showConfirm && (
          <ForceUnlockDialog
            heldByName={lock.heldByName ?? 'Otro usuario'}
            isForcing={forcing}
            onCancel={() => setShowConfirm(false)}
            onConfirm={async () => {
              setForcing(true)
              const ok = await lock.forceUnlock()
              setForcing(false)
              if (ok) {
                toast.success('Edicion forzada — accion registrada en activity log')
                setShowConfirm(false)
              } else {
                toast.error('No se pudo forzar la edicion')
              }
            }}
          />
        )}
      </>
    )
  }

  // expired
  return (
    <div
      className={`flex items-start gap-2 rounded-lg border-l-[3px] border-l-[#6B7280] bg-[#F5F4F2] px-3 py-2.5 text-xs ${className}`}
      role="status"
      aria-live="polite"
    >
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-[#6B7280]" />
      <div className="flex-1">
        <p className="font-medium text-[#1A1A1A]">Tu sesion de edicion expiro</p>
        <p className="mt-0.5 text-[11px] text-[#6B7280]">
          Otra persona puede tomar el bloque ahora.
        </p>
      </div>
      <button
        type="button"
        onClick={() => lock.claim()}
        className="shrink-0 rounded border border-[#10B981]/40 px-2 py-1 text-[11px] font-medium text-[#10B981] hover:bg-[#10B981]/10"
      >
        Tomar edicion
      </button>
    </div>
  )
}

function ForceUnlockDialog({
  heldByName,
  isForcing,
  onCancel,
  onConfirm,
}: {
  heldByName: string
  isForcing: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <h3 className="text-base font-semibold text-[#1A1A1A]">
          Forzar edicion del bloque
        </h3>
        <p className="mt-2 text-sm text-[#6B7280]">
          {heldByName} esta editando este bloque. Si fuerzas la edicion:
        </p>
        <ul className="mt-2 space-y-1 text-xs text-[#6B7280]">
          <li>• Su sesion vera el bloque como solo lectura.</li>
          <li>• Los cambios sin guardar de {heldByName} se perderan.</li>
          <li>• La accion quedara registrada en el log del negocio.</li>
        </ul>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={isForcing}
            className="flex-1 rounded-md border border-[#E5E7EB] py-2 text-sm font-medium hover:bg-[#F5F4F2] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isForcing}
            className="flex-1 rounded-md bg-[#EF4444] py-2 text-sm font-medium text-white hover:bg-[#DC2626] disabled:opacity-50"
          >
            {isForcing ? (
              <span className="inline-flex items-center justify-center gap-1.5">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Forzando...
              </span>
            ) : (
              'Forzar edicion'
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// formatRelative declarado pero no usado en este iteration (UI sin tiempo absoluto)
void formatRelative
