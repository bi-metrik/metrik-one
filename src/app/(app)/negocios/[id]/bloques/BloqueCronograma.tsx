'use client'

import { useState, useTransition, useEffect, useRef, useCallback } from 'react'
import { CalendarDays, Plus, CheckCircle2, Circle, Trash2, GanttChart } from 'lucide-react'
import { toast } from 'sonner'
import { marcarBloqueItem, agregarBloqueItem, actualizarBloqueItem, eliminarBloqueItem, reevaluarBloqueCronograma, inicializarBloqueItems, leerVersionCronograma, type VersionCronograma } from '../../negocio-v2-actions'
import type { NegocioBloque } from '../../negocio-v2-actions'
import { formatBogotaFechaCortaAno } from '@/lib/dates/bogota'
import GanttCronogramaModal from './GanttCronogramaModal'

/**
 * Un paso del cronograma. Las fechas van en dos pares que NO significan lo mismo:
 *
 *   fecha_inicio / fecha_fin            → el PLAN, que se arma en planeación.
 *   fecha_inicio_real / fecha_fin_real  → lo que pasó, que se marca en ejecución.
 *
 * Antes había un solo par y se corregía sobre la marcha, así que el cronograma siempre
 * se cumplía. Mover el plan publica una versión nueva; marcar el real, no.
 */
interface CronogramaItem {
  id: string
  label: string
  fecha_inicio?: string | null
  fecha_fin?: string | null
  fecha_inicio_real?: string | null
  fecha_fin_real?: string | null
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
  return formatBogotaFechaCortaAno(iso) ?? '—'
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
  const [version, setVersion] = useState<VersionCronograma | null>(null)
  const [ganttAbierto, setGanttAbierto] = useState(false)
  const preloadedRef = useRef(false)
  // Si la plantilla no se pudo materializar, la pantalla no puede decir "sin
  // actividades configuradas": la config SÍ las declara.
  const [errorInicializando, setErrorInicializando] = useState(false)

  // El sello de versión. Se recarga después de cada cambio de planeación porque ese
  // cambio pudo haber cortado una versión nueva, y el número que se muestra tiene que
  // ser el del documento que Omar le puede mandar al cliente ahora mismo.
  const refrescarVersion = useCallback(() => {
    if (!negocioBloqueId) return
    void leerVersionCronograma(negocioBloqueId).then(setVersion)
  }, [negocioBloqueId])

  useEffect(() => { refrescarVersion() }, [refrescarVersion])

  // Gap 3: Inicializar items desde config_extra.items si no hay items y hay templates.
  // La plantilla la lee el servidor de la config del bloque; aquí solo se decide si
  // hace falta pedirla.
  useEffect(() => {
    if (preloadedRef.current) return
    if (items.length > 0 || preloadItems.length === 0 || !negocioBloqueId) return
    preloadedRef.current = true

    startTransition(async () => {
      const result = await inicializarBloqueItems(negocioBloqueId)
      if (result.error) {
        setErrorInicializando(true)
        return
      }
      if (result.items.length > 0) {
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

  // Gap 2: Re-evaluar completitud después de cada cambio. Si el bloque exige todas las
  // fechas lo decide el servidor leyendo la config; `requireAllDates` aquí solo pinta la
  // leyenda de abajo.
  function evalCompletitud() {
    startTransition(async () => {
      await reevaluarBloqueCronograma(negocioBloqueId)
    })
  }

  function handleToggle(item: CronogramaItem) {
    if (item.id.startsWith('_tmp_')) return
    startTransition(async () => {
      const result = await marcarBloqueItem(item.id, !item.completado)
      if (result.error) {
        toast.error(result.error)
      } else {
        // Sobre el estado vigente y no sobre la foto del render: mientras la marca viajaba
        // pudo cambiar otra fila, y copiar la lista vieja la desharía en pantalla.
        setItems(prev => prev.map(i =>
          i.id === item.id ? { ...i, completado: !item.completado, completado_at: !item.completado ? new Date().toISOString() : null } : i
        ))
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

    // La edición se pinta antes de que responda el servidor. Si la rechaza, la tabla
    // tiene que volver a lo que de verdad quedó guardado: si no, el paso se ve editado
    // (o creado) hasta que alguien recarga, y el aviso de error se va a los segundos.
    startTransition(async () => {
      if (updated.id.startsWith('_tmp_')) {
        const extra: { fecha_inicio?: string | null; fecha_fin?: string | null; responsable_id?: string | null } = {}
        if (updated.fecha_inicio) extra.fecha_inicio = updated.fecha_inicio
        if (updated.fecha_fin) extra.fecha_fin = updated.fecha_fin
        if (updated.responsable_id) extra.responsable_id = updated.responsable_id
        const result = await agregarBloqueItem(negocioBloqueId, updated.label, 'texto', items.length, extra)
        if (result.error) {
          toast.error(result.error)
          // El paso nunca existió en el servidor: se retira. Dejarlo en blanco pintaría
          // una fila «Sin nombre» que no está guardada en ninguna parte.
          setItems(prev => prev.filter(i => i.id !== updated.id))
        } else if (result.id) {
          setItems(prev => prev.map(i => i.id === updated.id ? { ...i, id: result.id! } : i))
          evalCompletitud()
          refrescarVersion()
        }
      } else {
        const fields: { label?: string; fecha_inicio?: string | null; fecha_fin?: string | null; responsable_id?: string | null } = { label: updated.label }
        if (updated.fecha_inicio !== undefined) fields.fecha_inicio = updated.fecha_inicio || null
        if (updated.fecha_fin !== undefined) fields.fecha_fin = updated.fecha_fin || null
        if (updated.responsable_id !== undefined) fields.responsable_id = updated.responsable_id || null
        const result = await actualizarBloqueItem(updated.id, fields)
        if (result.error) {
          toast.error(result.error)
          // Solo se devuelven los campos que tocó la edición: el avance real de la misma
          // fila pudo marcarse mientras tanto y ese sí quedó guardado.
          setItems(prev => prev.map(i => i.id === updated.id
            ? {
                ...i,
                label: targetItem.label,
                fecha_inicio: targetItem.fecha_inicio,
                fecha_fin: targetItem.fecha_fin,
                responsable_id: targetItem.responsable_id,
              }
            : i))
          return
        }
        // Gap 2: Re-evaluar completitud
        evalCompletitud()
        refrescarVersion()
      }
    })
  }

  /**
   * Marca de avance: la fecha en que el paso ARRANCÓ o TERMINÓ de verdad.
   *
   * Va aparte del modo edición a propósito. Anotar el avance es lo que se hace en obra,
   * de a un dato por vez, y obligar a entrar a editar el paso entero para eso invita a
   * "corregir" de paso la fecha planeada, que es justamente lo que borraba el desfase.
   */
  function marcarAvance(item: CronogramaItem, campo: 'fecha_inicio_real' | 'fecha_fin_real', valor: string) {
    // Una fila sin guardar no tiene dónde escribir el avance: `agregarBloqueItem` no lo
    // manda, así que la fecha quedaba pintada y se perdía al guardar el paso.
    if (item.id.startsWith('_tmp_')) return
    const fecha = valor || null
    const previo = item[campo] ?? null
    setItems(prev => prev.map(i => (i.id === item.id ? { ...i, [campo]: fecha } : i)))
    startTransition(async () => {
      const result = await actualizarBloqueItem(item.id, { [campo]: fecha })
      if (result.error) {
        toast.error(result.error)
        // Se devuelve la fecha anterior solo si nadie la volvió a cambiar mientras tanto.
        setItems(prev => prev.map(i =>
          i.id === item.id && (i[campo] ?? null) === fecha ? { ...i, [campo]: previo } : i
        ))
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
    const posicion = items.findIndex(i => i.id === item.id)
    setItems(prev => prev.filter(i => i.id !== item.id))
    startTransition(async () => {
      const result = await eliminarBloqueItem(item.id)
      if (result.error) {
        toast.error(result.error)
        // Vuelve solo la fila borrada, en su lugar. Restaurar la lista entera del momento
        // del clic desharía lo que se guardó mientras el borrado viajaba.
        setItems(prev => prev.some(i => i.id === item.id)
          ? prev
          : [...prev.slice(0, Math.max(posicion, 0)), item, ...prev.slice(Math.max(posicion, 0))])
      } else {
        refrescarVersion()
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
        <p className="text-xs text-tinta-suave">
          {errorInicializando
            ? 'No se pudieron cargar las actividades de este cronograma.'
            : 'Sin actividades configuradas en el cronograma'}
        </p>
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
            className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-acento px-3 py-2 text-xs text-acento hover:bg-acento/5"
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
              <th className="pb-1.5 pr-2 text-left text-[10px] font-medium text-tinta-suave uppercase">Actividad</th>
              <th className="pb-1.5 pr-2 text-left text-[10px] font-medium text-tinta-suave uppercase">Inicio plan</th>
              <th className="pb-1.5 pr-2 text-left text-[10px] font-medium text-tinta-suave uppercase">Fin plan</th>
              <th className="pb-1.5 pr-2 text-left text-[10px] font-medium text-acento uppercase">Inicio real</th>
              <th className="pb-1.5 pr-2 text-left text-[10px] font-medium text-acento uppercase">Fin real</th>
              {profiles.length > 0 && (
                <th className="pb-1.5 pr-2 text-left text-[10px] font-medium text-tinta-suave uppercase">Responsable</th>
              )}
              <th className="pb-1.5 text-left text-[10px] font-medium text-tinta-suave uppercase">Estado</th>
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
                      className="w-full rounded border border-[#E5E7EB] px-1.5 py-1 text-xs focus:border-acento focus:outline-none"
                      autoFocus
                    />
                  ) : (
                    <span
                      className={`${item.completado ? 'line-through text-tinta-suave' : 'text-tinta'} ${modo === 'editable' ? 'cursor-pointer hover:text-acento' : ''}`}
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
                      className="rounded border border-[#E5E7EB] px-1.5 py-1 text-xs focus:border-acento focus:outline-none"
                    />
                  ) : (
                    <span className="text-tinta-suave">{fmtDate(item.fecha_inicio)}</span>
                  )}
                </td>
                <td className="py-2 pr-2">
                  {editingId === item.id ? (
                    <input
                      type="date"
                      value={editValues.fecha_fin ?? ''}
                      onChange={e => setEditValues(p => ({ ...p, fecha_fin: e.target.value }))}
                      className="rounded border border-[#E5E7EB] px-1.5 py-1 text-xs focus:border-acento focus:outline-none"
                    />
                  ) : (
                    <span className="text-tinta-suave">{fmtDate(item.fecha_fin)}</span>
                  )}
                </td>
                <td className="py-2 pr-2">
                  {modo === 'editable' ? (
                    <input
                      type="date"
                      value={item.fecha_inicio_real ?? ''}
                      onChange={e => marcarAvance(item, 'fecha_inicio_real', e.target.value)}
                      disabled={item.id.startsWith('_tmp_')}
                      title={item.id.startsWith('_tmp_') ? 'Guarda la actividad antes de marcar el avance' : undefined}
                      aria-label={`Inicio real de ${item.label || 'la actividad'}`}
                      className="rounded border border-[#E5E7EB] px-1.5 py-1 text-xs focus:border-acento focus:outline-none disabled:opacity-50"
                    />
                  ) : (
                    <span className="text-tinta">{fmtDate(item.fecha_inicio_real)}</span>
                  )}
                </td>
                <td className="py-2 pr-2">
                  {modo === 'editable' ? (
                    <input
                      type="date"
                      value={item.fecha_fin_real ?? ''}
                      onChange={e => marcarAvance(item, 'fecha_fin_real', e.target.value)}
                      disabled={item.id.startsWith('_tmp_')}
                      title={item.id.startsWith('_tmp_') ? 'Guarda la actividad antes de marcar el avance' : undefined}
                      aria-label={`Fin real de ${item.label || 'la actividad'}`}
                      className="rounded border border-[#E5E7EB] px-1.5 py-1 text-xs focus:border-acento focus:outline-none disabled:opacity-50"
                    />
                  ) : (
                    <span className="text-tinta">{fmtDate(item.fecha_fin_real)}</span>
                  )}
                </td>
                {profiles.length > 0 && (
                  <td className="py-2 pr-2">
                    {editingId === item.id ? (
                      <select
                        value={editValues.responsable_id ?? ''}
                        onChange={e => setEditValues(p => ({ ...p, responsable_id: e.target.value || null }))}
                        className="rounded border border-[#E5E7EB] px-1.5 py-1 text-xs focus:border-acento focus:outline-none"
                      >
                        <option value="">Sin asignar</option>
                        {profiles.map(p => (
                          <option key={p.id} value={p.id}>{p.full_name ?? 'Sin nombre'}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-tinta-suave">{getProfileName(item.responsable_id) ?? '—'}</span>
                    )}
                  </td>
                )}
                <td className="py-2">
                  {editingId === item.id ? (
                    <div className="flex gap-1">
                      <button onClick={saveEdit} disabled={!editValues.label?.trim()} className="rounded bg-acento px-2 py-0.5 text-[10px] text-white disabled:opacity-50">OK</button>
                      <button onClick={cancelEdit} className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-tinta-suave">✕</button>
                    </div>
                  ) : (
                    <button
                      onClick={() => modo === 'editable' && handleToggle(item)}
                      disabled={isPending || modo === 'visible'}
                      className="disabled:cursor-default"
                    >
                      {item.completado ? (
                        <CheckCircle2 className="h-4 w-4 text-acento" />
                      ) : (
                        <Circle className="h-4 w-4 text-tinta-suave/30" />
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
                        className="text-tinta-suave/40 hover:text-red-500 disabled:opacity-50"
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
          className="inline-flex items-center gap-1.5 text-[11px] text-acento hover:underline"
        >
          <Plus className="h-3 w-3" />
          Agregar actividad
        </button>
      )}

      <div className="flex flex-wrap items-center gap-2 pt-1">
        <CalendarDays className="h-3 w-3 text-tinta-suave" />
        <span className="text-[10px] text-tinta-suave">
          {items.filter(i => i.completado).length}/{items.length} completadas
          {requireAllDates && ' · Requiere todas las fechas'}
        </span>
        {version && (
          <span
            className="rounded-full bg-acento/10 px-2 py-0.5 text-[10px] font-medium text-acento"
            title={version.cambios.join(' · ')}
          >
            Versión {version.numero}
          </span>
        )}
        {/* La vista que se comparte con el cliente. Se ofrece también en modo visible:
            quien solo mira el negocio es justamente quien más necesita el documento. */}
        {negocioBloqueId && items.some(i => !i.id.startsWith('_tmp_')) && (
          <button
            type="button"
            onClick={() => setGanttAbierto(true)}
            className="ml-auto inline-flex items-center gap-1 rounded-full border border-[#E5E7EB] px-2.5 py-1 text-[10px] font-medium text-tinta hover:bg-black/[0.03]"
          >
            <GanttChart className="h-3 w-3" /> Ver Gantt y PDF
          </button>
        )}
      </div>
      {ganttAbierto && (
        <GanttCronogramaModal negocioBloqueId={negocioBloqueId} onClose={() => setGanttAbierto(false)} />
      )}
      {version && version.cambios.length > 0 && (
        <p className="text-[10px] leading-relaxed text-tinta-suave/70">
          Último cambio de planeación: {version.cambios[0]}
          {version.cambios.length > 1 && ` (+${version.cambios.length - 1} más)`}
        </p>
      )}
    </div>
  )
}
