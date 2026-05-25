'use client'

import { useState, useTransition } from 'react'
import { CheckCircle2, Lock } from 'lucide-react'
import { toast } from 'sonner'
import { marcarBloqueCompleto } from '../../negocio-v2-actions'
import type { NegocioBloque } from '../../negocio-v2-actions'

interface BloqueCompletionStampProps {
  negocioBloqueId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  labelBoton?: string
  restrictToOperatorOrResponsable?: boolean
  userRole: string
  currentUserId: string | null
  responsableId: string | null
  profiles: Array<{ id: string; full_name: string | null }>
}

export default function BloqueCompletionStamp({
  negocioBloqueId,
  instancia,
  modo,
  labelBoton,
  restrictToOperatorOrResponsable,
  userRole,
  currentUserId,
  responsableId,
  profiles,
}: BloqueCompletionStampProps) {
  const [isPending, startTransition] = useTransition()
  const [optimisticDone, setOptimisticDone] = useState(false)

  const done = instancia?.estado === 'completo' || optimisticDone
  const completadoAt = instancia?.completado_at as string | undefined
  const completadoPor = instancia?.completado_por as string | undefined
  const completadoPorNombre = profiles.find(p => p.id === completadoPor)?.full_name ?? 'Sin asignar'

  const isOperator = userRole === 'operator'
  const isResponsable = !!currentUserId && currentUserId === responsableId
  const isGerencial = userRole === 'owner' || userRole === 'admin'
  const canMark = !restrictToOperatorOrResponsable || isOperator || isResponsable || isGerencial
  const reasonBlocked = restrictToOperatorOrResponsable && !canMark
    ? (responsableId
        ? 'Solo el ejecutor de operaciones o el responsable asignado puede marcar este cargue.'
        : 'Asigna un responsable al negocio para habilitar este botón.')
    : null

  function handleClick() {
    startTransition(async () => {
      const res = await marcarBloqueCompleto(negocioBloqueId, {})
      if (res.error) {
        toast.error(res.error)
        return
      }
      setOptimisticDone(true)
      toast.success('Información cargada')
    })
  }

  if (done) {
    const fechaFmt = completadoAt
      ? new Date(completadoAt).toLocaleString('es-CO', {
          day: 'numeric',
          month: 'short',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
      : null
    return (
      <div className="flex items-center gap-2 rounded-lg border border-[#BBF7D0] bg-[#F0FDF4] px-3 py-2">
        <CheckCircle2 className="h-4 w-4 text-[#10B981] shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="text-xs font-medium text-[#059669]">Cargado por {completadoPorNombre}</p>
          {fechaFmt && <p className="text-[10px] text-[#10B981]/80">{fechaFmt}</p>}
        </div>
      </div>
    )
  }

  if (modo === 'visible') {
    return (
      <p className="text-xs text-[#6B7280] italic">Pendiente de marcar.</p>
    )
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={isPending || !canMark}
        className="inline-flex items-center gap-2 rounded-lg bg-[#10B981] px-4 py-2 text-sm font-medium text-white hover:bg-[#059669] disabled:cursor-not-allowed disabled:opacity-50"
      >
        {!canMark && <Lock className="h-3.5 w-3.5" />}
        {isPending ? 'Registrando…' : (labelBoton ?? 'Marcar como completado')}
      </button>
      {reasonBlocked && (
        <p className="text-[11px] text-[#6B7280]">{reasonBlocked}</p>
      )}
    </div>
  )
}
