'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Pencil, Users, ArrowRightLeft } from 'lucide-react'
import type { Area } from '@/lib/permissions/can-edit'
import { AREAS_OPERATIVAS, AREA_LABELS, roleRequiresAreas } from '@/lib/permissions/areas'
import { AreaBadge } from '@/components/areas/area-badge'
import { AreaMultiSelect } from '@/components/areas/area-multi-select'
import EmptyState from '@/components/empty-state'
import {
  updateStaffAreas,
  setWorkspaceDefaultResponsable,
  type StaffConAreas,
  type DefaultResponsableMap,
} from '@/lib/actions/equipo-areas'

interface Props {
  initialStaff: StaffConAreas[]
  initialDefaults: DefaultResponsableMap
  currentUserRole: string
}

export default function EquipoAreasClient({
  initialStaff,
  initialDefaults,
  currentUserRole,
}: Props) {
  const router = useRouter()
  const [staff, setStaff] = useState<StaffConAreas[]>(initialStaff)
  const [defaults, setDefaults] = useState<DefaultResponsableMap>(initialDefaults)
  const [editingId, setEditingId] = useState<string | null>(null)

  const canEditDefaults =
    currentUserRole === 'owner' ||
    currentUserRole === 'admin' ||
    currentUserRole === 'supervisor'

  return (
    <div className="space-y-6">
      {/* Responsables por defecto por area */}
      <section className="rounded-xl border border-[#E5E7EB] bg-white p-4">
        <h2 className="text-sm font-semibold text-[#1A1A1A]">
          Responsables por defecto (cascada automatica)
        </h2>
        <p className="mt-1 text-xs text-[#6B7280]">
          Cuando un negocio entra a una etapa, se asigna automaticamente al
          responsable por defecto de esa area si no hay otro responsable.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {AREAS_OPERATIVAS.map((area) => (
            <DefaultPicker
              key={area}
              area={area}
              current={defaults[area as 'comercial' | 'operaciones' | 'financiera']}
              staffOptions={staff.filter(
                (s) =>
                  s.is_active &&
                  (s.areas.includes(area) || s.areas.includes('direccion')),
              )}
              disabled={!canEditDefaults}
              onChange={(staffId) => {
                // optimistic
                setDefaults((prev) => ({
                  ...prev,
                  [area as 'comercial' | 'operaciones' | 'financiera']: staffId
                    ? {
                        staff_id: staffId,
                        full_name:
                          staff.find((s) => s.id === staffId)?.full_name ??
                          'Sin nombre',
                      }
                    : null,
                }))
              }}
              onSaved={() => router.refresh()}
            />
          ))}
        </div>
      </section>

      {/* Staff */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-[#1A1A1A]">
            Staff ({staff.length} persona{staff.length !== 1 ? 's' : ''})
          </h2>
        </div>

        {staff.length === 0 ? (
          <EmptyState
            title="Aun no tienes equipo"
            description="Invita a tu primer miembro desde la configuracion del workspace."
            primaryCta={{
              label: 'Ir a invitar miembro',
              onClick: () => router.push('/config'),
            }}
          />
        ) : (
          <div className="space-y-3">
            {staff.map((s) => (
              <StaffCard
                key={s.id}
                staff={s}
                isEditing={editingId === s.id}
                onStartEdit={() => setEditingId(s.id)}
                onCancelEdit={() => setEditingId(null)}
                onSaved={(updatedAreas) => {
                  setStaff((prev) =>
                    prev.map((p) =>
                      p.id === s.id ? { ...p, areas: updatedAreas } : p,
                    ),
                  )
                  setEditingId(null)
                  router.refresh()
                }}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// ── DefaultPicker (por area operativa) ───────────────────────────────

function DefaultPicker({
  area,
  current,
  staffOptions,
  disabled,
  onChange,
  onSaved,
}: {
  area: Area
  current: { staff_id: string; full_name: string } | null
  staffOptions: StaffConAreas[]
  disabled?: boolean
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
        toast.success('Default actualizado')
        onSaved()
      } else {
        toast.error(res.error ?? 'Error al guardar')
      }
    })
  }

  return (
    <div className="rounded-lg border border-[#E5E7EB] p-3">
      <p className="mb-2 text-xs font-medium text-[#1A1A1A]">
        {AREA_LABELS[area]}
      </p>
      <select
        value={current?.staff_id ?? ''}
        disabled={disabled || isPending}
        onChange={(e) => handleSelect(e.target.value)}
        className="w-full rounded-md border border-[#E5E7EB] bg-white px-2 py-1.5 text-xs text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 disabled:bg-[#F5F4F2] disabled:text-[#6B7280]"
      >
        <option value="">
          {staffOptions.length === 0
            ? 'Sin staff con esta area'
            : 'Sin default — cascada automatica'}
        </option>
        {staffOptions.map((s) => (
          <option key={s.id} value={s.id}>
            {s.full_name}
          </option>
        ))}
      </select>
      {staffOptions.length === 0 && !disabled && (
        <p className="mt-1 text-[10px] italic text-[#6B7280]">
          Asigna esta area a algun miembro primero.
        </p>
      )}
    </div>
  )
}

// ── StaffCard ─────────────────────────────────────────────────────────

function StaffCard({
  staff,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSaved,
}: {
  staff: StaffConAreas
  isEditing: boolean
  onStartEdit: () => void
  onCancelEdit: () => void
  onSaved: (areas: Area[]) => void
}) {
  const [pendingAreas, setPendingAreas] = useState<Area[]>(staff.areas)
  const [isPending, startTransition] = useTransition()

  const role = staff.role
  const requireAreas = role ? roleRequiresAreas(role) : false
  const isOutOfModel = role === 'contador' || role === 'read_only'

  function handleSave() {
    if (requireAreas && pendingAreas.length === 0) {
      toast.error('Este rol requiere al menos un area')
      return
    }
    startTransition(async () => {
      const res = await updateStaffAreas(staff.id, pendingAreas)
      if (res.ok) {
        toast.success('Areas actualizadas')
        onSaved(pendingAreas)
      } else {
        toast.error(res.error ?? 'Error al guardar')
      }
    })
  }

  return (
    <div className="rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-[#1A1A1A]">
            {staff.full_name}
          </p>
          <p className="text-xs text-[#6B7280]">
            {staff.display_role ?? roleLabel(staff.role)}
            {!staff.is_active && ' · inactivo'}
          </p>
        </div>
        {!isEditing && !isOutOfModel && (
          <button
            type="button"
            onClick={onStartEdit}
            className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-xs font-medium text-[#10B981] hover:bg-[#10B981]/10"
          >
            <Pencil className="h-3.5 w-3.5" />
            Editar areas
          </button>
        )}
      </div>

      <div className="mt-2">
        {isEditing ? (
          <AreaMultiSelect
            value={pendingAreas}
            onChange={setPendingAreas}
            emptyHint="Selecciona al menos un area"
          />
        ) : isOutOfModel ? (
          <p className="text-xs italic text-[#6B7280]">
            Este rol no usa areas operativas.
          </p>
        ) : staff.areas.length === 0 ? (
          <p className="text-xs italic text-[#6B7280]">
            Sin areas asignadas
          </p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {staff.areas.map((a) => (
              <AreaBadge key={a} area={a} size="sm" />
            ))}
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center gap-3">
        <span className="inline-flex items-center gap-1 text-[11px] text-[#6B7280]">
          <Users className="h-3 w-3" />
          {staff.negocios_activos_count} negocio
          {staff.negocios_activos_count !== 1 ? 's' : ''} activo
          {staff.negocios_activos_count !== 1 ? 's' : ''}
        </span>
        {!isEditing && staff.negocios_activos_count > 0 && (
          <button
            type="button"
            disabled
            className="inline-flex items-center gap-1 text-[11px] text-[#6B7280]/50 cursor-not-allowed"
            title="Proximamente"
          >
            <ArrowRightLeft className="h-3 w-3" />
            Transferir
          </button>
        )}
      </div>

      {isEditing && (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            onClick={onCancelEdit}
            disabled={isPending}
            className="flex-1 rounded-md border border-[#E5E7EB] py-1.5 text-xs font-medium hover:bg-[#F5F4F2] disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={isPending || (requireAreas && pendingAreas.length === 0)}
            className="flex-1 rounded-md bg-[#10B981] py-1.5 text-xs font-medium text-white hover:bg-[#059669] disabled:opacity-50"
          >
            {isPending ? 'Guardando...' : 'Guardar'}
          </button>
        </div>
      )}
    </div>
  )
}

function roleLabel(role: string | null): string {
  if (!role) return 'Sin rol'
  const map: Record<string, string> = {
    owner: 'Dueno',
    admin: 'Admin',
    supervisor: 'Supervisor',
    operator: 'Operador',
    contador: 'Contador',
    read_only: 'Solo lectura',
  }
  return map[role] ?? role
}
