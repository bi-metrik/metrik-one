'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, Send, Copy, Save, Plus, Trash2, Percent, FileDown,
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
import { generateCotizacionPDF } from '@/app/(app)/pipeline/pdf-actions'
import { ESTADO_COTIZACION_CONFIG, TIPOS_RUBRO } from '@/lib/pipeline/constants'
import { formatCOP } from '@/lib/contacts/constants'
import { isEditable } from '@/lib/cotizaciones/state-machine'
import { generarResumenFiscal } from '@/lib/fiscal/calculos-fiscales'
import type { EstadoCotizacion } from '@/lib/pipeline/constants'
import type { FiscalProfile, Client } from '@/types/database'

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
  codigo: string | null
  consecutivo: string | null
  modo: string | null
  estado: string | null
  descripcion: string | null
  valor_total: number | null
  margen_porcentaje: number | null
  costo_total: number | null
  fecha_envio: string | null
  fecha_validez: string | null
  descuento_porcentaje?: number | null
  descuento_valor?: number | null
}

interface ClientFiscal {
  person_type: string | null
  tax_regime: string | null
  gran_contribuyente: boolean
  agente_retenedor: boolean
}

interface Props {
  oportunidadId: string
  cotizacion: CotizacionData
  initialItems: ItemRow[]
  fiscalProfile?: FiscalProfile | null
  clientFiscal?: ClientFiscal | null
}

export default function CotizacionEditor({ oportunidadId, cotizacion, initialItems, fiscalProfile, clientFiscal }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const estado = cotizacion.estado as EstadoCotizacion
  const editable = isEditable(estado)
  const estadoConfig = ESTADO_COTIZACION_CONFIG[estado]
  const isFlash = cotizacion.modo === 'flash'

  // Flash mode state
  const [flashDesc, setFlashDesc] = useState(cotizacion.descripcion ?? '')
  const [flashValor, setFlashValor] = useState(cotizacion.valor_total?.toString() ?? '')

  // Discount state (shared between flash and detallada)
  const [discountPct, setDiscountPct] = useState(cotizacion.descuento_porcentaje?.toString() ?? '0')

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
        toast.success('Servicio agregado con costos')
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
      const pct = Math.min(100, Math.max(0, Number(discountPct) || 0))
      const val = Math.round(Number(flashValor) * pct / 100)
      const res = await updateCotizacion(cotizacion.id, {
        descripcion: flashDesc.trim(),
        valor_total: Number(flashValor),
        descuento_porcentaje: pct,
        descuento_valor: val,
      })
      if (res.success) toast.success('Guardado')
      else toast.error(res.error)
    })
  }

  const handleEnviar = () => {
    startTransition(async () => {
      const res = await enviarCotizacion(cotizacion.id)
      if (res.success) {
        toast.success('Cotización enviada')
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
        toast.success('Cotización duplicada')
        router.push(`/pipeline/${oportunidadId}/cotizacion/${res.id}`)
      } else {
        toast.error(res.error)
      }
    })
  }

  const handleDescargarPDF = () => {
    startTransition(async () => {
      const res = await generateCotizacionPDF(cotizacion.id)
      if (res.success && res.pdf) {
        // Convert base64 to blob and trigger download
        const byteChars = atob(res.pdf)
        const byteArray = new Uint8Array(byteChars.length)
        for (let i = 0; i < byteChars.length; i++) byteArray[i] = byteChars.charCodeAt(i)
        const blob = new Blob([byteArray], { type: 'application/pdf' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = res.filename || `${cotizacion.consecutivo}.pdf`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        URL.revokeObjectURL(url)
        toast.success('PDF descargado')
      } else {
        toast.error(res.error || 'Error generando PDF')
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
        <button
          onClick={() => router.back()}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold">{cotizacion.codigo || cotizacion.consecutivo || 'Sin codigo'}</h1>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${estadoConfig?.chipClass}`}>
              {estadoConfig?.label}
            </span>
            <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium">
              {isFlash ? 'Rápida' : 'Detallada'}
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
            onClick={handleDescargarPDF}
            disabled={isPending}
            className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs font-medium hover:bg-accent disabled:opacity-50"
          >
            <FileDown className="h-3 w-3" />
            PDF
          </button>
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
          Esta cotización está en estado <strong>{estadoConfig?.label}</strong> y no se puede editar. Puedes duplicarla.
        </div>
      )}

      {/* Flash editor */}
      {isFlash && (
        <div className="space-y-3 rounded-lg border p-4">
          <div>
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Descripción</label>
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
                type="text"
                inputMode="numeric"
                value={Number(flashValor) ? Number(flashValor).toLocaleString('es-CO') : flashValor}
                onChange={e => {
                  const raw = e.target.value.replace(/[^0-9]/g, '')
                  setFlashValor(raw)
                }}
                disabled={!editable}
                className="w-full rounded-md border bg-background py-2 pl-7 pr-3 text-sm disabled:opacity-60"
              />
            </div>
          </div>

          {/* Discount */}
          {editable && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Descuento</label>
              <div className="flex items-center gap-2">
                <div className="relative w-24">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={discountPct}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9.]/g, '')
                      setDiscountPct(raw)
                    }}
                    className="w-full rounded-md border bg-background py-2 pl-3 pr-7 text-sm"
                    placeholder="0"
                  />
                  <Percent className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                </div>
                {Number(discountPct) > 0 && Number(flashValor) > 0 && (
                  <span className="text-xs text-muted-foreground">
                    = -{formatCOP(Math.round(Number(flashValor) * Number(discountPct) / 100))}
                  </span>
                )}
              </div>
            </div>
          )}
          {!editable && (cotizacion.descuento_porcentaje ?? 0) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Descuento ({cotizacion.descuento_porcentaje}%)</span>
              <span className="font-medium text-red-600">-{formatCOP(cotizacion.descuento_valor ?? 0)}</span>
            </div>
          )}

          {/* Fiscal result preview */}
          {(() => {
            const valorBruto = Number(flashValor) || 0
            const pct = Math.min(100, Math.max(0, Number(discountPct) || 0))
            const descVal = Math.round(valorBruto * pct / 100)
            const valor = valorBruto - descVal
            const hasFiscal = fiscalProfile?.is_complete && clientFiscal?.agente_retenedor != null
            if (!hasFiscal || valor === 0) {
              return (
                <div className="rounded-lg bg-green-50 p-4 text-center">
                  <p className="text-xs font-medium text-green-700">TU RECIBES</p>
                  <p className="text-2xl font-bold text-green-700">{formatCOP(valor)}</p>
                  <p className="mt-1 text-[10px] text-green-600">
                    {!fiscalProfile?.is_complete
                      ? 'Resultado fiscal: se calcula al completar el perfil fiscal de la empresa'
                      : 'Completa el perfil fiscal del cliente para ver el desglose'}
                  </p>
                </div>
              )
            }
            const resumen = generarResumenFiscal(
              fiscalProfile as FiscalProfile,
              clientFiscal as unknown as Client,
              valor,
              0
            )
            return (
              <div className="space-y-2">
                {/* Cliente paga */}
                <div className="rounded-lg bg-blue-50 p-3 text-center">
                  <p className="text-[10px] font-medium text-blue-600">EL CLIENTE PAGA</p>
                  <p className="text-lg font-bold text-blue-700">{formatCOP(resumen.total_paga_cliente)}</p>
                  {resumen.iva > 0 && (
                    <p className="text-[10px] text-blue-500">Base {formatCOP(valor)} + IVA {formatCOP(resumen.iva)}</p>
                  )}
                </div>
                {/* Retenciones */}
                {(resumen.retefuente_valor > 0 || resumen.reteica_valor > 0 || resumen.reteiva_valor > 0) && (
                  <div className="rounded-lg bg-amber-50 p-3">
                    <p className="mb-1 text-center text-[10px] font-medium text-amber-700">RETENCIONES</p>
                    <div className="space-y-0.5 text-[10px] text-amber-600">
                      {resumen.retefuente_valor > 0 && (
                        <div className="flex justify-between"><span>ReteFuente ({resumen.retefuente_pct}%)</span><span>-{formatCOP(resumen.retefuente_valor)}</span></div>
                      )}
                      {resumen.reteica_valor > 0 && (
                        <div className="flex justify-between"><span>ReteICA ({resumen.reteica_pct}‰)</span><span>-{formatCOP(resumen.reteica_valor)}</span></div>
                      )}
                      {resumen.reteiva_valor > 0 && (
                        <div className="flex justify-between"><span>ReteIVA ({resumen.reteiva_pct}%)</span><span>-{formatCOP(resumen.reteiva_valor)}</span></div>
                      )}
                    </div>
                  </div>
                )}
                {/* Tú recibes */}
                <div className="rounded-lg bg-green-50 p-3 text-center">
                  <p className="text-[10px] font-medium text-green-600">TÚ RECIBES</p>
                  <p className="text-xl font-bold text-green-700">{formatCOP(resumen.neto_recibido)}</p>
                  <p className="text-[10px] text-green-500">Margen real neto: {resumen.margen_real_neto_pct}%</p>
                </div>
              </div>
            )
          })()}
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
                    <span className="text-xs font-medium text-blue-800">Agregar desde catálogo</span>
                    <button onClick={() => setShowCatalog(false)} className="text-xs text-blue-600 hover:underline">Cerrar</button>
                  </div>
                  {catalogItems.length === 0 ? (
                    <p className="py-3 text-center text-xs text-muted-foreground">
                      No tienes servicios en tu catálogo. Créalos en Config → Mis servicios.
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
                  Agregar desde catálogo
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
          {(() => {
            const valorVenta = cotizacion.valor_total ?? 0
            const dPct = Math.min(100, Math.max(0, Number(discountPct) || 0))
            const dVal = Math.round(valorVenta * dPct / 100)
            const valorNeto = valorVenta - dVal
            return (
              <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Costo total</span>
                  <span className="font-medium">{formatCOP(costoTotal)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Valor venta</span>
                  <span className="font-bold">{formatCOP(valorVenta)}</span>
                </div>
                {dVal > 0 && (
                  <>
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Descuento ({dPct}%)</span>
                      <span className="font-medium text-red-600">-{formatCOP(dVal)}</span>
                    </div>
                    <div className="flex justify-between text-sm border-t pt-1">
                      <span className="text-muted-foreground">Subtotal</span>
                      <span className="font-bold">{formatCOP(valorNeto)}</span>
                    </div>
                  </>
                )}
                {costoTotal > 0 && valorNeto > 0 && (
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Margen</span>
                    <span className="font-medium text-green-600">
                      {Math.round((valorNeto - costoTotal) / valorNeto * 100)}%
                    </span>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Valor venta editable */}
          {editable && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Valor de venta</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  defaultValue={cotizacion.valor_total ? cotizacion.valor_total.toLocaleString('es-CO') : ''}
                  onBlur={e => {
                    const val = Number(e.target.value.replace(/[^0-9]/g, ''))
                    if (val > 0) {
                      e.target.value = val.toLocaleString('es-CO')
                      startTransition(async () => {
                        const pct = Math.min(100, Math.max(0, Number(discountPct) || 0))
                        const dv = Math.round(val * pct / 100)
                        await updateCotizacion(cotizacion.id, { valor_total: val, descuento_porcentaje: pct, descuento_valor: dv })
                        router.refresh()
                      })
                    }
                  }}
                  className="w-full rounded-md border bg-background py-2 pl-7 pr-3 text-sm"
                />
              </div>
            </div>
          )}

          {/* Discount */}
          {editable && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">Descuento</label>
              <div className="flex items-center gap-2">
                <div className="relative w-24">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={discountPct}
                    onChange={e => {
                      const raw = e.target.value.replace(/[^0-9.]/g, '')
                      setDiscountPct(raw)
                    }}
                    onBlur={() => {
                      const pct = Math.min(100, Math.max(0, Number(discountPct) || 0))
                      const dv = Math.round((cotizacion.valor_total ?? 0) * pct / 100)
                      startTransition(async () => {
                        await updateCotizacion(cotizacion.id, { descuento_porcentaje: pct, descuento_valor: dv })
                        router.refresh()
                      })
                    }}
                    className="w-full rounded-md border bg-background py-2 pl-3 pr-7 text-sm"
                    placeholder="0"
                  />
                  <Percent className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                </div>
                {(() => {
                  const pct = Number(discountPct) || 0
                  const vv = cotizacion.valor_total ?? 0
                  return pct > 0 && vv > 0 ? (
                    <span className="text-xs text-muted-foreground">
                      = -{formatCOP(Math.round(vv * pct / 100))}
                    </span>
                  ) : null
                })()}
              </div>
            </div>
          )}
          {!editable && (cotizacion.descuento_porcentaje ?? 0) > 0 && (
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Descuento ({cotizacion.descuento_porcentaje}%)</span>
              <span className="font-medium text-red-600">-{formatCOP(cotizacion.descuento_valor ?? 0)}</span>
            </div>
          )}

          {/* Fiscal result */}
          {(() => {
            const valorBruto = cotizacion.valor_total ?? 0
            const dPct = Math.min(100, Math.max(0, Number(discountPct) || 0))
            const dVal = Math.round(valorBruto * dPct / 100)
            const valor = valorBruto - dVal
            const hasFiscal = fiscalProfile?.is_complete && clientFiscal?.agente_retenedor != null
            if (!hasFiscal || valor === 0) {
              return (
                <div className="rounded-lg bg-green-50 p-4 text-center">
                  <p className="text-xs font-medium text-green-700">TÚ RECIBES</p>
                  <p className="text-2xl font-bold text-green-700">{formatCOP(valor)}</p>
                  <p className="mt-1 text-[10px] text-green-600">
                    {!fiscalProfile?.is_complete
                      ? 'Completa tu perfil fiscal en Mi Negocio para ver el desglose'
                      : 'Completa el perfil fiscal del cliente para ver el desglose'}
                  </p>
                </div>
              )
            }
            const resumen = generarResumenFiscal(
              fiscalProfile as FiscalProfile,
              clientFiscal as unknown as Client,
              valor,
              costoTotal
            )
            return (
              <div className="space-y-2">
                <div className="rounded-lg bg-blue-50 p-3 text-center">
                  <p className="text-[10px] font-medium text-blue-600">EL CLIENTE PAGA</p>
                  <p className="text-lg font-bold text-blue-700">{formatCOP(resumen.total_paga_cliente)}</p>
                  {resumen.iva > 0 && (
                    <p className="text-[10px] text-blue-500">Base {formatCOP(valor)} + IVA {formatCOP(resumen.iva)}</p>
                  )}
                </div>
                {(resumen.retefuente_valor > 0 || resumen.reteica_valor > 0 || resumen.reteiva_valor > 0) && (
                  <div className="rounded-lg bg-amber-50 p-3">
                    <p className="mb-1 text-center text-[10px] font-medium text-amber-700">RETENCIONES</p>
                    <div className="space-y-0.5 text-[10px] text-amber-600">
                      {resumen.retefuente_valor > 0 && (
                        <div className="flex justify-between"><span>ReteFuente ({resumen.retefuente_pct}%)</span><span>-{formatCOP(resumen.retefuente_valor)}</span></div>
                      )}
                      {resumen.reteica_valor > 0 && (
                        <div className="flex justify-between"><span>ReteICA ({resumen.reteica_pct}‰)</span><span>-{formatCOP(resumen.reteica_valor)}</span></div>
                      )}
                      {resumen.reteiva_valor > 0 && (
                        <div className="flex justify-between"><span>ReteIVA ({resumen.reteiva_pct}%)</span><span>-{formatCOP(resumen.reteiva_valor)}</span></div>
                      )}
                    </div>
                  </div>
                )}
                <div className="rounded-lg bg-green-50 p-3 text-center">
                  <p className="text-[10px] font-medium text-green-600">TÚ RECIBES</p>
                  <p className="text-xl font-bold text-green-700">{formatCOP(resumen.neto_recibido)}</p>
                  <p className="text-[10px] text-green-500">Margen real neto: {resumen.margen_real_neto_pct}%</p>
                </div>
              </div>
            )
          })()}
        </div>
      )}
    </div>
  )
}
