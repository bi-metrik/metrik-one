'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Send, Copy, Save, Plus, Trash2,
  ChevronDown, ChevronRight, Lock, BookOpen, Loader2,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  updateCotizacion, enviarCotizacion, duplicarCotizacion,
  addItem, updateItem, deleteItem,
  addRubro, deleteRubro, recalcularTotales,
  addItemFromServicio,
} from '../../cotizaciones/actions-v2'
import { getServiciosActivos } from '@/app/(app)/config/servicios-actions'
import { ESTADO_COTIZACION_CONFIG, TIPOS_RUBRO } from '@/lib/pipeline/constants'
import { formatCOP } from '@/lib/contacts/constants'
import { isEditable } from '@/lib/cotizaciones/state-machine'
import type { EstadoCotizacion } from '@/lib/pipeline/constants'

interface RubroRow {
  id: string
  tipo: string | null
  descripcion: string | null
  cantidad: number | null
  unidad: string | null
  valor_unitario: number | null
  valor_total: number | null
}

interface ItemRow {
  id: string
  nombre: string | null
  subtotal: number | null
  orden: number | null
  rubros: RubroRow[]
}

interface CotizacionData {
  id: string
  consecutivo: string | null
  modo: string | null
  estado: string | null
  descripcion: string | null
  valor_total: number | null
  margen_porcentaje: number | null
  costo_total: number | null
  fecha_envio: string | null
  fecha_validez: string | null
}

interface Props {
  oportunidadId: string
  cotizacion: CotizacionData
  initialItems: ItemRow[]
}

export default function CotizacionEditor({ oportunidadId, cotizacion, initialItems }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const estado = cotizacion.estado as EstadoCotizacion
  const editable = isEditable(estado)
  const estadoConfig = ESTADO_COTIZACION_CONFIG[estado]
  const isFlash = cotizacion.modo === 'flash'

  // Flash mode state
  const [flashDesc, setFlashDesc] = useState(cotizacion.descripcion ?? '')
  const [flashValor, setFlashValor] = useState(cotizacion.valor_total?.toString() ?? '')

  // Detallada mode state
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set(initialItems.map(i => i.id)))

  // New item
  const [newItemName, setNewItemName] = useState('')

  // Catalog
  const [showCatalog, setShowCatalog] = useState(false)
  const [catalogLoading, setCatalogLoading] = useState(false)
  const [catalogItems, setCatalogItems] = useState<{ id: string; nombre: string; precio_estandar: number | null; rubros_template: unknown }[]>([])

  const loadCatalog = async () => {
    if (catalogItems.length > 0) { setShowCatalog(true); return }
    setCatalogLoading(true)
    try {
      const data = await getServiciosActivos()
      setCatalogItems(data as { id: string; nombre: string; precio_estandar: number | null; rubros_template: unknown }[])
      setShowCatalog(true)
    } finally {
      setCatalogLoading(false)
    }
  }

  const handleAddFromCatalog = (servicioId: string) => {
    startTransition(async () => {
      const res = await addItemFromServicio(cotizacion.id, servicioId)
      if (res.success) {
        await recalcularTotales(cotizacion.id)
        setShowCatalog(false)
        toast.success('Servicio agregado con rubros')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  // New rubro
  const [addingRubroFor, setAddingRubroFor] = useState<string | null>(null)
  const [newRubro, setNewRubro] = useState({
    tipo: 'mo_propia',
    descripcion: '',
    cantidad: '1',
    unidad: 'horas',
    valor_unitario: '',
  })

  const toggleItem = (id: string) => {
    setExpandedItems(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSaveFlash = () => {
    startTransition(async () => {
      const res = await updateCotizacion(cotizacion.id, {
        descripcion: flashDesc.trim(),
        valor_total: Number(flashValor),
      })
      if (res.success) toast.success('Guardado')
      else toast.error(res.error)
    })
  }

  const handleEnviar = () => {
    startTransition(async () => {
      const res = await enviarCotizacion(cotizacion.id)
      if (res.success) {
        toast.success('Cotizacion enviada')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleDuplicar = () => {
    startTransition(async () => {
      const res = await duplicarCotizacion(cotizacion.id)
      if (res.success) {
        toast.success('Cotizacion duplicada')
        router.push(`/pipeline/${oportunidadId}/cotizacion/${res.id}`)
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleAddItem = () => {
    if (!newItemName.trim()) return
    startTransition(async () => {
      const res = await addItem(cotizacion.id, newItemName)
      if (res.success) {
        setNewItemName('')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleDeleteItem = (itemId: string) => {
    startTransition(async () => {
      const res = await deleteItem(itemId)
      if (res.success) {
        await recalcularTotales(cotizacion.id)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleAddRubro = (itemId: string) => {
    startTransition(async () => {
      const res = await addRubro(itemId, {
        tipo: newRubro.tipo,
        descripcion: newRubro.descripcion || undefined,
        cantidad: Number(newRubro.cantidad),
        unidad: newRubro.unidad,
        valor_unitario: Number(newRubro.valor_unitario),
      })
      if (res.success) {
        await recalcularTotales(cotizacion.id)
        setAddingRubroFor(null)
        setNewRubro({ tipo: 'mo_propia', descripcion: '', cantidad: '1', unidad: 'horas', valor_unitario: '' })
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleDeleteRubro = (rubroId: string) => {
    startTransition(async () => {
      const res = await deleteRubro(rubroId)
      if (res.success) {
        await recalcularTotales(cotizacion.id)
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  const costoTotal = initialItems.reduce((sum, item) => {
    return sum + ((item.rubros ?? []).reduce((s: number, r: RubroRow) => s + (r.valor_total ?? 0), 0))
  }, 0)

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link
          href={`/pipeline/${oportunidadId}`}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold">{cotizacion.consecutivo || 'Sin consecutivo'}</h1>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${estadoConfig?.chipClass}`}>
              {estadoConfig?.label}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
              {isFlash ? 'Flash' : 'Detallada'}
            </span>
          </div>
        </div>
        <div className="flex gap-1.5">
          {editable && (
            <button
              onClick={isFlash ? handleSaveFlash : () => router.refresh()}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
            >
              <Save className="h-3 w-3" />
              Guardar
            </button>
          )}
          {editable && (
            <button
              onClick={handleEnviar}
              disabled={isPending}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Send className="h-3 w-3" />
              Enviar
            </button>
          )}
          <button
            onClick={handleDuplicar}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <Copy className="h-3 w-3" />
            Duplicar
          </button>
        </div>
      </div>

      {!editable && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          <Lock className="h-4 w-4" />
          Esta cotizacion esta en estado <strong>{estadoConfig?.label}</strong> y no se puede editar. Puedes duplicarla.
        </div>
      )}

      {/* Flash editor */}
      {isFlash && (
        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Descripcion</label>
            <textarea
              value={flashDesc}
              onChange={e => setFlashDesc(e.target.value)}
              disabled={!editable}
              rows={3}
              className="w-full rounded-md border bg-background px-3 py-2 text-sm resize-none disabled:opacity-60"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Valor total</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <input
                type="number"
                value={flashValor}
                onChange={e => setFlashValor(e.target.value)}
                disabled={!editable}
                className="w-full rounded-md border bg-background py-2 pl-7 pr-3 text-sm disabled:opacity-60"
              />
            </div>
          </div>

          {/* Fiscal result preview */}
          <div className="rounded-lg bg-green-50 p-4 text-center">
            <p className="text-xs font-medium text-green-700">TU RECIBES</p>
            <p className="text-2xl font-bold text-green-700">{formatCOP(Number(flashValor) || 0)}</p>
            <p className="mt-1 text-[10px] text-green-600">
              Resultado fiscal: se calcula al completar el perfil fiscal de la empresa
            </p>
          </div>
        </div>
      )}

      {/* Detallada editor */}
      {!isFlash && (
        <div className="space-y-3">
          {/* Items */}
          {initialItems.map(item => (
            <div key={item.id} className="rounded-lg border">
              <div
                className="flex cursor-pointer items-center justify-between px-4 py-3"
                onClick={() => toggleItem(item.id)}
              >
                <div className="flex items-center gap-2">
                  {expandedItems.has(item.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                  <span className="text-sm font-medium">{item.nombre || 'Item sin nombre'}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium">{formatCOP(item.subtotal ?? 0)}</span>
                  {editable && (
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteItem(item.id) }}
                      className="rounded p-1 text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              {expandedItems.has(item.id) && (
                <div className="border-t px-4 pb-3 pt-2">
                  {/* Rubros table */}
                  {(item.rubros ?? []).length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="pb-1 pr-2">Tipo</th>
                            <th className="pb-1 pr-2">Cant.</th>
                            <th className="pb-1 pr-2">Unit.</th>
                            <th className="pb-1 pr-2 text-right">Vr. Unit.</th>
                            <th className="pb-1 text-right">Total</th>
                            {editable && <th className="pb-1 w-6" />}
                          </tr>
                        </thead>
                        <tbody>
                          {(item.rubros ?? []).map((r: RubroRow) => (
                            <tr key={r.id} className="border-b border-dashed">
                              <td className="py-1.5 pr-2">
                                {TIPOS_RUBRO.find(t => t.value === r.tipo)?.label ?? r.tipo}
                              </td>
                              <td className="py-1.5 pr-2">{r.cantidad}</td>
                              <td className="py-1.5 pr-2">{r.unidad}</td>
                              <td className="py-1.5 pr-2 text-right">{formatCOP(r.valor_unitario ?? 0)}</td>
                              <td className="py-1.5 text-right font-medium">{formatCOP(r.valor_total ?? 0)}</td>
                              {editable && (
                                <td className="py-1.5">
                                  <button
                                    onClick={() => handleDeleteRubro(r.id)}
                                    className="rounded p-0.5 text-red-500 hover:bg-red-50"
                                  >
                                    <Trash2 className="h-3 w-3" />
                                  </button>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Add rubro */}
                  {editable && addingRubroFor === item.id ? (
                    <div className="mt-2 space-y-2 rounded-md bg-muted/30 p-2">
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
                          type="number"
                          placeholder="Cantidad"
                          value={newRubro.cantidad}
                          onChange={e => setNewRubro(p => ({ ...p, cantidad: e.target.value }))}
                          className="rounded border bg-background px-2 py-1.5 text-xs"
                        />
                        <input
                          placeholder="Unidad"
                          value={newRubro.unidad}
                          onChange={e => setNewRubro(p => ({ ...p, unidad: e.target.value }))}
                          className="rounded border bg-background px-2 py-1.5 text-xs"
                        />
                        <input
                          type="number"
                          placeholder="Valor unitario"
                          value={newRubro.valor_unitario}
                          onChange={e => setNewRubro(p => ({ ...p, valor_unitario: e.target.value }))}
                          className="rounded border bg-background px-2 py-1.5 text-xs"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => setAddingRubroFor(null)}
                          className="rounded border px-2 py-1 text-xs hover:bg-accent"
                        >
                          Cancelar
                        </button>
                        <button
                          onClick={() => handleAddRubro(item.id)}
                          disabled={isPending || !Number(newRubro.valor_unitario)}
                          className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
                        >
                          Agregar rubro
                        </button>
                      </div>
                    </div>
                  ) : editable ? (
                    <button
                      onClick={() => setAddingRubroFor(item.id)}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Plus className="h-3 w-3" />
                      Agregar rubro
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          ))}

          {/* Add item actions */}
          {editable && (
            <div className="space-y-2">
              {/* Catalog selector */}
              {showCatalog ? (
                <div className="rounded-lg border border-blue-200 bg-blue-50/30 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-blue-800">Agregar desde catalogo</span>
                    <button onClick={() => setShowCatalog(false)} className="text-xs text-blue-600 hover:underline">Cerrar</button>
                  </div>
                  {catalogItems.length === 0 ? (
                    <p className="py-3 text-center text-xs text-muted-foreground">
                      No tienes servicios en tu catalogo. Crealos en Config → Mis servicios.
                    </p>
                  ) : (
                    <div className="space-y-1 max-h-48 overflow-y-auto">
                      {catalogItems.map(s => {
                        const tpl = s.rubros_template as { tipo: string; cantidad: number; unidad: string; valor_unitario: number }[] | null
                        return (
                          <button
                            key={s.id}
                            onClick={() => handleAddFromCatalog(s.id)}
                            disabled={isPending}
                            className="flex w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-left text-sm transition-colors hover:bg-accent disabled:opacity-50"
                          >
                            <div className="min-w-0">
                              <span className="font-medium">{s.nombre}</span>
                              {tpl && tpl.length > 0 && (
                                <span className="ml-2 text-[10px] text-muted-foreground">{tpl.length} rubros</span>
                              )}
                            </div>
                            <span className="shrink-0 text-xs font-medium">{formatCOP(s.precio_estandar ?? 0)}</span>
                          </button>
                        )
                      })}
                    </div>
                  )}
                </div>
              ) : (
                <button
                  onClick={loadCatalog}
                  disabled={catalogLoading}
                  className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-blue-300 py-2 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-50"
                >
                  {catalogLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
                  Agregar desde catalogo
                </button>
              )}

              {/* Manual item */}
              <div className="flex gap-2">
                <input
                  value={newItemName}
                  onChange={e => setNewItemName(e.target.value)}
                  placeholder="O escribe el nombre del item..."
                  className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
                  onKeyDown={e => e.key === 'Enter' && handleAddItem()}
                />
                <button
                  onClick={handleAddItem}
                  disabled={isPending || !newItemName.trim()}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Item
                </button>
              </div>
            </div>
          )}

          {/* Totals */}
          <div className="rounded-lg bg-muted/50 p-4 space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Costo total</span>
              <span className="font-medium">{formatCOP(costoTotal)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Valor venta</span>
              <span className="font-bold">{formatCOP(cotizacion.valor_total ?? 0)}</span>
            </div>
            {costoTotal > 0 && (cotizacion.valor_total ?? 0) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Margen</span>
                <span className="font-medium text-green-600">
                  {Math.round(((cotizacion.valor_total ?? 0) - costoTotal) / (cotizacion.valor_total ?? 1) * 100)}%
                </span>
              </div>
            )}
          </div>

          {/* Valor venta editable */}
          {editable && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Valor de venta</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <input
                  type="number"
                  defaultValue={cotizacion.valor_total ?? ''}
                  onBlur={e => {
                    const val = Number(e.target.value)
                    if (val > 0) {
                      startTransition(async () => {
                        await updateCotizacion(cotizacion.id, { valor_total: val })
                        router.refresh()
                      })
                    }
                  }}
                  className="w-full rounded-md border bg-background py-2 pl-7 pr-3 text-sm"
                />
              </div>
            </div>
          )}

          {/* Fiscal result */}
          <div className="rounded-lg bg-green-50 p-4 text-center">
            <p className="text-xs font-medium text-green-700">TU RECIBES</p>
            <p className="text-2xl font-bold text-green-700">{formatCOP(cotizacion.valor_total ?? 0)}</p>
            <p className="mt-1 text-[10px] text-green-600">
              Resultado fiscal detallado se calcula al completar el perfil fiscal de la empresa
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
