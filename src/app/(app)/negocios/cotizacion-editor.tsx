'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  ArrowLeft, Send, Copy, Plus, Trash2, Pencil, Percent, FileDown,
  ChevronDown, ChevronRight, Lock, BookOpen, Loader2, Calculator,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  updateCotizacion, enviarCotizacion, duplicarCotizacion,
  addItem, updateItem, deleteItem,
  addRubro, updateRubro, deleteRubro, recalcularTotales,
  addItemFromServicio, aplicarAIU,
} from '@/app/(app)/negocios/cotizacion-actions'
import { getServiciosActivos } from '@/app/(app)/config/servicios-actions'
import { generateCotizacionPDF } from '@/app/(app)/negocios/cotizacion-pdf-actions'
import { ESTADO_COTIZACION_CONFIG, TIPOS_RUBRO } from '@/lib/catalogos/constants'
import { formatCOP } from '@/lib/contacts/constants'
import { margenRealDelItem, type ConvencionMargen } from '@/lib/cotizaciones/precio-item'
import { calcularCascada, type Cascada } from '@/lib/cotizaciones/totales'
import { nombreDelMargen, margenPideAviso, UMBRAL_AVISO_MARGEN_PCT } from '@/lib/cotizaciones/convencion-margen'
import { isEditable } from '@/lib/cotizaciones/state-machine'
import { generarResumenFiscal } from '@/lib/fiscal/calculos-fiscales'
import type { EstadoCotizacion } from '@/lib/catalogos/constants'
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
  precio_venta?: number | null
  descuento_porcentaje?: number | null
  descripcion?: string | null
  es_ajuste?: boolean
  cantidad?: number | null
  margen_porcentaje?: number | null
  precio_manual?: boolean | null
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
  aiu_admin_pct?: number | null
  aiu_imprevistos_pct?: number | null
  /** Margen configurado para la línea de negocio. Respalda al de la cotización. */
  margen_default_pct?: number | null
  terminos_condiciones?: string | null
  /** Que significa `margen_porcentaje` aqui. Ausente vale `markup`, como antes. */
  convencion_margen?: ConvencionMargen | null
}

interface ClientFiscal {
  person_type: string | null
  tax_regime: string | null
  gran_contribuyente: boolean
  agente_retenedor: boolean
}

interface StaffMember {
  id: string
  nombre: string
  tarifa_hora: number
}

interface Props {
  oportunidadId: string
  cotizacion: CotizacionData
  initialItems: ItemRow[]
  fiscalProfile?: FiscalProfile | null
  clientFiscal?: ClientFiscal | null
  backUrl?: string
  staffMembers?: StaffMember[]
  frozen?: boolean
  lineaId?: string | null
}

export default function CotizacionEditor({ oportunidadId, cotizacion, initialItems, fiscalProfile, clientFiscal, backUrl, staffMembers, frozen, lineaId }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const estado = cotizacion.estado as EstadoCotizacion
  const editable = isEditable(estado) && !frozen
  const estadoConfig = ESTADO_COTIZACION_CONFIG[estado]
  // Que significa el numero del campo de margen en ESTA cotizacion. Ausente vale
  // `markup`, que es como se calculo todo lo anterior a esa columna.
  const convencionMargen: ConvencionMargen = cotizacion.convencion_margen ?? 'markup'
  // Discount state
  // Terminos y condiciones al final de la cotizacion
  const [terminos, setTerminos] = useState(cotizacion.terminos_condiciones ?? '')

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
      const data = await getServiciosActivos(lineaId)
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

  // New / edit rubro
  const [addingRubroFor, setAddingRubroFor] = useState<string | null>(null)
  const [editingRubroId, setEditingRubroId] = useState<string | null>(null)
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

  // El item de ajuste no se abre nunca (no tiene detalle que mostrar), asi que no
  // cuenta para decidir si "todos" estan abiertos: si contara, el boton se quedaria
  // diciendo "Expandir todo" con todo ya abierto.
  const itemsVisibles = initialItems.filter(i => !i.es_ajuste)
  const todosExpandidos = itemsVisibles.length > 0 && itemsVisibles.every(i => expandedItems.has(i.id))
  const toggleTodos = () => {
    setExpandedItems(todosExpandidos ? new Set() : new Set(itemsVisibles.map(i => i.id)))
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
        router.push(backUrl ?? `/negocios/${oportunidadId}/cotizacion/${res.id}`)
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

  const startEditRubro = (r: RubroRow, itemId: string) => {
    setEditingRubroId(r.id)
    setAddingRubroFor(itemId)
    setNewRubro({
      tipo: r.tipo ?? 'mo_propia',
      descripcion: r.descripcion ?? '',
      cantidad: r.cantidad?.toString() ?? '1',
      unidad: r.unidad ?? 'horas',
      valor_unitario: r.valor_unitario?.toString() ?? '',
    })
  }

  const handleUpdateRubro = (rubroId: string) => {
    startTransition(async () => {
      const res = await updateRubro(rubroId, {
        tipo: newRubro.tipo,
        descripcion: newRubro.descripcion?.trim() || null,
        cantidad: Number(newRubro.cantidad),
        unidad: newRubro.unidad,
        valor_unitario: Number(newRubro.valor_unitario),
      })
      if (res.success) {
        await recalcularTotales(cotizacion.id)
        setAddingRubroFor(null)
        setEditingRubroId(null)
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

  // El margen de la cotización, con el default de la línea de negocio como respaldo:
  // una cotización recién creada todavía no tiene el suyo, y sin este respaldo el pie
  // mostraría 0% sobre un negocio que sí tiene margen configurado.
  const margenCotizacion = cotizacion.margen_porcentaje ?? Number(cotizacion.margen_default_pct) ?? 0

  // Los números de la cotización salen de la MISMA cascada que aplica el servidor al
  // guardar. Calcularlos aquí por separado fue exactamente el defecto anterior: la
  // pantalla mostraba un total y la base guardaba otro.
  const cascada = calcularCascada(
    initialItems.map(item => {
      const rubros = item.rubros ?? []
      return {
        id: item.id,
        es_ajuste: item.es_ajuste,
        cantidad: item.cantidad,
        subtotal: item.subtotal,
        numeroDeRubros: rubros.length,
        costoDeRubros: rubros.reduce((s: number, r: RubroRow) => s + (r.valor_total ?? 0), 0),
        descuento_porcentaje: item.descuento_porcentaje,
        margen_porcentaje: item.margen_porcentaje,
        precio_venta: item.precio_venta,
        precio_manual: item.precio_manual,
      }
    }),
    {
      administrativosPct: (Number(cotizacion.aiu_admin_pct) || 0) + (Number(cotizacion.aiu_imprevistos_pct) || 0),
      margenPct: margenCotizacion,
      descuentoComercialPct: cotizacion.descuento_porcentaje,
      convencionMargen,
    },
  )
  const lineaPorItem = new Map(cascada.lineas.map(l => [l.id, l]))
  const costoTotal = cascada.costoDirecto

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => backUrl ? router.push(backUrl) : router.back()}
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
          </div>
        </div>
        <div className="flex gap-1.5">
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

      {frozen && (
        <div className="flex items-center gap-2 rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800 dark:bg-blue-950/20 dark:border-blue-900/30 dark:text-blue-300">
          <Lock className="h-4 w-4 shrink-0" />
          Esta cotización está congelada porque ya hay una cotización aprobada en este negocio.
        </div>
      )}

      {!editable && !frozen && (
        <div className="flex items-center gap-2 rounded-lg bg-amber-50 p-3 text-xs text-amber-800">
          <Lock className="h-4 w-4" />
          Esta cotización está en estado <strong>{estadoConfig?.label}</strong> y no se puede editar. Puedes duplicarla.
        </div>
      )}

      {/* Items editor */}
      <div className="space-y-3">
          {/* Abrir o cerrar todos los items de una. Con una cotizacion larga, abrir
              uno por uno para ver los costos es el trabajo entero. El boton dice la
              accion que va a ejecutar, no el estado en que esta. */}
          {itemsVisibles.length > 1 && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={toggleTodos}
                className="flex items-center gap-1 rounded-md border bg-background px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent"
              >
                {todosExpandidos ? (
                  <><ChevronRight className="h-3 w-3" /> Contraer todo</>
                ) : (
                  <><ChevronDown className="h-3 w-3" /> Expandir todo</>
                )}
              </button>
            </div>
          )}
          {/* Items */}
          {initialItems.filter(i => !i.es_ajuste).map(item => {
            const itemCantidad = Number(item.cantidad) || 1
            const itemPrecio = Number(item.precio_venta) || 0
            const itemDescPct = Number(item.descuento_porcentaje) || 0
            const isAjuste = item.es_ajuste === true
            const isNegativo = itemPrecio < 0
            const tieneRubros = (item.rubros ?? []).length > 0
            const costoUnitario = (item.rubros ?? []).reduce((s: number, r: RubroRow) => s + (r.valor_total ?? 0), 0)
            // Costo del ítem que no se desglosa: vive en `subtotal`, escrito a mano.
            const costoManual = tieneRubros ? 0 : Number(item.subtotal) || 0
            const costoDelItem = tieneRubros ? costoUnitario : costoManual
            // La línea ya calculada por la cascada. Es la misma que guarda el servidor.
            const linea = lineaPorItem.get(item.id)
            const costoLinea = linea?.costoLinea ?? 0
            const precioLinea = linea?.precioLinea ?? Math.round(itemPrecio * itemCantidad)
            // El margen propio es una EXCEPCIÓN declarada, no un campo vacío: `null`
            // quiere decir "usa el de la cotización", y 0 quiere decir "esta línea va
            // a costo". Leer los dos como 0 borraría la diferencia.
            const margenPropio = item.margen_porcentaje !== null && item.margen_porcentaje !== undefined
            const itemMargen = linea?.margenAplicado ?? margenCotizacion
            const precioFijadoAMano = item.precio_manual === true || (costoLinea <= 0 && itemPrecio > 0)
            const margenRealPct = margenRealDelItem(costoLinea, precioLinea)
            // Avisa, no bloquea. Un piso duro no sube el margen: enseña a escribir el
            // número que deja pasar la pantalla, y el dato que llega después no sirve.
            const avisaMargen = margenPideAviso(margenRealPct)

            return (
            <div key={item.id} className={`rounded-lg border ${isAjuste ? 'border-amber-200 bg-amber-50/30' : ''}`}>
              <div
                className={`flex ${isAjuste ? '' : 'cursor-pointer'} items-center justify-between px-4 py-3`}
                onClick={() => !isAjuste && toggleItem(item.id)}
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {!isAjuste && (expandedItems.has(item.id) ? <ChevronDown className="h-4 w-4 shrink-0" /> : <ChevronRight className="h-4 w-4 shrink-0" />)}
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{item.nombre || 'Item sin nombre'}</span>
                      {isAjuste && (
                        <span className="inline-flex items-center rounded-full bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">Auto</span>
                      )}
                      {!isAjuste && costoDelItem === 0 && (
                        <span
                          title="Este item no tiene costo, así que no suma al costo total ni deja medir margen"
                          className="inline-flex shrink-0 items-center rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                        >
                          Sin costo
                        </span>
                      )}
                    </div>
                    {!isAjuste && (item.descripcion || costoDelItem > 0) && (
                      <span className="text-[10px] text-muted-foreground truncate block">
                        {costoDelItem > 0 && <span>Costo unit. {formatCOP(costoDelItem)}</span>}
                        {costoDelItem > 0 && item.descripcion && <span> · </span>}
                        {item.descripcion}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <div className="text-right">
                    {itemCantidad > 1 && (
                      <span className="text-[10px] text-muted-foreground mr-1">{itemCantidad} x</span>
                    )}
                    <span className={`text-xs font-medium ${isNegativo ? 'text-red-600' : ''}`}>{formatCOP(precioLinea)}</span>
                    {/* El descuento del ítem ya está dentro del costo: repetirlo aquí
                        como rebaja del precio lo contaría dos veces. */}
                    {!isAjuste && costoLinea > 0 && (
                      <span className="block text-[10px] text-muted-foreground">Costo {formatCOP(costoLinea)}</span>
                    )}
                  </div>
                  {editable && !isAjuste && (
                    <button
                      onClick={e => { e.stopPropagation(); handleDeleteItem(item.id) }}
                      className="rounded p-1 text-red-500 hover:bg-red-50"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              {!isAjuste && expandedItems.has(item.id) && (
                <div className="border-t px-4 pb-3 pt-2">
                  {/* Item sale fields */}
                  {editable && (
                    <div className="mb-3 space-y-2">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        {/* La captura de un ítem es COSTO, nada más: cuánto cuesta la
                            unidad, cuántas van, y qué descuento da el proveedor. El
                            precio no se escribe aquí, se calcula abajo con el margen.
                            Mientras costo y precio se vieron como dos casillas iguales,
                            nadie supo cuál mandaba: la cotización de la bomba quedó con
                            el precio lleno, el costo en cero y `costo_total` sin nada
                            que sumar. */}
                        <div>
                          <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">
                            {tieneRubros ? 'Costo unit. (rubros)' : 'Costo unitario'}
                          </label>
                          {tieneRubros ? (
                            <>
                              <div className="rounded border border-dashed bg-muted/40 px-2 py-1.5 text-sm tabular-nums text-muted-foreground">
                                {formatCOP(costoUnitario)}
                              </div>
                              <p className="mt-0.5 text-[10px] text-muted-foreground">
                                Suma de {(item.rubros ?? []).length} rubro{(item.rubros ?? []).length === 1 ? '' : 's'}
                              </p>
                            </>
                          ) : (
                            <>
                              <div className="relative">
                                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  placeholder="Costo"
                                  defaultValue={costoManual ? costoManual.toLocaleString('es-CO') : ''}
                                  onBlur={e => {
                                    const raw = e.target.value.replace(/[^0-9]/g, '')
                                    const val = Number(raw) || 0
                                    if (val === costoManual) return
                                    e.target.value = val ? val.toLocaleString('es-CO') : ''
                                    startTransition(async () => {
                                      const res = await updateItem(item.id, { subtotal: val })
                                      if (!res.success) { toast.error(res.error); return }
                                      await recalcularTotales(cotizacion.id)
                                      router.refresh()
                                    })
                                  }}
                                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                                  className="w-full rounded border bg-background py-1.5 pr-2 pl-7 text-sm tabular-nums"
                                />
                              </div>
                              <p className="mt-0.5 text-[10px] text-muted-foreground">Lo que le pagas al proveedor</p>
                            </>
                          )}
                        </div>

                        <div>
                          <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Cantidad</label>
                          <input
                            type="number"
                            defaultValue={itemCantidad}
                            placeholder="1"
                            min="0.01"
                            step="0.01"
                            className="w-full rounded border bg-background px-2 py-1.5 text-sm tabular-nums"
                            onBlur={e => {
                              const val = Math.max(0.01, Number(e.target.value) || 1)
                              if (val === itemCantidad) return
                              startTransition(async () => {
                                await updateItem(item.id, { cantidad: val })
                                await recalcularTotales(cotizacion.id)
                                router.refresh()
                              })
                            }}
                          />
                        </div>

                        {/* Descuento de COMPRA. Se llama así a propósito: baja el costo,
                            no el precio. El que baja el precio es el descuento comercial
                            y vive al final de la cotización. */}
                        <div>
                          <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Desc. compra %</label>
                          <input
                            type="number"
                            defaultValue={itemDescPct || ''}
                            placeholder="0"
                            min="0"
                            max="100"
                            className="w-full rounded border bg-background px-2 py-1.5 text-sm tabular-nums"
                            onBlur={e => {
                              const pct = Math.min(100, Math.max(0, Number(e.target.value) || 0))
                              if (pct === itemDescPct) return
                              startTransition(async () => {
                                await updateItem(item.id, { descuento_porcentaje: pct })
                                await recalcularTotales(cotizacion.id)
                                router.refresh()
                              })
                            }}
                          />
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Del proveedor</p>
                        </div>

                        {/* Costo de la línea: el resultado de las tres casillas de la
                            izquierda. Es lo que suma al costo total de la cotización. */}
                        <div>
                          <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Costo de la línea</label>
                          <div className="rounded border bg-muted/40 px-2 py-1.5 text-sm font-medium tabular-nums">
                            {formatCOP(costoLinea)}
                          </div>
                          <p className="mt-0.5 text-[10px] text-muted-foreground">Suma al costo total</p>
                        </div>
                      </div>

                      {/* PRECIO DE LA LÍNEA — resultado, no captura.
                          El margen lo pone la cotización completa. Una línea puede
                          marginar distinto, pero como excepción declarada y marcada: un
                          equipo que el cliente puede cotizar aparte no aguanta el mismo
                          margen que la ingeniería, y con un único porcentaje para todo se
                          sale caro donde te comparan y barato donde no. */}
                      <div className="rounded-md border bg-muted/20 px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-muted-foreground">
                            {precioFijadoAMano
                              ? 'Precio de esta línea, escrito a mano'
                              : itemMargen === 0
                                ? 'Precio de esta línea: igual al costo, todavía sin margen'
                                : `Precio de esta línea: costo + ${itemMargen}% ${margenPropio ? 'de esta línea' : 'de la cotización'}`}
                          </span>
                          <span className="text-sm font-semibold tabular-nums">{formatCOP(precioLinea)}</span>
                        </div>

                        {/* El margen real solo se enseña cuando alguien puso un margen. Un
                            "0,0% · bajo" en naranja sobre una línea recién capturada no
                            avisa de nada: regaña por no haber llegado todavía. */}
                        {margenRealPct !== null && costoLinea > 0 && (itemMargen !== 0 || precioFijadoAMano) && (
                          <p
                            className={`mt-0.5 text-[10px] tabular-nums ${avisaMargen ? 'text-amber-600' : 'text-muted-foreground'}`}
                            title={avisaMargen ? `Por debajo del ${UMBRAL_AVISO_MARGEN_PCT}% de margen. Es un aviso, no un bloqueo: la cotización se puede enviar igual.` : undefined}
                          >
                            Margen real {margenRealPct.toFixed(1)}%
                            {avisaMargen && <span className="ml-1 font-medium">· bajo</span>}
                          </p>
                        )}

                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
                          {!precioFijadoAMano && !margenPropio && (
                            <button
                              type="button"
                              disabled={isPending}
                              onClick={() => {
                                startTransition(async () => {
                                  await updateItem(item.id, { margen_porcentaje: margenCotizacion })
                                  await recalcularTotales(cotizacion.id)
                                  router.refresh()
                                })
                              }}
                              className="text-[10px] text-primary underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
                            >
                              Marginar distinto
                            </button>
                          )}

                          {!precioFijadoAMano && margenPropio && (
                            <>
                              <label className="flex items-center gap-1 text-[10px] text-muted-foreground">
                                {nombreDelMargen(convencionMargen)}
                                <input
                                  key={`margen-${item.id}-${itemMargen}`}
                                  type="number"
                                  defaultValue={itemMargen}
                                  step="0.01"
                                  className="w-16 rounded border bg-background px-1.5 py-0.5 text-[11px] tabular-nums"
                                  onBlur={e => {
                                    const pct = Number(e.target.value) || 0
                                    if (pct === itemMargen) return
                                    startTransition(async () => {
                                      await updateItem(item.id, { margen_porcentaje: pct })
                                      await recalcularTotales(cotizacion.id)
                                      router.refresh()
                                    })
                                  }}
                                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                                />
                                %
                              </label>
                              <button
                                type="button"
                                disabled={isPending}
                                onClick={() => {
                                  startTransition(async () => {
                                    // `null`, no 0: 0 es "esta línea va a costo" y es una
                                    // decisión distinta a "usa el margen de la cotización".
                                    await updateItem(item.id, { margen_porcentaje: null })
                                    await recalcularTotales(cotizacion.id)
                                    router.refresh()
                                  })
                                }}
                                className="text-[10px] text-primary underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
                              >
                                Usar el de la cotización
                              </button>
                            </>
                          )}

                          {/* Ya no hay forma de entrar a "precio a mano": para poner una
                              cifra exacta se escribe en el costo, con cantidad 1, sin
                              descuento y sin margen. Las líneas que YA quedaron fijadas
                              conservan su casilla y su salida de vuelta al cálculo. */}

                          {precioFijadoAMano && (
                            <>
                              <div className="relative">
                                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-[11px] text-muted-foreground">$</span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  placeholder="Valor unitario"
                                  defaultValue={itemPrecio ? itemPrecio.toLocaleString('es-CO') : ''}
                                  onBlur={e => {
                                    const raw = e.target.value.replace(/[^0-9]/g, '')
                                    const val = Number(raw) || 0
                                    if (val === itemPrecio) return
                                    e.target.value = val ? val.toLocaleString('es-CO') : ''
                                    startTransition(async () => {
                                      await updateItem(item.id, { precio_venta: val, precio_manual: true })
                                      await recalcularTotales(cotizacion.id)
                                      router.refresh()
                                    })
                                  }}
                                  onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
                                  className="w-32 rounded border bg-background py-0.5 pr-1.5 pl-5 text-[11px] tabular-nums"
                                />
                              </div>
                              {/* Sin costo contra el cual recalcular, "volver al cálculo"
                                  dejaría el precio en cero y la línea parecería borrada. */}
                              {costoLinea > 0 && (
                                <button
                                  type="button"
                                  disabled={isPending}
                                  onClick={() => {
                                    startTransition(async () => {
                                      await updateItem(item.id, { precio_manual: false })
                                      await recalcularTotales(cotizacion.id)
                                      router.refresh()
                                    })
                                  }}
                                  className="text-[10px] text-primary underline underline-offset-2 hover:opacity-80 disabled:opacity-50"
                                >
                                  Volver a calcularlo desde el costo
                                </button>
                              )}
                            </>
                          )}
                        </div>
                      </div>

                      <div>
                        <label className="mb-0.5 block text-[10px] font-medium text-muted-foreground">Descripción (visible al cliente)</label>
                        <input
                          defaultValue={item.descripcion ?? ''}
                          placeholder="Describe qué incluye este item..."
                          className="w-full rounded border bg-background px-2 py-1.5 text-xs"
                          onBlur={e => {
                            startTransition(async () => {
                              await updateItem(item.id, { descripcion: e.target.value })
                            })
                          }}
                        />
                      </div>
                    </div>
                  )}
                  {/* Rubros table (internal costs) */}
                  {(item.rubros ?? []).length > 0 && (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="pb-1 pr-2">Tipo</th>
                            <th className="pb-1 pr-2">Descripción</th>
                            <th className="pb-1 pr-2">Cant.</th>
                            <th className="pb-1 pr-2">Unit.</th>
                            <th className="pb-1 pr-2 text-right">Vr. Unit.</th>
                            <th className="pb-1 text-right">Total</th>
                            {editable && <th className="pb-1 w-12" />}
                          </tr>
                        </thead>
                        <tbody>
                          {(item.rubros ?? []).map((r: RubroRow) => (
                            <tr key={r.id} className="border-b border-dashed">
                              <td className="py-1.5 pr-2">
                                {TIPOS_RUBRO.find(t => t.value === r.tipo)?.label ?? r.tipo}
                              </td>
                              <td className="py-1.5 pr-2 text-muted-foreground max-w-[120px] truncate">
                                {r.descripcion || '—'}
                              </td>
                              <td className="py-1.5 pr-2">{r.cantidad}</td>
                              <td className="py-1.5 pr-2">{r.unidad}</td>
                              <td className="py-1.5 pr-2 text-right">{formatCOP(r.valor_unitario ?? 0)}</td>
                              <td className="py-1.5 text-right font-medium">{formatCOP(r.valor_total ?? 0)}</td>
                              {editable && (
                                <td className="py-1.5">
                                  <div className="flex gap-0.5">
                                    <button
                                      onClick={() => startEditRubro(r, item.id)}
                                      className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                                    >
                                      <Pencil className="h-3 w-3" />
                                    </button>
                                    <button
                                      onClick={() => handleDeleteRubro(r.id)}
                                      className="rounded p-0.5 text-red-500 hover:bg-red-50"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </div>
                                </td>
                              )}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}

                  {/* Add / Edit rubro */}
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
                          placeholder="Descripción"
                          value={newRubro.descripcion}
                          onChange={e => {
                            const val = e.target.value
                            setNewRubro(p => {
                              const next = { ...p, descripcion: val }
                              // Auto-fill tarifa when selecting staff from datalist
                              if ((p.tipo === 'mo_propia' || p.tipo === 'mo_terceros') && staffMembers?.length) {
                                const match = staffMembers.find(s => s.nombre === val)
                                if (match && match.tarifa_hora > 0) {
                                  next.valor_unitario = Math.round(match.tarifa_hora).toString()
                                }
                              }
                              return next
                            })
                          }}
                          className="rounded border bg-background px-2 py-1.5 text-xs"
                          list={(newRubro.tipo === 'mo_propia' || newRubro.tipo === 'mo_terceros') && staffMembers?.length ? 'staff-list' : undefined}
                        />
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
                        <CalcInput
                          placeholder="Valor unitario"
                          value={newRubro.valor_unitario}
                          onChange={v => setNewRubro(p => ({ ...p, valor_unitario: v }))}
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => { setAddingRubroFor(null); setEditingRubroId(null); setNewRubro({ tipo: 'mo_propia', descripcion: '', cantidad: '1', unidad: 'horas', valor_unitario: '' }) }}
                          className="rounded border px-2 py-1 text-xs hover:bg-accent"
                        >
                          Cancelar
                        </button>
                        {editingRubroId ? (
                          <button
                            onClick={() => handleUpdateRubro(editingRubroId)}
                            disabled={isPending || !Number(newRubro.valor_unitario)}
                            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
                          >
                            Guardar cambios
                          </button>
                        ) : (
                          <button
                            onClick={() => handleAddRubro(item.id)}
                            disabled={isPending || !Number(newRubro.valor_unitario)}
                            className="rounded bg-primary px-2 py-1 text-xs text-primary-foreground disabled:opacity-50"
                          >
                            Agregar rubro
                          </button>
                        )}
                      </div>
                    </div>
                  ) : editable ? (
                    <button
                      onClick={() => {
                        // Desglosar anula el costo escrito a mano: con rubros, el costo lo
                        // mandan ellos. Avisarlo antes es lo unico que evita que el costo
                        // de la factura del proveedor desaparezca sin que nadie lo note.
                        if (!tieneRubros && costoManual > 0 &&
                            !window.confirm('Este item pasa a costearse por rubros. El costo que escribiste deja de aplicar. ¿Sigues?')) {
                          return
                        }
                        setEditingRubroId(null)
                        setAddingRubroFor(item.id)
                      }}
                      className="mt-2 inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <Plus className="h-3 w-3" />
                      Agregar rubro
                    </button>
                  ) : null}
                </div>
              )}
            </div>
          )})}

          {/* Add item actions */}
          {editable && (
            <div className="space-y-2">
              {/* Single row: input + add button + catalog button */}
              <div className="relative flex gap-2">
                <input
                  value={newItemName}
                  onChange={e => setNewItemName(e.target.value)}
                  placeholder="Nombre del item..."
                  className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
                  onKeyDown={e => e.key === 'Enter' && handleAddItem()}
                />
                <button
                  onClick={handleAddItem}
                  disabled={isPending || !newItemName.trim()}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Item
                </button>
                <button
                  onClick={loadCatalog}
                  disabled={catalogLoading}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-blue-300 px-3 py-2 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 disabled:opacity-50"
                >
                  {catalogLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BookOpen className="h-3.5 w-3.5" />}
                  Desde catálogo
                </button>

                {/* Catalog dropdown */}
                {showCatalog && (
                  <div className="absolute right-0 top-full z-10 mt-1 w-80 rounded-lg border border-blue-200 bg-background shadow-lg p-3 space-y-2">
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
                )}
              </div>
            </div>
          )}

          {/* La cascada de la cotización: costo, administrativos, margen, descuento. */}
          <TotalesMargen
            cascada={cascada}
            margenPct={margenCotizacion}
            convencionMargen={convencionMargen}
            descuentoPct={Number(cotizacion.descuento_porcentaje) || 0}
            editable={editable}
            aiuAdminPct={cotizacion.aiu_admin_pct ?? null}
            aiuImprevPct={cotizacion.aiu_imprevistos_pct ?? null}
            onMargenChange={pct => {
              startTransition(async () => {
                await updateCotizacion(cotizacion.id, { margen_porcentaje: pct })
                await recalcularTotales(cotizacion.id)
                router.refresh()
              })
            }}
            onAIUChange={(adminPct, imprevPct) => {
              startTransition(async () => {
                await aplicarAIU(cotizacion.id, adminPct, imprevPct)
                router.refresh()
              })
            }}
            onDescuentoChange={pct => {
              startTransition(async () => {
                await updateCotizacion(cotizacion.id, { descuento_porcentaje: pct })
                await recalcularTotales(cotizacion.id)
                router.refresh()
              })
            }}
          />

          {/* Terminos y condiciones (van al final de la cotizacion) */}
          {(editable || terminos.trim()) && (
            <div>
              <label className="mb-1 block text-xs font-medium text-muted-foreground">
                Términos y condiciones
              </label>
              {editable ? (
                <textarea
                  value={terminos}
                  onChange={e => setTerminos(e.target.value)}
                  onBlur={() => {
                    const valor = terminos.trim()
                    if (valor === (cotizacion.terminos_condiciones ?? '')) return
                    startTransition(async () => {
                      const res = await updateCotizacion(cotizacion.id, {
                        terminos_condiciones: valor || null,
                      })
                      if (!res.success) toast.error(res.error)
                      router.refresh()
                    })
                  }}
                  rows={5}
                  placeholder="Validez de la oferta, garantía, alcance, condiciones de entrega…"
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm leading-relaxed"
                />
              ) : (
                <p className="whitespace-pre-wrap rounded-md border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                  {terminos}
                </p>
              )}
            </div>
          )}

          {/* Fiscal result */}
          {(() => {
            // `precioVenta` ya trae el descuento comercial aplicado: restarlo otra vez
            // aquí le bajaba el neto al vendedor sin que nada lo explicara.
            const valor = cascada.precioVenta
            const hasFiscal = fiscalProfile?.is_complete && clientFiscal?.agente_retenedor != null
            if (!hasFiscal || valor === 0) {
              return (
                <div className="rounded-lg bg-green-50 p-4 text-center">
                  <p className="text-xs font-medium text-green-700">TÚ RECIBES</p>
                  <p className="text-2xl font-bold text-green-700">{formatCOP(valor)}</p>
                  <p className="mt-1 text-[10px] text-green-600">
                    {!fiscalProfile?.is_complete
                      ? 'Completa tu perfil fiscal en Configuración para ver el desglose'
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

      {/* Staff datalist for mano de obra rubros */}
      {staffMembers && staffMembers.length > 0 && (
        <datalist id="staff-list">
          {staffMembers.map(s => (
            <option key={s.id} value={s.nombre} />
          ))}
        </datalist>
      )}
    </div>
  )
}

// ── Totales + Margen bidireccional ─────────────────────────────

/** Un renglón de la cascada: qué es, cuánto vale y de dónde sale. */
function Renglon({ etiqueta, valor, nota, fuerte, tono }: {
  etiqueta: string
  valor: number
  nota?: string
  fuerte?: boolean
  tono?: 'rojo' | 'verde'
}) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-sm">
      <span className="text-muted-foreground">
        {etiqueta}
        {nota && <span className="ml-1 text-[10px]">{nota}</span>}
      </span>
      <span className={`tabular-nums ${fuerte ? 'font-bold' : 'font-medium'} ${tono === 'rojo' ? 'text-red-600' : tono === 'verde' ? 'text-green-600' : ''}`}>
        {tono === 'rojo' ? '-' : ''}{formatCOP(valor)}
      </span>
    </div>
  )
}

/**
 * El pie de la cotización: la cascada completa, de lo que cuesta a lo que se cobra.
 *
 * Se lee de arriba abajo y cada renglón dice de dónde sale el siguiente. Antes aquí se
 * escribía el valor de venta y el sistema inventaba un ítem de cuadre para que la suma
 * diera: el cliente veía una línea "Administración e imprevistos" que nadie había
 * cotizado, y el margen no se podía leer en ninguna parte.
 */
function TotalesMargen({ cascada, margenPct, convencionMargen, descuentoPct, editable, aiuAdminPct, aiuImprevPct, onMargenChange, onAIUChange, onDescuentoChange }: {
  cascada: Cascada
  margenPct: number
  convencionMargen: ConvencionMargen
  descuentoPct: number
  editable: boolean
  aiuAdminPct: number | null
  aiuImprevPct: number | null
  onMargenChange: (pct: number) => void
  onAIUChange: (adminPct: number | null, imprevPct: number | null) => void
  onDescuentoChange: (pct: number) => void
}) {
  const [adminPct, setAdminPct] = useState(aiuAdminPct ?? 0)
  const [imprevPct, setImprevPct] = useState(aiuImprevPct ?? 0)
  const hayAdministrativos = (aiuAdminPct ?? 0) > 0 || (aiuImprevPct ?? 0) > 0
  const [showAIU, setShowAIU] = useState(hayAdministrativos)

  return (
    <div className="rounded-lg bg-muted/50 p-4 space-y-2">
      <Renglon etiqueta="Costo directo" valor={cascada.costoDirecto} nota="suma de los ítems" />

      {/* ADMINISTRATIVOS — lo que cuesta operar el contrato, sobre el costo directo. */}
      {editable && showAIU && (
        <div className="border-t pt-2">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">Administrativos (sobre el costo)</span>
            <button
              onClick={() => {
                setAdminPct(0)
                setImprevPct(0)
                setShowAIU(false)
                onAIUChange(null, null)
              }}
              className="text-[10px] text-muted-foreground hover:text-red-500"
            >
              Quitar
            </button>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="mb-0.5 block text-[10px] text-muted-foreground">Administración %</label>
              <div className="relative">
                <input
                  type="number"
                  value={adminPct || ''}
                  placeholder="0"
                  min="0"
                  max="100"
                  step="0.1"
                  className="w-full rounded border bg-background px-2 py-1.5 pr-6 text-xs tabular-nums"
                  onChange={e => setAdminPct(Number(e.target.value) || 0)}
                  onBlur={() => onAIUChange(adminPct || null, imprevPct || null)}
                />
                <Percent className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              </div>
            </div>
            <div>
              <label className="mb-0.5 block text-[10px] text-muted-foreground">Imprevistos %</label>
              <div className="relative">
                <input
                  type="number"
                  value={imprevPct || ''}
                  placeholder="0"
                  min="0"
                  max="100"
                  step="0.1"
                  className="w-full rounded border bg-background px-2 py-1.5 pr-6 text-xs tabular-nums"
                  onChange={e => setImprevPct(Number(e.target.value) || 0)}
                  onBlur={() => onAIUChange(adminPct || null, imprevPct || null)}
                />
                <Percent className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
              </div>
            </div>
          </div>
        </div>
      )}
      {editable && !showAIU && (
        <button
          onClick={() => setShowAIU(true)}
          className="text-[11px] text-muted-foreground hover:text-amber-600 hover:underline"
        >
          + Administración e imprevistos
        </button>
      )}
      {cascada.administrativos > 0 && (
        <Renglon
          etiqueta="Administrativos"
          valor={cascada.administrativos}
          nota={`${(aiuAdminPct ?? 0) + (aiuImprevPct ?? 0)}% sobre el costo`}
        />
      )}

      <div className="border-t pt-2">
        <Renglon etiqueta="Costo de venta" valor={cascada.costoDeVenta} nota="lo que hay que poner" fuerte />
      </div>

      {/* MARGEN — el de la cotización completa. Las líneas que traen el suyo lo dicen
          en su propia fila, así que el número de aquí no las alcanza. */}
      {editable && (
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <label className="text-xs font-medium text-muted-foreground">{nombreDelMargen(convencionMargen)} de la cotización</label>
          <div className="relative w-24">
            <input
              key={`margen-cot-${margenPct}`}
              type="number"
              defaultValue={margenPct || ''}
              placeholder="0"
              step="0.01"
              className="w-full rounded border bg-background py-1.5 pl-2 pr-6 text-sm tabular-nums"
              onBlur={e => {
                const pct = Number(e.target.value) || 0
                if (pct === margenPct) return
                onMargenChange(pct)
              }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            />
            <Percent className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          </div>
        </div>
      )}
      <Renglon etiqueta="Venta bruta" valor={cascada.ventaBruta} />

      {/* DESCUENTO COMERCIAL — el único que ve el cliente. El de cada ítem es de
          compra y ya está adentro del costo. */}
      {editable && (
        <div className="flex items-center justify-between gap-2 border-t pt-2">
          <label className="text-xs font-medium text-muted-foreground">Descuento comercial</label>
          <div className="relative w-24">
            <input
              key={`desc-cot-${descuentoPct}`}
              type="number"
              defaultValue={descuentoPct || ''}
              placeholder="0"
              min="0"
              max="100"
              step="0.01"
              className="w-full rounded border bg-background py-1.5 pl-2 pr-6 text-sm tabular-nums"
              onBlur={e => {
                const pct = Math.min(100, Math.max(0, Number(e.target.value) || 0))
                if (pct === descuentoPct) return
                onDescuentoChange(pct)
              }}
              onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
            />
            <Percent className="absolute right-1.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          </div>
        </div>
      )}
      {cascada.descuentoComercial > 0 && (
        <Renglon etiqueta="Descuento comercial" valor={cascada.descuentoComercial} nota={`${descuentoPct}%`} tono="rojo" />
      )}

      <div className="border-t pt-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-medium">Precio de venta</span>
          <span className="text-base font-bold tabular-nums">{formatCOP(cascada.precioVenta)}</span>
        </div>
        {cascada.margenRealPct !== null && cascada.costoDeVenta > 0 && (
          <p className={`mt-0.5 text-right text-[11px] tabular-nums ${margenPideAviso(cascada.margenRealPct) ? 'text-amber-600' : 'text-green-600'}`}>
            Margen real {cascada.margenRealPct.toFixed(1)}%
            {margenPideAviso(cascada.margenRealPct) && <span className="ml-1 font-medium">· bajo</span>}
          </p>
        )}
      </div>
    </div>
  )
}

// ── Mini calculadora inline ────────────────────────────────────

function CalcInput({ placeholder, value, onChange, onApply, prefix, formatted }: {
  placeholder: string
  value: string
  onChange: (v: string) => void
  onApply?: (v: string) => void
  prefix?: string
  formatted?: boolean
}) {
  const [showCalc, setShowCalc] = useState(false)
  const [expr, setExpr] = useState('')

  const evalExpr = (input: string): number | null => {
    try {
      const sanitized = input.replace(/[^0-9+\-*/.() ]/g, '')
      if (!sanitized.trim()) return null
      const result = Function(`"use strict"; return (${sanitized})`)()
      if (typeof result === 'number' && isFinite(result)) return Math.round(result)
      return null
    } catch {
      return null
    }
  }

  const handleApply = () => {
    const result = evalExpr(expr)
    if (result !== null && result > 0) {
      const str = result.toString()
      onChange(str)
      if (onApply) onApply(str)
      setShowCalc(false)
      setExpr('')
    }
  }

  const handleCommit = () => {
    if (onApply && value) onApply(value)
  }

  const preview = evalExpr(expr)
  const numVal = Number(value)
  const displayValue = formatted && value && !isNaN(numVal) ? numVal.toLocaleString('es-CO') : value

  return (
    <div className="relative">
      <div className="flex gap-1">
        <div className="relative flex-1 min-w-0">
          {prefix && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{prefix}</span>}
          <input
            type={formatted ? 'text' : 'number'}
            inputMode="numeric"
            placeholder={placeholder}
            value={displayValue}
            onChange={e => {
              const raw = formatted ? e.target.value.replace(/[^0-9]/g, '') : e.target.value
              onChange(raw)
            }}
            onBlur={handleCommit}
            onKeyDown={e => e.key === 'Enter' && handleCommit()}
            className={`w-full rounded border bg-background py-1.5 pr-2 text-${formatted ? 'sm' : 'xs'} min-w-0 ${prefix ? 'pl-7' : 'px-2'}`}
          />
        </div>
        <button
          type="button"
          onClick={() => setShowCalc(!showCalc)}
          className={`shrink-0 rounded border px-1.5 py-1.5 transition-colors ${showCalc ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent'}`}
        >
          <Calculator className="h-3 w-3" />
        </button>
      </div>
      {showCalc && (
        <div className="absolute right-0 top-full z-20 mt-1 w-56 rounded-lg border bg-popover p-2 shadow-lg">
          <input
            type="text"
            value={expr}
            onChange={e => setExpr(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleApply()}
            placeholder="ej: 150000 * 3"
            autoFocus
            className="w-full rounded border bg-background px-2 py-1.5 text-xs font-mono"
          />
          {preview !== null && (
            <p className="mt-1 text-right text-xs font-mono text-green-600">
              = {preview.toLocaleString('es-CO')}
            </p>
          )}
          <div className="mt-1.5 flex justify-end gap-1">
            <button
              type="button"
              onClick={() => { setShowCalc(false); setExpr('') }}
              className="rounded px-2 py-1 text-[10px] hover:bg-accent"
            >
              Cerrar
            </button>
            <button
              type="button"
              onClick={handleApply}
              disabled={preview === null || preview <= 0}
              className="rounded bg-primary px-2 py-1 text-[10px] text-primary-foreground disabled:opacity-50"
            >
              Usar
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
