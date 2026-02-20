'use client'

import { useState } from 'react'
import { ChevronDown, ChevronUp, Check, Circle, ArrowRight } from 'lucide-react'
import Link from 'next/link'
import type { SemaforoData } from './actions-v2'

interface Props {
  data: SemaforoData
}

export default function Semaforo({ data }: Props) {
  const [expanded, setExpanded] = useState(data.capa1Estado !== 'green')

  const bgColor = data.estadoFinal === 'red'
    ? 'border-red-200 bg-red-50 dark:border-red-900 dark:bg-red-950/20'
    : data.estadoFinal === 'yellow'
      ? 'border-yellow-200 bg-yellow-50 dark:border-yellow-900 dark:bg-yellow-950/20'
      : 'border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-950/20'

  const textColor = data.estadoFinal === 'red'
    ? 'text-red-700 dark:text-red-400'
    : data.estadoFinal === 'yellow'
      ? 'text-yellow-700 dark:text-yellow-400'
      : 'text-green-700 dark:text-green-400'

  const circleEmoji = data.estadoFinal === 'red' ? '🔴' : data.estadoFinal === 'yellow' ? '🟡' : '🟢'

  return (
    <div className={`rounded-xl border p-3 ${bgColor}`}>
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-center justify-between gap-2"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm">{circleEmoji}</span>
          <span className={`text-sm font-medium ${textColor} truncate`}>{data.mensaje}</span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {data.capa2Razon && (
            <span className={`text-[10px] ${textColor} hidden sm:inline`}>{data.capa2Razon}</span>
          )}
          {expanded ? (
            <ChevronUp className={`h-4 w-4 ${textColor}`} />
          ) : (
            <ChevronDown className={`h-4 w-4 ${textColor}`} />
          )}
        </div>
      </button>

      {/* Expanded checklist */}
      {expanded && (
        <div className="mt-3 space-y-1.5 border-t border-current/10 pt-3">
          {data.capa1Pendientes.map((p, i) => (
            <div key={i} className="flex items-center gap-2 text-xs">
              {p.done ? (
                <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400 shrink-0" />
              ) : (
                <Circle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              )}
              <span className={p.done ? 'text-muted-foreground line-through' : textColor}>
                {p.label}
              </span>
              {p.action && !p.done && (
                <Link href={p.action} className="ml-auto flex items-center gap-0.5 text-[10px] font-medium text-primary hover:underline shrink-0">
                  Completar <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          ))}
          {data.capa2Razon && (
            <div className={`mt-2 text-xs font-medium ${textColor} border-t border-current/10 pt-2`}>
              {data.capa2Razon}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
