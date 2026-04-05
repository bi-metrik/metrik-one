'use client'

import { useState, useTransition } from 'react'
import { ShieldCheck, ShieldX, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { actualizarAprobacion } from '../../negocio-v2-actions'
import type { NegocioBloque } from '../../negocio-v2-actions'

interface Profile {
  id: string
  full_name: string | null
  email?: string
}

interface BloqueAprobacionProps {
  negocioId: string
  negocioBloqueId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  profiles: Profile[]
  currentUserId?: string
}

function fmtDate(iso: string | null) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export default function BloqueAprobacion({
  negocioBloqueId,
  instancia,
  modo,
  profiles,
  currentUserId,
}: BloqueAprobacionProps) {
  const data = (instancia?.data ?? {}) as {
    aprobador_id?: string
    estado?: 'pendiente' | 'aprobado' | 'rechazado'
    comentario?: string
    aprobado_at?: string
  }

  const [aprobadorId, setAprobadorId] = useState(data.aprobador_id ?? '')
  const [comentario, setComentario] = useState('')
  const [isPending, startTransition] = useTransition()

  const estado = data.estado ?? 'pendiente'
  const isAprobador = currentUserId && aprobadorId === currentUserId

  function getProfileName(id: string | null | undefined) {
    if (!id) return null
    return profiles.find(p => p.id === id)?.full_name ?? null
  }

  function handleSetAprobador(id: string) {
    setAprobadorId(id)
    startTransition(async () => {
      const result = await actualizarAprobacion(negocioBloqueId, { aprobador_id: id, estado: 'pendiente' })
      if (result.error) toast.error(result.error)
    })
  }

  function handleDecision(decision: 'aprobado' | 'rechazado') {
    startTransition(async () => {
      const result = await actualizarAprobacion(negocioBloqueId, {
        estado: decision,
        comentario,
        aprobado_at: new Date().toISOString(),
      })
      if (result.error) toast.error(result.error)
      else toast.success(decision === 'aprobado' ? 'Aprobado correctamente' : 'Rechazado')
    })
  }

  if (modo === 'visible' || estado !== 'pendiente') {
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          {estado === 'aprobado' ? (
            <ShieldCheck className="h-4 w-4 text-green-500" />
          ) : estado === 'rechazado' ? (
            <ShieldX className="h-4 w-4 text-red-500" />
          ) : (
            <Clock className="h-4 w-4 text-amber-500" />
          )}
          <span className={`text-xs font-semibold ${
            estado === 'aprobado' ? 'text-green-700' :
            estado === 'rechazado' ? 'text-red-700' : 'text-amber-700'
          }`}>
            {estado === 'aprobado' ? 'Aprobado' : estado === 'rechazado' ? 'Rechazado' : 'Pendiente de aprobación'}
          </span>
        </div>
        {data.aprobador_id && (
          <p className="text-[11px] text-[#6B7280]">
            {estado === 'pendiente' ? 'Pendiente de' : estado === 'aprobado' ? 'Aprobado por' : 'Rechazado por'}:{' '}
            <span className="font-medium text-[#1A1A1A]">{getProfileName(data.aprobador_id)}</span>
          </p>
        )}
        {data.aprobado_at && (
          <p className="text-[10px] text-[#6B7280]">{fmtDate(data.aprobado_at)}</p>
        )}
        {data.comentario && (
          <p className="rounded-lg bg-slate-50 border border-[#E5E7EB] p-2 text-xs text-[#1A1A1A]">
            &ldquo;{data.comentario}&rdquo;
          </p>
        )}

        {/* Botones de decisión si soy el aprobador y está pendiente */}
        {estado === 'pendiente' && isAprobador && modo === 'editable' && (
          <div className="space-y-2 pt-2">
            <textarea
              placeholder="Comentario (opcional)..."
              value={comentario}
              onChange={e => setComentario(e.target.value)}
              rows={2}
              className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15"
            />
            <div className="flex gap-2">
              <button
                onClick={() => handleDecision('aprobado')}
                disabled={isPending}
                className="flex-1 rounded-lg bg-green-600 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-40"
              >
                Aprobar
              </button>
              <button
                onClick={() => handleDecision('rechazado')}
                disabled={isPending}
                className="flex-1 rounded-lg bg-red-100 py-2 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-40"
              >
                Rechazar
              </button>
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">Aprobador</label>
        <select
          value={aprobadorId}
          onChange={e => handleSetAprobador(e.target.value)}
          disabled={isPending}
          className="w-full rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 disabled:opacity-60"
        >
          <option value="">— Seleccionar aprobador —</option>
          {profiles.map(p => (
            <option key={p.id} value={p.id}>
              {p.full_name ?? p.email ?? p.id.slice(-6)}
            </option>
          ))}
        </select>
      </div>

      {aprobadorId && (
        <div className="rounded-lg bg-amber-50 border border-amber-100 p-2.5">
          <div className="flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-amber-600" />
            <p className="text-xs text-amber-700">
              Esperando aprobación de{' '}
              <span className="font-semibold">{getProfileName(aprobadorId)}</span>
            </p>
          </div>
        </div>
      )}

      {isAprobador && (
        <div className="space-y-2 border-t border-[#E5E7EB] pt-3">
          <textarea
            placeholder="Comentario (opcional)..."
            value={comentario}
            onChange={e => setComentario(e.target.value)}
            rows={2}
            className="w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-xs focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15"
          />
          <div className="flex gap-2">
            <button
              onClick={() => handleDecision('aprobado')}
              disabled={isPending}
              className="flex-1 rounded-lg bg-green-600 py-2 text-xs font-semibold text-white hover:bg-green-700 disabled:opacity-40"
            >
              Aprobar
            </button>
            <button
              onClick={() => handleDecision('rechazado')}
              disabled={isPending}
              className="flex-1 rounded-lg bg-red-100 py-2 text-xs font-semibold text-red-700 hover:bg-red-200 disabled:opacity-40"
            >
              Rechazar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
