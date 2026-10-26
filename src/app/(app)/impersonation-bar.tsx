'use client'

import { useState, useTransition } from 'react'
import { Eye, X, ChevronDown } from 'lucide-react'
import { setImpersonation, type OpcionesImpersonacion } from '@/lib/actions/impersonation'

const ROLE_LABEL: Record<string, string> = {
  owner: 'Dueño',
  admin: 'Administrador',
  supervisor: 'Supervisor',
  operator: 'Ejecutor',
  contador: 'Contador',
  read_only: 'Lectura',
}

/**
 * Barra "Ver como" — solo visible para platform_admin. Permite hacer QA desde
 * la posición de cualquier usuario del workspace (rol + área).
 *
 * Las opciones llegan resueltas del layout, y solo para un platform_admin
 * (`getImpersonationOptions`). Antes la barra se las pedía al montar con una server
 * action, en cada carga completa y para TODO usuario: 696 llamadas en 7 días (medido
 * 2026-10-05) que casi siempre respondían «no eres admin», en fila delante de la
 * primera acción real de la persona.
 */
export default function ImpersonationBar({ opciones = null }: { opciones?: OpcionesImpersonacion | null }) {
  const [open, setOpen] = useState(false)
  const [isPending, start] = useTransition()
  const users = opciones?.ok ? opciones.users : []
  const current = opciones?.current ?? null

  if (users.length === 0) return null // no platform_admin

  const activo = users.find((u) => u.id === current)

  function apply(id: string | null) {
    setOpen(false)
    start(async () => {
      await setImpersonation(id)
      window.location.reload()
    })
  }

  // Impersonando → banner ámbar prominente
  if (activo) {
    return (
      <div className="flex items-center justify-between gap-3 bg-amber-100 border-b border-amber-300 px-4 py-2 text-sm text-amber-900">
        <div className="flex items-center gap-2 min-w-0">
          <Eye className="h-4 w-4 shrink-0" />
          <span className="truncate">
            Viendo como <strong>{activo.full_name ?? 'usuario'}</strong>
            {' · '}{ROLE_LABEL[activo.role] ?? activo.role}
          </span>
        </div>
        <button
          type="button"
          onClick={() => apply(null)}
          disabled={isPending}
          className="inline-flex items-center gap-1 rounded-md bg-amber-200 hover:bg-amber-300 px-2.5 py-1 text-xs font-medium disabled:opacity-50"
        >
          <X className="h-3.5 w-3.5" /> Salir de QA
        </button>
      </div>
    )
  }

  // No impersonando → control discreto "Ver como"
  return (
    <div className="relative flex justify-end px-4 py-1.5 border-b border-[#E5E7EB] bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={isPending}
        className="inline-flex items-center gap-1.5 rounded-md border border-[#E5E7EB] px-2.5 py-1 text-xs font-medium text-tinta-suave hover:bg-[#F9FAFB] disabled:opacity-50"
      >
        <Eye className="h-3.5 w-3.5" /> Ver como… <ChevronDown className="h-3 w-3" />
      </button>
      {open && (
        <div className="absolute right-4 top-9 z-50 w-56 max-h-72 overflow-y-auto rounded-lg border border-[#E5E7EB] bg-white py-1 shadow-lg">
          {users.map((u) => (
            <button
              key={u.id}
              type="button"
              onClick={() => apply(u.id)}
              className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs hover:bg-[#F9FAFB]"
            >
              <span className="truncate text-tinta">{u.full_name ?? 'Usuario'}</span>
              <span className="shrink-0 text-[10px] text-tinta-suave">{ROLE_LABEL[u.role] ?? u.role}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
