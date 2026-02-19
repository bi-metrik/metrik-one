'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, X, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import { incrementNudge } from './config/fiscal-actions'

/**
 * D235: Advertencia fiscal explícita no descartable (pero limitada)
 * D236: Max 3 nudges para completar perfil fiscal
 *
 * This banner shows when:
 * - Fiscal profile is NOT complete
 * - nudge_count < 3
 *
 * Dismissing increments nudge_count. After 3 dismissals, banner stops showing.
 */

interface FiscalNudgeProps {
  isComplete: boolean
  isEstimated: boolean
  nudgeCount: number
}

export default function FiscalNudge({ isComplete, isEstimated, nudgeCount }: FiscalNudgeProps) {
  const [dismissed, setDismissed] = useState(false)
  const [isPending, startTransition] = useTransition()

  // Don't show if: complete, or already dismissed 3+ times, or dismissed this session
  if (isComplete || nudgeCount >= 3 || dismissed) return null

  const handleDismiss = () => {
    startTransition(async () => {
      await incrementNudge()
      setDismissed(true)
    })
  }

  return (
    <div className="relative flex items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-900 dark:bg-amber-950/30">
      <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-500" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
          {isEstimated
            ? 'Tu perfil fiscal está estimado'
            : 'Perfil fiscal sin configurar'
          }
        </p>
        <p className="text-xs text-amber-600 dark:text-amber-500 mt-0.5">
          {isEstimated
            ? 'Los cálculos usan valores por defecto. Completa tu perfil para números exactos.'
            : 'Las cotizaciones y retenciones usan valores conservadores por defecto.'
          }
        </p>
        <Link
          href="/config"
          className="mt-1.5 inline-flex items-center gap-1 text-xs font-medium text-amber-700 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300"
        >
          Completar perfil fiscal
          <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {/* D236: Allow dismiss but track count */}
      <button
        onClick={handleDismiss}
        disabled={isPending}
        className="flex-shrink-0 rounded p-1 text-amber-400 hover:text-amber-600 transition-colors"
        title={`Descartar (${3 - nudgeCount - 1} restantes)`}
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  )
}
