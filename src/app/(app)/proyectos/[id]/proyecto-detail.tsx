'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, FolderOpen, Clock, Receipt, Banknote, Pause, Play,
  Lock, Plus, TrendingUp, TrendingDown, FileText, AlertTriangle,
  ChevronDown, RefreshCw, ArrowUpCircle, User, Smartphone, Upload, Loader2,
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { updateAvance, cambiarEstadoProyecto } from '../actions-v2'
import { formatCOP } from '@/lib/contacts/constants'
import { ESTADO_PROYECTO_CONFIG } from '@/lib/pipeline/constants'
import type { EstadoProyecto } from '@/lib/pipeline/constants'
import ProyectoAlertas from './proyecto-alertas'
import ActivityLog from '@/components/activity-log'
import CustomFieldsSection from '@/components/custom-fields-section'

// Category display config (same as movimientos)
const CATEGORIA_CONFIG: Record<string, { label: string; color: string }> = {
  materiales: { label: 'Materiales', color: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' },
  transporte: { label: 'Transporte', color: 'bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400' },
  alimentacion: { label: 'Alimentación', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
  servicios_profesionales: { label: 'Servicios prof.', color: 'bg-violet-100 text-violet-700 dark:bg-violet-900/30 dark:text-violet-400' },
  software: { label: 'Software', color: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400' },
  arriendo: { label: 'Arriendo', color: 'bg-stone-100 text-stone-700 dark:bg-stone-800/50 dark:text-stone-400' },
  marketing: { label: 'Marketing', color: 'bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400' },
  capacitacion: { label: 'Capacitación', color: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400' },
  mano_de_obra: { label: 'Mano de obra', color: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
  otros: { label: 'Otros', color: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400' },
}
import HorasDialog from './horas-dialog'
import FacturaDialog from './factura-dialog'
import CobroDialog from './cobro-dialog'
import CierreDialog from './cierre-dialog'

// ── Types ─────────────────────────────────────────────

interface Financiero {
  proyecto_id: string | null
  codigo: string | null
  nombre: string | null
  estado: string | null
  tipo: string | null
  presupuesto_total: number | null
  avance_porcentaje: number | null
  presupuesto_consumido_pct: number | null
  costo_acumulado: number | null
  costo_horas: number | null
  gastos_directos: number | null
  facturado: number | null
  cobrado: number | null
  ganancia_actual: number | null
  ganancia_estimada: number | null
  horas_estimadas: number | null
  horas_reales: number | null
  empresa_nombre: string | null
  contacto_nombre: string | null
  carpeta_url: string | null
  oportunidad_id: string | null
}

interface Rubro {
  rubro_id: string | null
  rubro_nombre: string | null
  rubro_tipo: string | null
  presupuestado: number | null
  gastado_real: number | null
  diferencia: number | null
  consumido_pct: number | null
}

interface Factura {
  factura_id: string | null
  numero_factura: string | null
  monto: number | null
  cobrado: number | null
  saldo_pendiente: number | null
  estado_pago: string | null
  dias_antiguedad: number | null
  fecha_emision: string | null
}

interface TimelineEntry {
  id: string
  tipo: 'horas' | 'gasto' | 'cobro'
  fecha: string
  descripcion: string
  valor: number
}

interface RubroLista {
  id: string
  nombre: string
  tipo: string | null
  presupuestado: number | null
}

interface StaffOption {
  id: string
  full_name: string
  tipo_vinculo: string | null
  es_principal: boolean | null
}

interface GastoEntry {
  id: string
  fecha: string
  monto: number
  descripcion: string
  categoria: string | null
  tipo: string | null
  estado_pago: string | null
  estado_causacion: string
  soporte_url: string | null
  deducible: boolean
  canal_registro: string | null
  created_by_name: string | null
}

interface HoraEntry {
  id: string
  fecha: string
  horas: number
  descripcion: string
  staff_name: string | null
  costo: number
}

interface Props {
  financiero: Financiero
  rubros: Rubro[]
  facturas: Factura[]
  timeline: TimelineEntry[]
  gastosAll: GastoEntry[]
  horasAll: HoraEntry[]
  rubrosLista: RubroLista[]
  staffList: StaffOption[]
  cotizacionId?: string | null
  oportunidadId?: string | null
  responsable?: { id: string; full_name: string } | null
  responsableComercial?: { id: string; full_name: string } | null
  customData?: Record<string, unknown>
}

// ── Component ─────────────────────────────────────────

export default function ProyectoDetail({
  financiero: f,
  rubros,
  facturas,
  timeline,
  gastosAll,
  horasAll,
  rubrosLista,
  staffList,
  cotizacionId,
  oportunidadId,
  responsable,
  responsableComercial,
  customData,
}: Props) {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [isPending, startTransition] = useTransition()
  const [avance, setAvance] = useState(f.avance_porcentaje ?? 0)
  const [dialog, setDialog] = useState<'horas' | 'factura' | 'cobro' | 'cierre' | null>(null)
  const [showRubros, setShowRubros] = useState(false)
  const [registrosTab, setRegistrosTab] = useState<'gastos' | 'horas' | 'facturas'>('gastos')
  const [soporteModal, setSoporteModal] = useState<{ url: string; descripcion: string } | null>(null)

  // Auto-open dialog from URL param (e.g. ?action=gasto)
  useEffect(() => {
    const action = searchParams.get('action')
    if (action && ['gasto', 'horas', 'factura', 'cobro', 'cierre'].includes(action)) {
      setDialog(action as typeof dialog)
      // Clean up URL param
      const url = new URL(window.location.href)
      url.searchParams.delete('action')
      window.history.replaceState({}, '', url.toString())
    }
  }, [searchParams])

  const estado = (f.estado ?? 'en_ejecucion') as EstadoProyecto
  const config = ESTADO_PROYECTO_CONFIG[estado]
  const isCerrado = estado === 'cerrado'
  const isPausado = estado === 'pausado'
  const isInterno = f.tipo === 'interno'
  const proyectoId = f.proyecto_id ?? ''

  const consumo = Math.min(f.presupuesto_consumido_pct ?? 0, 150)
  const semaforoBar = consumo > 90 ? 'bg-red-500' : consumo > 70 ? 'bg-yellow-500' : 'bg-green-500'
  const ganancia = f.ganancia_actual ?? 0

  const handleAvanceChange = (newVal: number) => {
    setAvance(newVal)
    startTransition(async () => {
      const res = await updateAvance(proyectoId, newVal)
      if (!res.success) toast.error(res.error)
    })
  }

  const handleEstado = (nuevoEstado: 'pausado' | 'en_ejecucion') => {
    startTransition(async () => {
      const res = await cambiarEstadoProyecto(proyectoId, nuevoEstado)
      if (res.success) {
        toast.success(nuevoEstado === 'pausado' ? 'Proyecto pausado' : 'Proyecto reanudado')
        router.refresh()
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      {/* ─── Header ─── */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <h1 className="truncate text-lg font-bold">
            {f.codigo && <span className="text-muted-foreground font-medium">P {f.codigo} </span>}
            {f.nombre ?? 'Sin nombre'}
          </h1>
          <div className="flex items-center gap-2">
            {config && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${config.chipClass}`}>
                {config.label}
              </span>
            )}
            {isInterno && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                Interno
              </span>
            )}
            {!isInterno && f.empresa_nombre && (
              <span className="text-xs text-muted-foreground">{f.empresa_nombre}</span>
            )}
            {responsable && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <User className="h-3 w-3" />
                {responsable.full_name}
              </span>
            )}
            {responsableComercial && (
              <span className="text-[11px] text-muted-foreground">
                Vendio: {responsableComercial.full_name}
              </span>
            )}
          </div>
        </div>
        {f.carpeta_url && (
          <a
            href={f.carpeta_url}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Abrir carpeta"
          >
            <FolderOpen className="h-5 w-5" />
          </a>
        )}
      </div>

      {/* ─── Quick register bar (top) ─── */}
      {!isCerrado && !isPausado && (
        <div className="flex items-center gap-2">
          <Link
            href={`/nuevo/gasto?proyecto=${proyectoId}`}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-orange-50 border border-orange-200 py-2.5 text-xs font-medium text-orange-700 hover:bg-orange-100 dark:bg-orange-950/30 dark:border-orange-900 dark:text-orange-400 dark:hover:bg-orange-950/50"
          >
            <Receipt className="h-4 w-4" />
            Gasto
          </Link>
          <button
            onClick={() => setDialog('horas')}
            disabled={isPending}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-50 border border-blue-200 py-2.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:bg-blue-950/30 dark:border-blue-900 dark:text-blue-400 dark:hover:bg-blue-950/50"
          >
            <Clock className="h-4 w-4" />
            Horas
          </button>
          {!isInterno && (
            <button
              onClick={() => setDialog('factura')}
              disabled={isPending}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-green-50 border border-green-200 py-2.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-50 dark:bg-green-950/30 dark:border-green-900 dark:text-green-400 dark:hover:bg-green-950/50"
            >
              <FileText className="h-4 w-4" />
              Factura
            </button>
          )}
        </div>
      )}

      {/* D131: Link to approved cotización */}
      {cotizacionId && oportunidadId && (
        <Link
          href={`/pipeline/${oportunidadId}/cotizacion/${cotizacionId}`}
          className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm transition-colors hover:bg-blue-100 dark:border-blue-900 dark:bg-blue-950/30 dark:hover:bg-blue-950/50"
        >
          <FileText className="h-4 w-4 text-blue-500 shrink-0" />
          <span className="text-blue-700 dark:text-blue-300 font-medium">Ver cotizacion aprobada →</span>
        </Link>
      )}

      {/* ─── Alertas ─── */}
      <ProyectoAlertas financiero={f} facturas={facturas} />

      {/* ─── Barras duales ─── */}
      <div className="space-y-3 rounded-lg border p-4">
        {/* Avance slider (editable only if not cerrado) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium">Avance del proyecto</span>
            <span className="text-xs font-semibold">{avance}%</span>
          </div>
          {!isCerrado ? (
            <input
              type="range"
              min={0}
              max={100}
              step={5}
              value={avance}
              onChange={e => handleAvanceChange(Number(e.target.value))}
              className="w-full h-2 rounded-full appearance-none bg-muted accent-blue-500"
            />
          ) : (
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className="h-full rounded-full bg-blue-500" style={{ width: `${avance}%` }} />
            </div>
          )}
        </div>

        {/* Costos ejecutados (expandible) */}
        <div>
          <button
            onClick={() => setShowRubros(!showRubros)}
            className="flex w-full items-center justify-between mb-1 group"
          >
            <span className="text-xs font-medium flex items-center gap-1">
              Costos ejecutados
              <ChevronDown className={`h-3 w-3 text-muted-foreground transition-transform ${showRubros ? 'rotate-180' : ''}`} />
            </span>
            <span className="text-xs font-semibold tabular-nums">{formatCOP(f.costo_acumulado ?? 0)}</span>
          </button>
          {(f.presupuesto_total ?? 0) > 0 && (
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div className={`h-full rounded-full ${semaforoBar}`} style={{ width: `${Math.min(consumo, 100)}%` }} />
            </div>
          )}

          {showRubros && (
            <div className="mt-3 space-y-3 border-t pt-3">
              {(() => {
                // Agrupar gastos por categoria
                const catTotals = new Map<string, number>()
                for (const g of gastosAll) {
                  const cat = g.categoria || 'otros'
                  catTotals.set(cat, (catTotals.get(cat) ?? 0) + g.monto)
                }

                // Inyectar costo de horas como mano_de_obra (calculado por staff)
                const totalHoras = horasAll.reduce((s, h) => s + h.horas, 0)
                const costoHoras = horasAll.reduce((s, h) => s + h.costo, 0)
                if (costoHoras > 0 || totalHoras > 0) {
                  catTotals.set('mano_de_obra', (catTotals.get('mano_de_obra') ?? 0) + costoHoras)
                }

                // Mapear rubros a categorias para presupuesto
                const RUBRO_TIPO_TO_CAT: Record<string, string> = {
                  materiales: 'materiales',
                  viaticos: 'transporte',
                  software: 'software',
                  servicios_prof: 'servicios_profesionales',
                  mo_propia: 'mano_de_obra',
                  mo_terceros: 'mano_de_obra',
                }
                const catPresupuesto = new Map<string, number>()
                for (const r of rubros) {
                  const cat = r.rubro_tipo ? RUBRO_TIPO_TO_CAT[r.rubro_tipo] : null
                  if (cat) {
                    catPresupuesto.set(cat, (catPresupuesto.get(cat) ?? 0) + (r.presupuestado ?? 0))
                  }
                }

                // Unir: todas las categorias que tengan gastos O presupuesto
                const allCats = new Set([...catTotals.keys(), ...catPresupuesto.keys()])
                const rows = Array.from(allCats).map(cat => ({
                  cat,
                  gastado: catTotals.get(cat) ?? 0,
                  presupuesto: catPresupuesto.get(cat) ?? 0,
                })).sort((a, b) => b.gastado - a.gastado)

                const totalEjecutado = rows.reduce((s, r) => s + r.gastado, 0)
                const totalPresupuesto = catPresupuesto.size > 0
                  ? rows.reduce((s, r) => s + r.presupuesto, 0)
                  : 0

                if (rows.length === 0) {
                  return <p className="text-xs text-muted-foreground">Sin costos registrados</p>
                }

                return (
                  <>
                    {/* Resumen ejecutivo */}
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground pb-1">
                      <span>Ejecutado: <span className="font-semibold text-foreground">{formatCOP(totalEjecutado)}</span></span>
                      {totalPresupuesto > 0 && (
                        <span>Presupuesto: <span className="font-semibold text-foreground">{formatCOP(totalPresupuesto)}</span></span>
                      )}
                    </div>

                    {/* Barras por categoría */}
                    {rows.map(r => {
                      const cfg = CATEGORIA_CONFIG[r.cat]
                      const label = cfg?.label ?? r.cat.replace(/_/g, ' ')
                      const hasBudget = r.presupuesto > 0
                      const pct = hasBudget ? Math.round((r.gastado / r.presupuesto) * 100) : 0
                      const barWidth = hasBudget
                        ? Math.min(pct, 100)
                        : (totalEjecutado > 0 ? Math.round((r.gastado / totalEjecutado) * 100) : 0)
                      const barColor = !hasBudget
                        ? 'bg-slate-400'
                        : pct > 100 ? 'bg-red-500' : pct > 90 ? 'bg-red-400' : pct > 70 ? 'bg-yellow-500' : 'bg-blue-500'
                      const saldo = r.presupuesto - r.gastado
                      const isLabor = r.cat === 'mano_de_obra'

                      return (
                        <div key={r.cat}>
                          <div className="flex items-center justify-between text-xs">
                            <span className="truncate font-medium">{label}{isLabor && totalHoras > 0 && <span className="text-muted-foreground font-normal ml-1">({totalHoras}h)</span>}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">
                              {formatCOP(r.gastado)}{hasBudget && <span className="text-[10px]"> / {formatCOP(r.presupuesto)} <span className={pct > 100 ? 'text-red-500 font-semibold' : ''}>{pct}%</span></span>}
                            </span>
                          </div>
                          <div className="relative mt-0.5 h-1.5 rounded-full bg-muted overflow-hidden">
                            <div className={`h-full rounded-full transition-all ${barColor}`} style={{ width: `${Math.max(barWidth, r.gastado > 0 ? 2 : 0)}%` }} />
                          </div>
                          {hasBudget && saldo < 0 && (
                            <p className="mt-0.5 text-[10px] text-red-500 font-medium">Excedido {formatCOP(Math.abs(saldo))}</p>
                          )}
                          {hasBudget && saldo > 0 && (
                            <p className="mt-0.5 text-[10px] text-muted-foreground">Disponible {formatCOP(saldo)}</p>
                          )}
                        </div>
                      )
                    })}

                    {/* Total */}
                    <div className="border-t pt-2 space-y-1">
                      <div className="flex items-center justify-between text-xs font-semibold">
                        <span>Total ejecutado</span>
                        <span className="tabular-nums">{formatCOP(totalEjecutado)}</span>
                      </div>
                      {totalPresupuesto > 0 && (
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-muted-foreground">Saldo total</span>
                          <span className={`tabular-nums font-medium ${totalPresupuesto - totalEjecutado < 0 ? 'text-red-500' : 'text-emerald-600'}`}>
                            {formatCOP(totalPresupuesto - totalEjecutado)}
                          </span>
                        </div>
                      )}
                    </div>
                  </>
                )
              })()}
            </div>
          )}
        </div>
      </div>

      {/* ─── Resumen financiero ─── */}
      {isInterno ? (
        /* Interno: Inversión acumulada */
        <div className="grid grid-cols-2 gap-2">
          {(f.presupuesto_total ?? 0) > 0 && (
            <FinCard label="Presupuesto" value={f.presupuesto_total} />
          )}
          <FinCard label="Costo horas" value={f.costo_horas} />
          <FinCard label="Gastos directos" value={f.gastos_directos} />
          <div className={`${(f.presupuesto_total ?? 0) > 0 ? '' : 'col-span-2'} rounded-lg border border-orange-200 bg-orange-50/50 p-3 dark:border-orange-900 dark:bg-orange-950/20`}>
            <p className="text-[10px] text-muted-foreground">Inversión total</p>
            <p className="text-sm font-bold mt-0.5 text-orange-600">{formatCOP(f.costo_acumulado ?? 0)}</p>
          </div>
        </div>
      ) : (
        /* Cliente: Resumen financiero completo */
        <div className="grid grid-cols-2 gap-2">
          <FinCard label="Presupuesto" value={f.presupuesto_total} />
          <FinCard label="Costo acumulado" value={f.costo_acumulado} warning={consumo > 90} />
          <FinCard label="Facturado" value={f.facturado} />
          <FinCard label="Cobrado" value={f.cobrado} />
          <FinCard label="Cartera" value={(f.facturado ?? 0) - (f.cobrado ?? 0)} />
          <FinCard label="Por facturar" value={(f.presupuesto_total ?? 0) - (f.facturado ?? 0)} />
          <div className="col-span-2 rounded-lg border p-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              {ganancia >= 0
                ? <TrendingUp className="h-4 w-4 text-green-600" />
                : <TrendingDown className="h-4 w-4 text-red-600" />}
              <span className="text-xs font-medium">Ganancia actual</span>
            </div>
            <span className={`text-sm font-bold ${ganancia >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {ganancia >= 0 ? '+' : ''}{formatCOP(ganancia)}
            </span>
          </div>
        </div>
      )}

      {/* ─── Registros (tabs: Gastos, Horas, Facturas) ─── */}
      <div className="space-y-2 rounded-lg border p-4">
        {/* Tab bar */}
        <div className="flex gap-1 rounded-lg bg-muted p-1">
          {([
            { key: 'gastos' as const, label: 'Gastos', count: gastosAll.length },
            { key: 'horas' as const, label: 'Horas', count: horasAll.length },
            ...(!isInterno ? [{ key: 'facturas' as const, label: 'Facturas', count: facturas.length }] : []),
          ]).map(tab => (
            <button
              key={tab.key}
              onClick={() => setRegistrosTab(tab.key)}
              className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                registrosTab === tab.key
                  ? 'bg-background shadow-sm text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {/* Tab: Gastos — mismo diseño que movimientos */}
        {registrosTab === 'gastos' && (
          gastosAll.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">Sin gastos aprobados</p>
          ) : (
            <div className="space-y-1">
              {gastosAll.map(g => {
                const hasSoporteImage = g.soporte_url && !g.soporte_url.startsWith('wamid.')
                return (
                  <div key={g.id} className="rounded-lg border bg-card px-3 py-2.5">
                    <div className="flex items-start gap-3">
                      <ArrowUpCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-500" />
                      <div className="min-w-0 flex-1">
                        {/* Line 1: Description + Amount */}
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="truncate text-sm font-medium">{g.descripcion}</p>
                          <span className="shrink-0 text-sm font-semibold tabular-nums text-red-600 dark:text-red-400">
                            -{formatCOP(g.monto)}
                          </span>
                        </div>

                        {/* Line 2: Categoria badge */}
                        {g.categoria && (
                          <div className="mt-1 flex items-center gap-1.5 flex-wrap">
                            {(() => {
                              const cfg = CATEGORIA_CONFIG[g.categoria]
                              return cfg ? (
                                <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${cfg.color}`}>
                                  {cfg.label}
                                </span>
                              ) : (
                                <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400 capitalize">
                                  {g.categoria.replace(/_/g, ' ')}
                                </span>
                              )
                            })()}
                          </div>
                        )}

                        {/* Line 3: User */}
                        {g.created_by_name && (
                          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
                            <User className="h-3 w-3 shrink-0" />
                            <span className="truncate">{g.created_by_name}</span>
                          </p>
                        )}

                        {/* Line 4: Status badges */}
                        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
                          {g.estado_pago === 'pendiente' && (
                            <span className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium bg-orange-100 text-orange-800 dark:bg-orange-900/40 dark:text-orange-300">
                              <Clock className="h-2.5 w-2.5" />
                              Pend. pago
                            </span>
                          )}

                          {/* Soporte: ver */}
                          {hasSoporteImage && (
                            <button
                              onClick={() => setSoporteModal({ url: g.soporte_url!, descripcion: g.descripcion })}
                              className="inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 dark:bg-blue-900/40 dark:text-blue-300 dark:hover:bg-blue-900/60 transition-colors"
                            >
                              <FileText className="h-2.5 w-2.5" />
                              Ver soporte
                            </button>
                          )}

                          {g.deducible && (
                            <span className="rounded px-1 py-0.5 text-[10px] font-medium bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300">
                              Deducible
                            </span>
                          )}

                          {g.canal_registro === 'whatsapp' && (
                            <Smartphone className="h-3 w-3 text-green-500" />
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )
        )}

        {/* Tab: Horas */}
        {registrosTab === 'horas' && (
          horasAll.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">Sin horas registradas</p>
          ) : (
            <div className="space-y-1">
              {horasAll.map(h => (
                <div key={h.id} className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <Clock className="h-4 w-4 text-blue-500 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{h.descripcion}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {h.fecha}
                        {h.staff_name && <> · {h.staff_name}</>}
                      </p>
                    </div>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-blue-600">{h.horas}h</span>
                </div>
              ))}
            </div>
          )
        )}

        {/* Tab: Facturas */}
        {registrosTab === 'facturas' && !isInterno && (
          facturas.length === 0 ? (
            <p className="py-3 text-center text-xs text-muted-foreground">Sin facturas</p>
          ) : (
            <div className="space-y-1.5">
              {facturas.map(fac => {
                const estadoPago = fac.estado_pago ?? 'pendiente'
                const estadoColor = estadoPago === 'pagada'
                  ? 'bg-green-100 text-green-700'
                  : estadoPago === 'parcial'
                    ? 'bg-yellow-100 text-yellow-700'
                    : 'bg-gray-100 text-gray-600'
                const dias = fac.dias_antiguedad ?? 0

                return (
                  <div
                    key={fac.factura_id}
                    className="flex items-center justify-between rounded-lg border bg-card px-3 py-2.5"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <FileText className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                        <span className="text-xs font-medium truncate">
                          {fac.numero_factura || 'Sin numero'}
                        </span>
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-medium ${estadoColor}`}>
                          {estadoPago === 'pagada' ? 'Pagada' : estadoPago === 'parcial' ? 'Parcial' : 'Pendiente'}
                        </span>
                        {dias > 60 && estadoPago !== 'pagada' && (
                          <span title={`${dias} dias`}>
                            <AlertTriangle className="h-3 w-3 text-red-500 shrink-0" />
                          </span>
                        )}
                      </div>
                      <p className="text-[10px] text-muted-foreground mt-0.5">
                        {formatCOP(fac.cobrado ?? 0)} cobrado de {formatCOP(fac.monto ?? 0)}
                      </p>
                    </div>
                    {estadoPago !== 'pagada' && (
                      <button
                        onClick={() => setDialog('cobro')}
                        className="shrink-0 rounded-md p-1.5 text-green-600 hover:bg-green-50 dark:hover:bg-green-950/30"
                        title="Registrar cobro"
                      >
                        <Banknote className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )
        )}
      </div>

      {/* ─── Campos custom + Labels ─── */}
      <CustomFieldsSection
        entidad="proyecto"
        entidadId={proyectoId}
        initialCustomData={customData ?? {}}
      />

      {/* ─── Actividad ─── */}
      <div className="space-y-3 rounded-lg border p-4">
        <h2 className="text-sm font-semibold">Actividad</h2>
        <ActivityLog entidadTipo="proyecto" entidadId={proyectoId} staffList={staffList} />
      </div>

      {/* ─── State controls (bottom) ─── */}
      {!isCerrado && (
        <div className="flex items-center gap-2 rounded-lg border border-dashed p-3">
          {isPausado ? (
            <button
              onClick={() => handleEstado('en_ejecucion')}
              disabled={isPending}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <Play className="h-3.5 w-3.5" />
              Reanudar proyecto
            </button>
          ) : (
            <button
              onClick={() => handleEstado('pausado')}
              disabled={isPending}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-yellow-200 py-2 text-xs font-medium text-yellow-700 hover:bg-yellow-50 disabled:opacity-50 dark:border-yellow-900 dark:text-yellow-400 dark:hover:bg-yellow-950/30"
            >
              <Pause className="h-3.5 w-3.5" />
              Pausar
            </button>
          )}
          <button
            onClick={() => setDialog('cierre')}
            disabled={isPending}
            className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg border border-green-200 py-2 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50 dark:border-green-900 dark:text-green-400 dark:hover:bg-green-950/30"
          >
            <Lock className="h-3.5 w-3.5" />
            Cerrar proyecto
          </button>
        </div>
      )}
      {/* Cobro allowed on closed client projects */}
      {!isInterno && isCerrado && facturas.some(f => f.estado_pago !== 'pagada') && (
        <button
          onClick={() => setDialog('cobro')}
          disabled={isPending}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-green-600 py-2.5 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          <Banknote className="h-3.5 w-3.5" />
          Registrar cobro pendiente
        </button>
      )}

      {/* ─── Dialogs ─── */}
      {dialog === 'horas' && (
        <HorasDialog
          proyectoId={proyectoId}
          staffList={staffList}
          onClose={() => { setDialog(null); router.refresh() }}
        />
      )}
      {!isInterno && dialog === 'factura' && (
        <FacturaDialog
          proyectoId={proyectoId}
          presupuesto={f.presupuesto_total ?? 0}
          facturado={f.facturado ?? 0}
          onClose={() => { setDialog(null); router.refresh() }}
        />
      )}
      {!isInterno && dialog === 'cobro' && (
        <CobroDialog
          facturas={facturas.filter(fa => fa.estado_pago !== 'pagada')}
          onClose={() => { setDialog(null); router.refresh() }}
        />
      )}
      {dialog === 'cierre' && (
        <CierreDialog
          proyectoId={proyectoId}
          financiero={f}
          isInterno={isInterno}
          onClose={() => { setDialog(null); router.refresh() }}
        />
      )}

      {/* Soporte image lightbox */}
      <Dialog open={!!soporteModal} onOpenChange={() => setSoporteModal(null)}>
        <DialogContent className="max-h-[90vh] max-w-md overflow-hidden p-2 sm:max-w-lg">
          <DialogTitle className="sr-only">Soporte</DialogTitle>
          {soporteModal && (
            <div className="flex flex-col gap-2">
              <p className="truncate px-2 pt-2 text-sm font-medium">{soporteModal.descripcion}</p>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={soporteModal.url}
                alt="Soporte fotográfico"
                className="max-h-[75vh] w-full rounded-lg object-contain"
              />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

// ── Financial summary card ────────────────────────────

function FinCard({ label, value, warning }: { label: string; value: number | null; warning?: boolean }) {
  return (
    <div className={`rounded-lg border p-3 ${warning ? 'border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20' : ''}`}>
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold mt-0.5">{formatCOP(value ?? 0)}</p>
    </div>
  )
}
