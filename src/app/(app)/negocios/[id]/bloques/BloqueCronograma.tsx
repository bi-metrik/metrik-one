'use client'

import { useState, useTransition, useEffect, useRef } from 'react'
import { CalendarDays, Plus, CheckCircle2, Circle, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { marcarBloqueItem, agregarBloqueItem, actualizarBloqueItem, eliminarBloqueItem, reevaluarBloqueCronograma, inicializarBloqueItems } from '../../negocio-v2-actions'
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
  preloadItems?: Array<{ label: string; tipo: string }>
}

function fmtDate(iso: string | null | undefined) {
  if (!iso) return '—'
  return new Date(iso + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })
}

export default function BloqueCronograma({
  negocioBloqueId,
  modo,
  initialItems = [],
  requireAllDates = false,
  profiles = [],
  preloadItems = [],
}: BloqueCronogramaProps) {
  const [items, setItems] = useState<CronogramaItem[]>(initialItems)
  const [isPending, startTransition] = useTransition()
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValues, setEditValues] = useState<Partial<CronogramaItem>>({})
  const preloadedRef = useRef(false)

  // Gap 3: Inicializar items desde config_extra.items si no hay items y hay templates
  useEffect(() => {
    if (preloadedRef.current) return
    if (items.length > 0 || preloadItems.length === 0 || !negocioBloqueId) return
    preloadedRef.current = true

    startTransition(async () => {
      const result = await inicializarBloqueItems(negocioBloqueId, preloadItems)
      if (!result.error && result.items.length > 0) {
        setItems(result.items.map(i => ({
          id: i.id,
          label: i.label,
          completado: i.completado,
          completado_at: i.completado_at,
          link_url: i.link_url,
        })))
      }
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Gap 2: Re-evaluar completitud después de cada cambio
  function evalCompletitud() {
    startTransition(async () => {
      await reevaluarBloqueCronograma(negocioBloqueId, requireAllDates)
    })
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
      }
    })
  }

  function startEdit(item: CronogramaItem) {
    setEditingId(item.id)
    setEditValues({ ...item })
  }

  function cancelEdit() {
    // Si era temporal y se cancela, eliminarlo
    if (editingId?.startsWith('_tmp_')) {
      setItems(prev => prev.filter(i => i.id !== editingId))
    }
    setEditingId(null)
    setEditValues({})
  }

  function saveEdit() {
    const targetItem = items.find(i => i.id === editingId)
    if (!targetItem) return
    const updated = { ...targetItem, ...editValues }
    setItems(prev => prev.map(i => i.id === editingId ? updated : i))
    setEditingId(null)

    startTransition(async () => {
      if (updated.id.startsWith('_tmp_')) {
        const extra: { fecha_inicio?: string | null; fecha_fin?: string | null; responsable_id?: string | null } = {}
        if (updated.fecha_inicio) extra.fecha_inicio = updated.fecha_inicio
        if (updated.fecha_fin) extra.fecha_fin = updated.fecha_fin
        if (updated.responsable_id) extra.responsable_id = updated.responsable_id
        const result = await agregarBloqueItem(negocioBloqueId, updated.label, 'texto', items.length, extra)
        if (result.error) {
          toast.error(result.error)
        } else if (result.id) {
          setItems(prev => prev.map(i => i.id === updated.id ? { ...i, id: result.id! } : i))
          evalCompletitud()
        }
      } else {
        const fields: { label?: string; fecha_inicio?: string | null; fecha_fin?: string | null; responsable_id?: string | null } = { label: updated.label }
        if (updated.fecha_inicio !== undefined) fields.fecha_inicio = updated.fecha_inicio || null
        if (updated.fecha_fin !== undefined) fields.fecha_fin = updated.fecha_fin || null
        if (updated.responsable_id !== undefined) fields.responsable_id = updated.responsable_id || null
        const result = await actualizarBloqueItem(updated.id, fields)
        if (result.error) toast.error(result.error)
        // Gap 2: Re-evaluar completitud
        evalCompletitud()
      }
    })
  }

  // Gap 4: Eliminar actividad
  function handleDelete(item: CronogramaItem) {
    if (item.id.startsWith('_tmp_')) {
      setItems(prev => prev.filter(i => i.id !== item.id))
      return
    }
    if (!confirm('¿Eliminar esta actividad?')) return
    const nextItems = items.filter(i => i.id !== item.id)
    setItems(nextItems)
    startTransition(async () => {
      const result = await eliminarBloqueItem(item.id)
      if (result.error) {
        toast.error(result.error)
        setItems(items) // revert
      } else {
        evalCompletitud()
      }
    })
  }

  function getProfileName(id: string | null | undefined) {
    if (!id) return null
    const p = profiles.find(pr => pr.id === id)
    return p?.full_name ?? null
  }

  if (items.length === 0 && !isPending) {
    return (
      <div className="space-y-2">
        <p className="text-xs text-[#6B7280]">Sin actividades configuradas en el cronograma</p>
        {modo === 'editable' && (
          <button
            onClick={() => {
              const tmp: CronogramaItem = {
                id: `_tmp_${Date.now()}`,
                label: '',
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
              {profiles.length > 0 && (
                <th className="pb-1.5 pr-2 text-left text-[10px] font-medium text-[#6B7280] uppercase">Responsable</th>
              )}
              <th className="pb-1.5 text-left text-[10px] font-medium text-[#6B7280] uppercase">Estado</th>
              {modo === 'editable' && <th className="pb-1.5 w-6" />}
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
                      placeholder="Nombre de la actividad"
                      className="w-full rounded border border-[#E5E7EB] px-1.5 py-1 text-xs focus:border-[#10B981] focus:outline-none"
                      autoFocus
                    />
                  ) : (
                    <span
                      className={`${item.completado ? 'line-through text-[#6B7280]' : 'text-[#1A1A1A]'} ${modo === 'editable' ? 'cursor-pointer hover:text-[#10B981]' : ''}`}
                      onClick={() => modo === 'editable' && startEdit(item)}
                    >
                      {item.label || 'Sin nombre'}
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
                {profiles.length > 0 && (
                  <td className="py-2 pr-2">
                    {editingId === item.id ? (
                      <select
                        value={editValues.responsable_id ?? ''}
                        onChange={e => setEditValues(p => ({ ...p, responsable_id: e.target.value || null }))}
                        className="rounded border border-[#E5E7EB] px-1.5 py-1 text-xs focus:border-[#10B981] focus:outline-none"
                      >
                        <option value="">Sin asignar</option>
                        {profiles.map(p => (
                          <option key={p.id} value={p.id}>{p.full_name ?? 'Sin nombre'}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-[#6B7280]">{getProfileName(item.responsable_id) ?? '—'}</span>
                    )}
                  </td>
                )}
                <td className="py-2">
                  {editingId === item.id ? (
                    <div className="flex gap-1">
                      <button onClick={saveEdit} disabled={!editValues.label?.trim()} className="rounded bg-[#10B981] px-2 py-0.5 text-[10px] text-white disabled:opacity-50">OK</button>
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
                {modo === 'editable' && (
                  <td className="py-2">
                    {editingId !== item.id && (
                      <button
                        onClick={() => handleDelete(item)}
                        disabled={isPending}
                        className="text-[#6B7280]/40 hover:text-red-500 disabled:opacity-50"
                        title="Eliminar actividad"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modo === 'editable' && !editingId && (
        <button
          onClick={() => {
            const tmp: CronogramaItem = {
              id: `_tmp_${Date.now()}`,
              label: '',
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
