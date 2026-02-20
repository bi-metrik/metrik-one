'use client'

import { Flame, AlertTriangle } from 'lucide-react'
import { formatCOP } from '@/lib/contacts/constants'
import type { ConciliacionData } from './actions-v2'

interface Props {
  data: ConciliacionData
}

export default function FranjaConciliacion({ data }: Props) {
  if (data.saldoReal === null) {
    return (
      <div className="rounded-lg border border-dashed border-muted-foreground/30 px-4 py-2 text-center text-xs text-muted-foreground">
        Actualiza tu saldo bancario para activar la conciliacion
      </div>
    )
  }

  const streakText = data.streakSemanas > 0
    ? `${data.streakSemanas} sem${data.streakMilestone ? ` ${data.streakMilestone}` : ''}`
    : null

  // Estado 1: Conciliado y reciente
  if (data.estado === 1) {
    return (
      <div className="flex items-center gap-3 rounded-lg border bg-card px-4 py-2">
        <span className="text-sm">💰</span>
        <div className="flex flex-1 items-center gap-2 min-w-0 text-xs">
          <span className="font-medium">Caja: {formatCOP(data.saldoReal)}</span>
          <span className="text-green-600 dark:text-green-400">✅ Conciliado{data.diasDesdeUltimo === 0 ? ' hoy' : ` hace ${data.diasDesdeUltimo}d`}</span>
        </div>
        {streakText && (
          <div className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400 shrink-0">
            <Flame className="h-3.5 w-3.5" />
            <span>{streakText}</span>
          </div>
        )}
      </div>
    )
  }

  // Estado 2: Conciliado pero envejeciendo
  if (data.estado === 2) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-yellow-200 bg-yellow-50/50 dark:border-yellow-900 dark:bg-yellow-950/10 px-4 py-2">
        <span className="text-sm">💰</span>
        <div className="flex flex-1 items-center gap-2 min-w-0 text-xs">
          <span className="font-medium">Caja: {formatCOP(data.saldoReal)}</span>
          <span className="text-yellow-600 dark:text-yellow-400">
            <span className="inline-flex items-center gap-0.5"><AlertTriangle className="h-3 w-3" /> Hace {data.diasDesdeUltimo}d</span>
          </span>
        </div>
        {streakText && (
          <div className="flex items-center gap-1 text-xs text-orange-600 dark:text-orange-400 shrink-0">
            <Flame className="h-3.5 w-3.5" />
            <span>{streakText} — no pierdas tu racha!</span>
          </div>
        )}
      </div>
    )
  }

  // Estado 3: Diferencia detectada
  if (data.estado === 3) {
    return (
      <div className="rounded-lg border border-yellow-200 bg-yellow-50/50 dark:border-yellow-900 dark:bg-yellow-950/10 px-4 py-2 space-y-1">
        <div className="flex items-center gap-3 text-xs">
          <span className="text-sm">💰</span>
          <span className="font-medium">Banco: {formatCOP(data.saldoReal)}</span>
          <span className="text-muted-foreground">vs</span>
          <span className="font-medium">Calculado: {formatCOP(data.saldoTeorico)}</span>
        </div>
        <div className="flex items-center gap-3 text-xs">
          <span className="text-sm opacity-0">💰</span>
          <span className="text-yellow-600 dark:text-yellow-400">
            <span className="inline-flex items-center gap-0.5"><AlertTriangle className="h-3 w-3" /> Diferencia: {data.diferencia >= 0 ? '+' : ''}{formatCOP(data.diferencia)}</span>
          </span>
          {streakText && (
            <span className="ml-auto flex items-center gap-1 text-orange-600 dark:text-orange-400 shrink-0">
              <Flame className="h-3.5 w-3.5" />
              {streakText}
            </span>
          )}
        </div>
      </div>
    )
  }

  // Estado 4: Streak roto
  return (
    <div className="rounded-lg border border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/10 px-4 py-2 space-y-1">
      <div className="flex items-center gap-3 text-xs">
        <span className="text-sm">💰</span>
        <span className="font-medium">Caja: {formatCOP(data.saldoReal)}</span>
        <span className="text-red-600 dark:text-red-400">
          <span className="inline-flex items-center gap-0.5"><AlertTriangle className="h-3 w-3" /> Hace {data.diasDesdeUltimo}d</span>
        </span>
      </div>
      <div className="flex items-center gap-3 text-xs">
        <span className="text-sm opacity-0">💰</span>
        <span className="text-muted-foreground">
          😔 {data.streakRecord > 0 ? `Perdiste tu racha de ${data.streakRecord} semanas — ` : ''}actualiza para empezar{data.streakRecord > 0 ? ' otra' : ' tu racha'}
        </span>
      </div>
    </div>
  )
}
