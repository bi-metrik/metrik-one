'use client'

import { useState, useTransition } from 'react'
import { Loader2, Check } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import StaffSection from '../config/staff-section'
import { updateEquipoDeclarado } from './actions'
import type { Staff } from '@/types/database'

interface Props {
  workspace: any
  staffMembers: Staff[]
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function EquipoSection({ workspace, staffMembers }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [equipoDeclarado, setEquipoDeclarado] = useState(workspace?.equipo_declarado || 1)

  const handleSaveEquipo = () => {
    startTransition(async () => {
      const res = await updateEquipoDeclarado(equipoDeclarado)
      if (res.success) {
        toast.success('Tamano del equipo actualizado')
        router.refresh()
      } else {
        toast.error(res.error || 'Error')
      }
    })
  }

  // "Ficha YO" — primary staff member
  const fichaYo = staffMembers.find(s => s.es_principal)
  const costoHora = fichaYo && (fichaYo.salary ?? 0) > 0 && (fichaYo.horas_disponibles_mes ?? 160) > 0
    ? Math.round((fichaYo.salary ?? 0) / (fichaYo.horas_disponibles_mes ?? 160))
    : null

  return (
    <div className="space-y-6">
      {/* Equipo declarado */}
      <div className="space-y-3">
        <div>
          <h3 className="font-semibold">Tamano del equipo</h3>
          <p className="text-xs text-muted-foreground mt-1">
            Cuantas personas trabajan contigo (incluyendote)?
          </p>
        </div>
        <div className="flex items-center gap-3">
          <input
            type="number"
            min={1}
            max={100}
            value={equipoDeclarado}
            onChange={e => setEquipoDeclarado(Math.max(1, parseInt(e.target.value) || 1))}
            className="w-20 rounded-md border bg-background px-3 py-2 text-sm text-center"
          />
          <span className="text-sm text-muted-foreground">persona{equipoDeclarado !== 1 ? 's' : ''}</span>
          <button
            onClick={handleSaveEquipo}
            disabled={isPending}
            className="flex items-center gap-1 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
            Guardar
          </button>
        </div>
      </div>

      {/* Ficha YO */}
      {fichaYo && (
        <div className="space-y-2 rounded-lg border bg-primary/5 p-4">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold">{fichaYo.full_name}</p>
              <p className="text-xs text-muted-foreground">{fichaYo.position || 'Principal'}</p>
            </div>
            <div className="text-right">
              <p className="text-sm font-semibold">{fmt(fichaYo.salary ?? 0)}<span className="text-xs font-normal text-muted-foreground">/mes</span></p>
              <p className="text-xs text-muted-foreground">{fichaYo.horas_disponibles_mes ?? 160}h/mes</p>
            </div>
          </div>
          {costoHora && (
            <div className="rounded-md border bg-background p-3 text-center">
              <p className="text-xs text-muted-foreground">Tu hora de trabajo cuesta</p>
              <p className="text-lg font-bold text-primary">{fmt(costoHora)}<span className="text-xs font-normal text-muted-foreground">/hora</span></p>
            </div>
          )}
        </div>
      )}

      {/* Staff Section */}
      <div className="border-t pt-4">
        <StaffSection initialData={staffMembers} />
      </div>
    </div>
  )
}
