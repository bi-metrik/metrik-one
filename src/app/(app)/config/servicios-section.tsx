'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Plus, X, Trash2, Check, ChevronDown, ChevronRight,
  Pencil, Power, PowerOff, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  createServicio, updateServicio, deleteServicio, toggleServicio,
} from './servicios-actions'
import type { RubroTemplate } from './servicios-actions'
import { TIPOS_RUBRO } from '@/lib/pipeline/constants'
import { formatCOP } from '@/lib/contacts/constants'
import type { Servicio } from '@/types/database'

interface Props {
  initialData: Servicio[]
}

export default function ServiciosSection({ initialData }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [servicios, setServicios] = useState(initialData)
  const [showAddForm, setShowAddForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  // New servicio form
  const [nombre, setNombre] = useState('')
  const [precio, setPrecio] = useState('')
  const [costoEstimado, setCostoEstimado] = useState('')
  const [rubros, setRubros] = useState<RubroTemplate[]>([])
  const [showRubroForm, setShowRubroForm] = useState(false)
  const [newRubro, setNewRubro] = useState<RubroTemplate>({
    tipo: 'mo_propia',
    descripcion: '',
    cantidad: 1,
    unidad: 'horas',
    valor_unitario: 0,
  })

  const resetForm = () => {
    setNombre('')
    setPrecio('')
    setCostoEstimado('')
    setRubros([])
    setShowRubroForm(false)
    setNewRubro({ tipo: 'mo_propia', descripcion: '', cantidad: 1, unidad: 'horas', valor_unitario: 0 })
    setShowAddForm(false)
    setEditingId(null)
  }

  const addRubroToList = () => {
    if (newRubro.valor_unitario <= 0) {
      toast.error('El valor unitario debe ser mayor a 0')
      return
    }
    setRubros(prev => [...prev, { ...newRubro }])
    const t = TIPOS_RUBRO.find(r => r.value === 'mo_propia')
    setNewRubro({ tipo: 'mo_propia', descripcion: '', cantidad: 1, unidad: t?.unidadDefault ?? 'horas', valor_unitario: 0 })
    setShowRubroForm(false)
  }

  const removeRubro = (index: number) => {
    setRubros(prev => prev.filter((_, i) => i !== index))
  }

  const calcPrecioFromRubros = () => {
    return rubros.reduce((sum, r) => sum + (r.cantidad * r.valor_unitario), 0)
  }

  const handleCreate = () => {
    if (!nombre.trim()) { toast.error('Nombre requerido'); return }
    const precioVal = rubros.length > 0 ? calcPrecioFromRubros() : Number(precio)
    if (precioVal <= 0) { toast.error('Precio debe ser mayor a 0'); return }

    startTransition(async () => {
      const costoVal = Number(costoEstimado) || 0
      const res = await createServicio({
        nombre: nombre.trim(),
        precio_estandar: precioVal,
        costo_estimado: costoVal,
        rubros_template: rubros.length > 0 ? rubros : undefined,
      })
      if (res.success) {
        toast.success('Servicio creado')
        resetForm()
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleUpdate = (id: string) => {
    if (!nombre.trim()) { toast.error('Nombre requerido'); return }
    const precioVal = rubros.length > 0 ? calcPrecioFromRubros() : Number(precio)
    if (precioVal <= 0) { toast.error('Precio debe ser mayor a 0'); return }

    startTransition(async () => {
      const costoVal = Number(costoEstimado) || 0
      const res = await updateServicio(id, {
        nombre: nombre.trim(),
        precio_estandar: precioVal,
        costo_estimado: costoVal,
        rubros_template: rubros.length > 0 ? rubros : null,
      })
      if (res.success) {
        toast.success('Servicio actualizado')
        resetForm()
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleDelete = (id: string, name: string) => {
    if (!confirm(`Eliminar servicio "${name}"?`)) return
    startTransition(async () => {
      const res = await deleteServicio(id)
      if (res.success) {
        setServicios(prev => prev.filter(s => s.id !== id))
        toast.success('Servicio eliminado')
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleToggle = (id: string, currentActive: boolean) => {
    startTransition(async () => {
      const res = await toggleServicio(id, !currentActive)
      if (res.success) {
        setServicios(prev => prev.map(s => s.id === id ? { ...s, activo: !currentActive } : s))
        toast.success(currentActive ? 'Servicio desactivado' : 'Servicio activado')
      } else {
        toast.error(res.error)
      }
    })
  }

  const startEdit = (s: Servicio) => {
    setEditingId(s.id)
    setNombre(s.nombre)
    setPrecio(s.precio_estandar?.toString() ?? '')
    setCostoEstimado(s.costo_estimado?.toString() ?? '')
    const tpl = s.rubros_template as RubroTemplate[] | null
    setRubros(tpl ?? [])
    setShowAddForm(true)
  }

  const getRubroLabel = (tipo: string) =>
    TIPOS_RUBRO.find(t => t.value === tipo)?.label ?? tipo

  const activeCount = servicios.filter(s => s.activo !== false).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Mis servicios</h3>
          <p className="text-sm text-muted-foreground">
            {servicios.length} servicio{servicios.length !== 1 ? 's' : ''} ({activeCount} activo{activeCount !== 1 ? 's' : ''})
          </p>
        </div>
        <button
          onClick={() => { if (showAddForm) resetForm(); else setShowAddForm(true) }}
          className="flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          {showAddForm ? <X className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
          {showAddForm ? 'Cancelar' : 'Nuevo servicio'}
        </button>
      </div>

      {/* Create / Edit form */}
      {showAddForm && (
        <div className="space-y-3 rounded-lg border border-primary/20 bg-primary/5 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Nombre del servicio *</label>
              <input
                value={nombre}
                onChange={e => setNombre(e.target.value)}
                placeholder="Ej: Diseno de marca"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                autoFocus
              />
            </div>
            {rubros.length === 0 && (
              <div>
                <label className="mb-1 block text-xs font-medium text-muted-foreground">Precio estandar *</label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                  <input
                    type="number"
                    value={precio}
                    onChange={e => setPrecio(e.target.value)}
                    placeholder="1500000"
                    min="0"
                    className="w-full rounded-md border bg-background py-2 pl-7 pr-3 text-sm"
                  />
                </div>
              </div>
            )}
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Costo estimado</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <input
                  type="number"
                  value={costoEstimado}
                  onChange={e => setCostoEstimado(e.target.value)}
                  placeholder="500000"
                  min="0"
                  className="w-full rounded-md border bg-background py-2 pl-7 pr-3 text-sm"
                />
              </div>
              {Number(costoEstimado) > 0 && (Number(precio) > 0 || calcPrecioFromRubros() > 0) && (
                <p className="mt-1 text-xs text-green-600">
                  Margen: {(((rubros.length > 0 ? calcPrecioFromRubros() : Number(precio)) - Number(costoEstimado)) / (rubros.length > 0 ? calcPrecioFromRubros() : Number(precio)) * 100).toFixed(1)}%
                </p>
              )}
            </div>
          </div>

          {/* Rubros template */}
          <div>
            <div className="flex items-center justify-between">
              <label className="text-xs font-medium text-muted-foreground">
                Rubros plantilla {rubros.length > 0 && `(${rubros.length})`}
              </label>
              {rubros.length > 0 && (
                <span className="text-xs font-medium text-green-600">
                  Total: {formatCOP(calcPrecioFromRubros())}
                </span>
              )}
            </div>

            {rubros.length > 0 && (
              <div className="mt-2 space-y-1">
                {rubros.map((r, i) => (
                  <div key={i} className="flex items-center gap-2 rounded border bg-background px-2.5 py-1.5 text-xs">
                    <span className="font-medium">{getRubroLabel(r.tipo)}</span>
                    <span className="text-muted-foreground">{r.cantidad} {r.unidad}</span>
                    <span className="text-muted-foreground">× {formatCOP(r.valor_unitario)}</span>
                    <span className="ml-auto font-medium">{formatCOP(r.cantidad * r.valor_unitario)}</span>
                    <button onClick={() => removeRubro(i)} className="rounded p-0.5 text-red-500 hover:bg-red-50">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {showRubroForm ? (
              <div className="mt-2 space-y-2 rounded-md bg-muted/50 p-2.5">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={newRubro.tipo}
                    onChange={e => {
                      const t = TIPOS_RUBRO.find(r => r.value === e.target.value)
                      setNewRubro(p => ({ ...p, tipo: e.target.value, unidad: t?.unidadDefault ?? 'unidades' }))
                    }}
                    className="rounded border bg-background px-2 py-1.5 text-xs"
                  >
                    {TIPOS_RUBRO.map(t => (
                      <option key={t.value} value={t.value}>{t.label}</option>
                    ))}
                  </select>
                  <input
                    placeholder="Descripcion (opcional)"
                    value={newRubro.descripcion}
                    onChange={e => setNewRubro(p => ({ ...p, descripcion: e.target.value }))}
                    className="rounded border bg-background px-2 py-1.5 text-xs"
                  />
                  <input
                    type="number"
                    placeholder="Cantidad"
                    value={newRubro.cantidad || ''}
                    onChange={e => setNewRubro(p => ({ ...p, cantidad: Number(e.target.value) }))}
                    className="rounded border bg-background px-2 py-1.5 text-xs"
                  />
                  <input
                    placeholder="Unidad"
                    value={newRubro.unidad}
                    onChange={e => setNewRubro(p => ({ ...p, unidad: e.target.value }))}
                    className="rounded border bg-background px-2 py-1.5 text-xs"
                  />
                  <div className="relative col-span-2">
                    <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                    <input
                      type="number"
                      placeholder="Valor unitario"
                      value={newRubro.valor_unitario || ''}
                      onChange={e => setNewRubro(p => ({ ...p, valor_unitario: Number(e.target.value) }))}
                      className="w-full rounded border bg-background py-1.5 pl-5 pr-2 text-xs"
                    />
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => setShowRubroForm(false)}
                    className="rounded border px-2 py-1 text-xs hover:bg-accent"
                  >
                    Cancelar
                  </button>
                  <button
                    onClick={addRubroToList}
                    className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground"
                  >
                    Agregar rubro
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowRubroForm(true)}
                className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
              >
                <Plus className="h-3 w-3" />
                {rubros.length === 0 ? 'Agregar rubros plantilla (opcional)' : 'Agregar otro rubro'}
              </button>
            )}
          </div>

          <button
            onClick={() => editingId ? handleUpdate(editingId) : handleCreate()}
            disabled={isPending}
            className="flex h-10 w-full items-center justify-center rounded-lg bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : editingId ? 'Actualizar servicio' : 'Crear servicio'}
          </button>
        </div>
      )}

      {/* Servicios list */}
      {servicios.length > 0 ? (
        <div className="space-y-2">
          {servicios.map(s => {
            const tpl = s.rubros_template as RubroTemplate[] | null
            const isActive = s.activo !== false
            const isExpanded = expandedId === s.id

            return (
              <div
                key={s.id}
                className={`rounded-lg border transition-opacity ${!isActive ? 'opacity-50' : ''}`}
              >
                <div className="flex items-center gap-3 px-4 py-3">
                  {/* Toggle active */}
                  <button
                    onClick={() => handleToggle(s.id, isActive)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border transition-colors ${
                      isActive
                        ? 'border-green-500 bg-green-500 text-white'
                        : 'border-input hover:border-primary'
                    }`}
                  >
                    {isActive && <Check className="h-3 w-3" />}
                  </button>

                  {/* Name + rubros toggle */}
                  <button
                    onClick={() => setExpandedId(isExpanded ? null : s.id)}
                    className="flex flex-1 items-center gap-1.5 text-left min-w-0"
                  >
                    {tpl && tpl.length > 0 && (
                      isExpanded
                        ? <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        : <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <span className="text-sm font-medium truncate block">{s.nombre}</span>
                      {tpl && tpl.length > 0 && (
                        <span className="text-[10px] text-muted-foreground">{tpl.length} rubro{tpl.length !== 1 ? 's' : ''}</span>
                      )}
                    </div>
                  </button>

                  {/* Price + Margin */}
                  <div className="shrink-0 text-right">
                    <span className="text-sm font-medium">{formatCOP(s.precio_estandar ?? 0)}</span>
                    {(s.costo_estimado ?? 0) > 0 && (s.precio_estandar ?? 0) > 0 && (
                      <p className="text-[10px] text-green-600">
                        {(((s.precio_estandar ?? 0) - (s.costo_estimado ?? 0)) / (s.precio_estandar ?? 0) * 100).toFixed(1)}% margen
                      </p>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      onClick={() => startEdit(s)}
                      className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(s.id, s.nombre)}
                      className="rounded p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Expanded rubros */}
                {isExpanded && tpl && tpl.length > 0 && (
                  <div className="border-t px-4 py-2">
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="pb-1 pr-2">Tipo</th>
                            <th className="pb-1 pr-2">Cant.</th>
                            <th className="pb-1 pr-2">Unidad</th>
                            <th className="pb-1 pr-2 text-right">Vr. Unit.</th>
                            <th className="pb-1 text-right">Total</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tpl.map((r, i) => (
                            <tr key={i} className="border-b border-dashed last:border-0">
                              <td className="py-1.5 pr-2">{getRubroLabel(r.tipo)}</td>
                              <td className="py-1.5 pr-2">{r.cantidad}</td>
                              <td className="py-1.5 pr-2">{r.unidad}</td>
                              <td className="py-1.5 pr-2 text-right">{formatCOP(r.valor_unitario)}</td>
                              <td className="py-1.5 text-right font-medium">{formatCOP(r.cantidad * r.valor_unitario)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      ) : !showAddForm && (
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Crea tu catalogo de servicios. Al cotizar, podras agregar servicios del catalogo y los rubros se llenan solos.
          </p>
        </div>
      )}
    </div>
  )
}
