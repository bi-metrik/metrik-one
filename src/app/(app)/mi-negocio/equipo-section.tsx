'use client'

import { useState, useTransition } from 'react'
import { Loader2, Check, ChevronDown, ChevronUp } from 'lucide-react'
import { toast } from 'sonner'
import { useRouter } from 'next/navigation'
import StaffSection from '../config/staff-section'
import { updateEquipoDeclarado } from './actions'
import type { Staff, Workspace } from '@/types/database'
import type { Area } from '@/lib/permissions/can-edit'
import { AREAS_OPERATIVAS, AREA_LABELS } from '@/lib/permissions/areas'
import {
  setWorkspaceDefaultResponsable,
  type StaffConAreas,
  type DefaultResponsableMap,
} from '@/lib/actions/equipo-areas'

interface Props {
  workspace: Workspace | null
  staffMembers: Staff[]
  licenseUsed: number
  licenseMax: number
  currentUserRole: string
  /** Staff con sus areas + conteo de negocios (staff_areas, fuente unica). */
  equipoConAreas: StaffConAreas[]
  /** Responsables por defecto por area (cascada automatica). */
  equipoDefaults: DefaultResponsableMap
}

const fmt = (v: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v)

export default function EquipoSection({
  workspace,
  staffMembers,
  licenseUsed,
  licenseMax,
  currentUserRole,
  equipoConAreas,
  equipoDefaults,
}: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [equipoDeclarado, setEquipoDeclarado] = useState(workspace?.equipo_declarado || 1)
  const [showResponsables, setShowResponsables] = useState(false)
  const [defaults, setDefaults] = useState<DefaultResponsableMap>(equipoDefaults)

  // Derivar mapas staff.id -> areas / conteo para StaffSection
  const staffAreas: Record<string, Area[]> = {}
  const negociosCount: Record<string, number> = {}
  for (const e of equipoConAreas) {
    staffAreas[e.id] = e.areas
    negociosCount[e.id] = e.negocios_activos_count
  }

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

      {/* Staff Section — ahora incluye areas en el form y en las cards */}
      <div className="border-t pt-4">
        <StaffSection
          initialData={staffMembers}
          licenseUsed={licenseUsed}
          licenseMax={licenseMax}
          currentUserRole={currentUserRole}
          staffAreas={staffAreas}
          negociosCount={negociosCount}
        />
      </div>

      {/* Responsables por defecto por area (cascada automatica) — colapsable */}
      <div className="border-t pt-4">
        <button
          type="button"
          onClick={() => setShowResponsables(v => !v)}
          className="flex w-full items-center justify-between text-left"
        >
          <div>
            <h3 className="font-semibold">Responsables por defecto por area</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Quien recibe automaticamente los negocios de cada area al cambiar de etapa.
            </p>
          </div>
          {showResponsables
            ? <ChevronUp className="h-4 w-4 shrink-0 text-muted-foreground" />
            : <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />}
        </button>

        {showResponsables && (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {AREAS_OPERATIVAS.map((area) => (
              <DefaultPicker
                key={area}
                area={area}
                current={defaults[area as 'comercial' | 'operaciones' | 'financiera']}
                staffOptions={equipoConAreas.filter(
                  (s) => s.is_active && (s.areas.includes(area) || s.areas.includes('direccion')),
                )}
                onChange={(staffId) => {
                  setDefaults((prev) => ({
                    ...prev,
                    [area as 'comercial' | 'operaciones' | 'financiera']: staffId
                      ? {
                          staff_id: staffId,
                          full_name: equipoConAreas.find((s) => s.id === staffId)?.full_name ?? 'Sin nombre',
                        }
                      : null,
                  }))
                }}
                onSaved={() => router.refresh()}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ── DefaultPicker (responsable por defecto de un area) ──────────────────
function DefaultPicker({
  area,
  current,
  staffOptions,
  onChange,
  onSaved,
}: {
  area: Area
  current: { staff_id: string; full_name: string } | null
  staffOptions: StaffConAreas[]
  onChange: (staffId: string | null) => void
  onSaved: () => void
}) {
  const [isPending, startTransition] = useTransition()

  function handleSelect(value: string) {
    const staffId = value === '' ? null : value
    onChange(staffId)
    startTransition(async () => {
      const res = await setWorkspaceDefaultResponsable(area, staffId)
      if (res.ok) {
        toast.success('Responsable actualizado')
        onSaved()
      } else {
        toast.error(res.error ?? 'Error al guardar')
      }
    })
  }

  return (
    <div className="rounded-lg border p-3">
      <p className="mb-2 text-xs font-medium">{AREA_LABELS[area]}</p>
      <select
        value={current?.staff_id ?? ''}
        disabled={isPending}
        onChange={(e) => handleSelect(e.target.value)}
        className="w-full rounded-md border bg-background px-2 py-1.5 text-xs disabled:opacity-50"
      >
        <option value="">
          {staffOptions.length === 0 ? 'Sin staff con esta area' : 'Sin default — cascada automatica'}
        </option>
        {staffOptions.map((s) => (
          <option key={s.id} value={s.id}>{s.full_name}</option>
        ))}
      </select>
      {staffOptions.length === 0 && (
        <p className="mt-1 text-[10px] italic text-muted-foreground">
          Asigna esta area a algun miembro primero.
        </p>
      )}
    </div>
  )
}
