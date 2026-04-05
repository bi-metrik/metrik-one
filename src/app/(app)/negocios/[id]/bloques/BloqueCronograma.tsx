'use client'

import { useState, useTransition } from 'react'
import { CalendarDays, Plus, CheckCircle2, Circle } from 'lucide-react'
import { toast } from 'sonner'
import { marcarBloqueItem, marcarBloqueCompleto } from '../../negocio-v2-actions'
import type { NegocioBloque } from '../../negocio-v2-actions'

interface CronogramaItem {
  id: string
  label: string
  fecha_inicio?: string | null
  fecha_fin?: string | null
  responsable_id?: string | null
  link_url?: string | null
  completado: boolean
  completado_at?: string | null
}

interface BloqueCronogramaProps {
  negocioId: string
  negocioBloqueId: string
  instancia: NegocioBloque | null
  modo: 'editable' | 'visible'
  initialItems?: CronogramaItem[]
  requireAllDates?: boolean
  profiles?: { id: string; full_name: string | null }[]
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function BloqueCronograma({
  negocioBloqueId,
  instancia,
  modo,
  initialItems = [],
  requireAllDates = false,
  profiles = [],
}: BloqueCronogramaProps) {
  const [items, setItems] = useState<CronogramaItem[]>(initialItems)
  const [isPending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Partial<CronogramaItem>>({})

  function isComplete() {
    if (items.length === 0) return false
    if (requireAllDates) {
      return items.every(i => i.fecha_inicio && i.fecha_fin)
    }
    return true
  }

  function handleToggle(item: CronogramaItem) {
    if (item.id.startsWith('_tmp_')) return
    startTransition(async () => {
      const result = await marcarBloqueItem(item.id, !item.completado)
      if (result.error) {
        toast.error(result.error)
      } else {
        const nextItems = items.map(i =>
          i.id === item.id ? { ...i, completado: !item.completado, completado_at: !item.completado ? new Date().toISOString() : null } : i
        )
        setItems(nextItems)
        if (isComplete() && negocioBloqueId) {
          await marcarBloqueCompleto(negocioBloqueId, { configurado: true })
        }
      }
    })
  }

  function startEdit(item: CronogramaItem) {
    setEditingId(item.id)
    setEditValues({ ...item })
  }

  function cancelEdit() {
    setEditingId(null)
    setEditValues({})
  }

  function saveEdit() {
    setItems(prev => prev.map(i => i.id === editingId ? { ...i, ...editValues } : i))
    setEditingId(null)
    // En una implementación completa: persistir via server action
    toast.success('Actividad actualizada')
  }

  if (items.length === 0) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-[#6B7280]">Sin actividades configuradas en el cronograma</p>
        {modo === 'editable' && (
          <button
            onClick={() => {
              const tmp: CronogramaItem = {
                id: `_tmp_${Date.now()}`,
                label: 'Nueva actividad',
                completado: false,
              }
              setItems([tmp])
              startEdit(tmp)
            }}
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-[#10B981] px-3 py-2 text-xs text-[#10B981] hover:bg-[#10B981]/5"
          >
            <Plus className="h-3.5 w-3.5" />
            Agregar actividad
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-2">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[#E5E7EB]">
              <th className="pb-1.5 pr-2 text-left text-[10px] font-medium text-[#6B7280] uppercase">Actividad</th>
              <th className="pb-1.5 pr-2 text-left text-[10px] font-medium text-[#6B7280] uppercase">Inicio</th>
              <th className="pb-1.5 pr-2 text-left text-[10px] font-medium text-[#6B7280] uppercase">Fin</th>
              <th className="pb-1.5 text-left text-[10px] font-medium text-[#6B7280] uppercase">Estado</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[#E5E7EB]">
            {items.map(item => (
              <tr key={item.id}>
                <td className="py-2 pr-2">
                  {editingId === item.id ? (
                    <input
                      type="text"
                      value={editValues.label ?? ''}
                      onChange={e => setEditValues(p => ({ ...p, label: e.target.value }))}
                      className="w-full rounded border border-[#E5E7EB] px-1.5 py-1 text-xs focus:border-[#10B981] focus:outline-none"
                    />
                  ) : (
                    <span
                      className={`${item.completado ? 'line-through text-[#6B7280]' : 'text-[#1A1A1A]'} cursor-pointer hover:text-[#10B981]`}
                      onClick={() => modo === 'editable' && startEdit(item)}
                    >
                      {item.label}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-2">
                  {editingId === item.id ? (
                    <input
                      type="date"
                      value={editValues.fecha_inicio ?? ''}
                      onChange={e => setEditValues(p => ({ ...p, fecha_inicio: e.target.value }))}
                      className="rounded border border-[#E5E7EB] px-1.5 py-1 text-xs focus:border-[#10B981] focus:outline-none"
                    />
                  ) : (
                    <span className="text-[#6B7280]">{fmtDate(item.fecha_inicio)}</span>
                  )}
                </td>
                <td className="py-2 pr-2">
                  {editingId === item.id ? (
                    <input
                      type="date"
                      value={editValues.fecha_fin ?? ''}
                      onChange={e => setEditValues(p => ({ ...p, fecha_fin: e.target.value }))}
                      className="rounded border border-[#E5E7EB] px-1.5 py-1 text-xs focus:border-[#10B981] focus:outline-none"
                    />
                  ) : (
                    <span className="text-[#6B7280]">{fmtDate(item.fecha_fin)}</span>
                  )}
                </td>
                <td className="py-2">
                  {editingId === item.id ? (
                    <div className="flex gap-1">
                      <button onClick={saveEdit} className="rounded bg-[#10B981] px-2 py-0.5 text-[10px] text-white">OK</button>
                      <button onClick={cancelEdit} className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-[#6B7280]">✕</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => modo === 'editable' && handleToggle(item)}
                      disabled={isPending || modo === 'visible'}
                      className="disabled:cursor-default"
                    >
                      {item.completado ? (
                        <CheckCircle2 className="h-4 w-4 text-[#10B981]" />
                      ) : (
                        <Circle className="h-4 w-4 text-[#6B7280]/30" />
                      )}
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modo === 'editable' && (
        <button
          onClick={() => {
            const tmp: CronogramaItem = {
              id: `_tmp_${Date.now()}`,
              label: 'Nueva actividad',
              completado: false,
            }
            setItems(prev => [...prev, tmp])
            startEdit(tmp)
          }}
          className="inline-flex items-center gap-1.5 text-[11px] text-[#10B981] hover:underline"
        >
          <Plus className="h-3 w-3" />
          Agregar actividad
        </button>
      )}

      <div className="flex items-center gap-2 pt-1">
        <CalendarDays className="h-3 w-3 text-[#6B7280]" />
        <span className="text-[10px] text-[#6B7280]">
          {items.filter(i => i.completado).length}/{items.length} completadas
          {requireAllDates && ' · Requiere todas las fechas'}
        </span>
      </div>
    </div>
  )
}
