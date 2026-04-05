'use client'

import { useState, useTransition } from 'react'
import { Users } from 'lucide-react'
import { toast } from 'sonner'
import { actualizarBloqueData, marcarBloqueCompleto } from '../../negocio-v2-actions'
import type { NegocioBloque } from '../../negocio-v2-actions'

interface Profile {
  id: string
  full_name: string | null
  email?: string
}

interface BloqueEquipoProps {
  negocioId: string
  negocioBloqueId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  profiles: Profile[]
}

function Avatar({ name }: { name: string | null }) {
  const initial = name ? name.charAt(0).toUpperCase() : '?'
  return (
    <span className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-[#10B981]/15 text-[11px] font-bold text-[#10B981] shrink-0">
      {initial}
    </span>
  )
}

const ROLES: Array<{ key: 'comercial_id' | 'ejecucion_id' | 'financiero_id'; label: string }> = [
  { key: 'comercial_id', label: 'Responsable comercial' },
  { key: 'ejecucion_id', label: 'Responsable ejecución' },
  { key: 'financiero_id', label: 'Responsable financiero' },
]

export default function BloqueEquipo({
  negocioBloqueId,
  instancia,
  modo,
  profiles,
}: BloqueEquipoProps) {
  const data = (instancia?.data ?? {}) as Record<string, string | null>
  const [values, setValues] = useState<Record<string, string>>({
    comercial_id: (data.comercial_id as string) ?? '',
    ejecucion_id: (data.ejecucion_id as string) ?? '',
    financiero_id: (data.financiero_id as string) ?? '',
  })
  const [isPending, startTransition] = useTransition()

  function getProfileName(id: string | null | undefined) {
    if (!id) return null
    return profiles.find(p => p.id === id)?.full_name ?? null
  }

  function handleChange(key: string, value: string) {
    const next = { ...values, [key]: value }
    setValues(next)
    startTransition(async () => {
      const dataToSave: Record<string, string | null> = {
        comercial_id: next.comercial_id || null,
        ejecucion_id: next.ejecucion_id || null,
        financiero_id: next.financiero_id || null,
      }
      // Completo si al menos 1 responsable asignado
      const hasAny = Object.values(dataToSave).some(v => v !== null)
      if (hasAny) {
        const result = await marcarBloqueCompleto(negocioBloqueId, dataToSave)
        if (result.error) toast.error(result.error)
      } else {
        const result = await actualizarBloqueData(negocioBloqueId, dataToSave)
        if (result.error) toast.error(result.error)
      }
    })
  }

  if (modo === 'visible') {
    const assigned = ROLES.filter(r => values[r.key])
    if (assigned.length === 0) {
      return (
        <p className="text-xs text-[#6B7280]">Sin responsables asignados</p>
      )
    }
    return (
      <div className="space-y-2">
        {assigned.map(role => (
          <div key={role.key} className="flex items-center gap-2">
            <Avatar name={getProfileName(values[role.key])} />
            <div>
              <p className="text-xs font-medium text-[#1A1A1A]">{getProfileName(values[role.key]) ?? '—'}</p>
              <p className="text-[10px] text-[#6B7280]">{role.label}</p>
            </div>
          </div>
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {ROLES.map(role => (
        <div key={role.key}>
          <label className="mb-1 block text-[11px] font-medium text-[#6B7280]">
            {role.label}
          </label>
          <div className="flex items-center gap-2">
            {values[role.key] && <Avatar name={getProfileName(values[role.key])} />}
            <select
              value={values[role.key]}
              onChange={e => handleChange(role.key, e.target.value)}
              disabled={isPending}
              className="flex-1 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 disabled:opacity-60"
            >
              <option value="">— Sin asignar —</option>
              {profiles.map(p => (
                <option key={p.id} value={p.id}>
                  {p.full_name ?? p.email ?? p.id.slice(-6)}
                </option>
              ))}
            </select>
          </div>
        </div>
      ))}
      <div className="flex items-center gap-1.5">
        <Users className="h-3 w-3 text-[#6B7280]" />
        <span className="text-[10px] text-[#6B7280]">
          {isPending ? 'Guardando...' : 'Los cambios de responsable quedan en el log de actividad'}
        </span>
      </div>
    </div>
  )
}
