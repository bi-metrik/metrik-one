'use client'

import { Loader2 } from 'lucide-react'
import type { UseBloqueLockApi } from '@/hooks/use-bloque-lock'

interface BloqueLockOwnIndicatorProps {
  lock: UseBloqueLockApi
  className?: string
}

/**
 * Caso B: yo tengo el lock. Indicador discreto en esquina del bloque.
 * - status='mine' + remainingSec > 60: chip verde con countdown
 * - status='mine' + remainingSec <= 60: chip amarillo "Renovando..."
 * - status='heartbeat_failed': chip rojo "Conexion perdida"
 */
export function BloqueLockOwnIndicator({
  lock,
  className = '',
}: BloqueLockOwnIndicatorProps) {
  if (lock.status === 'mine') {
    const sec = lock.remainingSec ?? 300
    const isWarning = sec <= 60
    const mm = Math.floor(sec / 60)
    const ss = sec % 60
    const time = `${mm}:${ss.toString().padStart(2, '0')}`
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium ${
          isWarning
            ? 'bg-[#F59E0B]/10 text-[#F59E0B]'
            : 'bg-[#10B981]/10 text-[#059669]'
        } ${className}`}
      >
        {isWarning ? (
          <>
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            Renovando...
          </>
        ) : (
          <>
            <span
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-[#10B981]"
              aria-hidden
            />
            Editando · {time}
          </>
        )}
      </span>
    )
  }

  if (lock.status === 'heartbeat_failed') {
    return (
      <span
        className={`inline-flex items-center gap-1 rounded-full bg-[#EF4444]/10 px-2 py-0.5 text-[10px] font-medium text-[#EF4444] ${className}`}
      >
        Conexion perdida.{' '}
        <button
          type="button"
          onClick={() => lock.claim()}
          className="underline"
        >
          Reintentar
        </button>
      </span>
    )
  }

  return null
}
