'use client'

import { useState, useTransition, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, FolderOpen, Clock, Banknote, Pause, Play,
  Lock, Plus, TrendingUp, TrendingDown, FileText, AlertTriangle,
  ChevronDown, RefreshCw, ArrowUpCircle, User, Smartphone, Upload, Loader2, Calendar,
  Check, X,
} from 'lucide-react'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { toast } from 'sonner'
import { updateAvance, cambiarEstadoProyecto, marcarEntregado, updateProyectoCarpeta, updateProyectoResponsable } from '../actions-v2'
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
  avance_calculado: number | null
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
  oportunidad_codigo: string | null
  fecha_entrega_estimada: string | null
  fecha_fin_estimada: string | null
  fecha_cierre: string | null
  estado_changed_at: string | null
  ultima_actividad: string | null
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
  const [entregarModal, setEntregarModal] = useState(false)
  const [carpetaUrl, setCarpetaUrl] = useState(f.carpeta_url ?? '')
  const [carpetaEditing, setCarpetaEditing] = useState(false)
  const [responsableId, setResponsableId] = useState(responsable?.id ?? '')
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
  const isEntregado = estado === 'entregado'
  const isPausado = estado === 'pausado'
  const isInterno = f.tipo === 'interno'
  const proyectoId = f.proyecto_id ?? ''

  // D173: días hasta entrega estimada
  const diasEntrega = (() => {
    const fecha = f.fecha_entrega_estimada
    if (!fecha) return null
    const diff = new Date(fecha).getTime() - Date.now()
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  })()

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

  const cartera = (f.facturado ?? 0) - (f.cobrado ?? 0)

  // D176: Marcar como entregado — soft gate si hay cartera pendiente
  const handleEntregado = () => {
    if (cartera > 0) {
      setEntregarModal(true)
      return
    }
    ejecutarEntregado()
  }

  const ejecutarEntregado = () => {
    setEntregarModal(false)
    startTransition(async () => {
      const res = await marcarEntregado(proyectoId)
      if (res.success) {
        toast.success('Proyecto marcado como entregado')
        router.refresh()
      } else {
        toast.error(res.error ?? 'Error al marcar como entregado')
      }
    })
  }

  const stageSuffix = (estado: string | null) => {
    if (!estado) return ''
    if (['en_ejecucion', 'pausado'].includes(estado)) return '·E'
    if (estado === 'entregado') return '·R'
    if (estado === 'cerrado') return '·X'
    return ''
  }

  const calcDias = (fecha: string | null) => {
    if (!fecha) return 0
    return Math.floor((Date.now() - new Date(fecha).getTime()) / (1000 * 60 * 60 * 24))
  }
  const diasEnStage = calcDias(f.estado_changed_at ?? f.updated_at)
  const diasSinActividad = calcDias(f.ultima_actividad ?? f.updated_at)

  const stageSuffixColor = (estado: string | null) => {
    if (!estado) return 'text-muted-foreground'
    if (['en_ejecucion', 'pausado'].includes(estado)) return 'text-green-600'
    if (estado === 'entregado') return 'text-blue-600'
    if (estado === 'cerrado') return 'text-slate-500'
    return 'text-muted-foreground'
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
            {(f.oportunidad_codigo ?? f.codigo) && (
              <span className={`font-medium ${stageSuffixColor(f.estado)}`}>
                {f.oportunidad_codigo ?? f.codigo}{stageSuffix(f.estado)}{' '}
              </span>
            )}
            {f.nombre ?? 'Sin nombre'}
          </h1>
          <div className="flex items-center gap-2 flex-wrap">
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
            {/* D173: Fecha entrega estimada */}
            {f.fecha_entrega_estimada && diasEntrega !== null && (
              <span className={`flex items-center gap-1 text-[11px] font-medium ${
                diasEntrega < 0
                  ? 'text-red-600'
                  : diasEntrega <= 3
                  ? 'text-amber-600'
                  : 'text-muted-foreground'
              }`}>
                <Calendar className="h-3 w-3" />
                Entrega: {new Date(f.fecha_entrega_estimada + 'T12:00:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}
                {diasEntrega === 0 ? ' (hoy)' : diasEntrega < 0 ? ` (hace ${Math.abs(diasEntrega)} d)` : ` (${diasEntrega} d)`}
              </span>
            )}
          </div>
          {/* Contadores de tiempo */}
          <div className="mt-1.5 flex items-center gap-3">
            <span className="text-[10px] text-muted-foreground">
              {diasEnStage}d en este estado
            </span>
            {diasSinActividad >= 4 && (
              <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold ${
                diasSinActividad >= 8
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
              }`}>
                {diasSinActividad}d sin actividad
              </span>
            )}
          </div>
        </div>
        {/* Drive icon — solo cuando ya hay URL */}
        {carpetaUrl && !carpetaEditing && (
          <button
            onClick={() => window.open(carpetaUrl, '_blank')}
            onContextMenu={e => { e.preventDefault(); setCarpetaEditing(true) }}
            onDoubleClick={() => setCarpetaEditing(true)}
            className={`rounded-md p-1.5 hover:bg-accent ${
              ['en_ejecucion','pausado'].includes(f.estado ?? '')
                ? 'text-green-500 hover:text-green-600'
                : f.estado === 'entregado'
                ? 'text-blue-500 hover:text-blue-600'
                : 'text-slate-500 hover:text-slate-600'
            }`}
            title="Abrir carpeta Drive (doble clic para editar)"
          >
            <FolderOpen className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Carpeta URL — siempre visible si no hay URL, editable si está en modo edición */}
      {(!carpetaUrl || carpetaEditing) && (
        <div className="flex items-center gap-2 rounded-lg border bg-muted/30 px-3 py-2">
          <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
          <input
            type="url"
            value={carpetaUrl}
            onChange={e => setCarpetaUrl(e.target.value)}
            placeholder="https://drive.google.com/..."
            className="flex-1 rounded-md border bg-background px-2 py-1 text-xs"
            autoFocus
            onKeyDown={e => {
              if (e.key === 'Enter') {
                setCarpetaEditing(false)
                startTransition(async () => {
                  await updateProyectoCarpeta(proyectoId, carpetaUrl.trim() || null)
                  toast.success('Carpeta guardada')
                })
              }
              if (e.key === 'Escape') {
                setCarpetaEditing(false)
                setCarpetaUrl(f.carpeta_url ?? '')
              }
            }}
          />
          <button
            onClick={() => {
              setCarpetaEditing(false)
              startTransition(async () => {
                await updateProyectoCarpeta(proyectoId, carpetaUrl.trim() || null)
                toast.success('Carpeta guardada')
              })
            }}
            className="rounded-md p-1 text-green-600 hover:bg-green-50"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => {
              setCarpetaEditing(false)
              setCarpetaUrl(f.carpeta_url ?? '')
            }}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}


      {/* D131: Link to approved cotización — microlink discreto */}
      {cotizacionId && oportunidadId && (
        <div className="flex items-center gap-2">
          <Link
            href={`/pipeline/${oportunidadId}/cotizacion/${cotizacionId}`}
            className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-950/30"
          >
            <FileText className="h-3 w-3" />
            Ver cotizacion aprobada →
          </Link>
          {oportunidadId && (
            <Link
              href={`/pipeline/${oportunidadId}`}
              className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-amber-200 hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-950/30"
            >
              Ver negocio ·C →
            </Link>
          )}
        </div>
      )}

      {/* ─── Acciones de estado (zona primaria, igual que oportunidad) ─── */}
      {!isCerrado && !isEntregado && (
        <div className="flex items-center gap-2">
          {isPausado ? (
            <button
              onClick={() => handleEstado('en_ejecucion')}
              disabled={isPending}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-green-600 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              <Play className="h-4 w-4" />
              Reanudar
            </button>
          ) : (
            <button
              onClick={() => handleEstado('pausado')}
              disabled={isPending}
              className="inline-flex items-center justify-center gap-1.5 rounded-lg border px-4 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
            >
              <Pause className="h-4 w-4" />
              Pausar
            </button>
          )}
          {!isInterno && !isPausado && (
            <button
              onClick={() => handleEntregado()}
              disabled={isPending}
              className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-blue-600 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              <ArrowUpCircle className="h-4 w-4" />
              Entregar
            </button>
          )}
          <button
            onClick={() => setDialog('cierre')}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800/50"
          >
            <Lock className="h-4 w-4" />
            Cerrar
          </button>
        </div>
      )}
      {!isInterno && isCerrado && facturas.some(fac => fac.estado_pago !== 'pagada') && (
        <button
          onClick={() => setDialog('cobro')}
          disabled={isPending}
          className="w-full inline-flex items-center justify-center gap-1.5 rounded-lg bg-green-600 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          <Banknote className="h-3.5 w-3.5" />
          Registrar cobro pendiente
        </button>
      )}

      {/* Responsable de ejecución */}
      {staffList.length > 0 && (
        <div className="flex items-center gap-2 rounded-lg border p-3">
          <User className="h-4 w-4 text-muted-foreground shrink-0" />
          <div className="flex flex-1 items-center justify-between min-w-0">
            <label className="text-xs text-muted-foreground shrink-0 mr-2">Responsable</label>
            <select
              value={responsableId}
              onChange={(e) => {
                const newVal = e.target.value
                setResponsableId(newVal)
                startTransition(async () => {
                  await updateProyectoResponsable(proyectoId, newVal || null)
                  toast.success('Responsable actualizado')
                })
              }}
              className="flex-1 rounded-md border bg-background px-2 py-1 text-sm min-w-0"
            >
              <option value="">Sin asignar</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>{s.full_name}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {/* ─── Alertas ─── */}
      <ProyectoAlertas financiero={f} facturas={facturas} />

      {/* ─── Barras duales ─── */}
      <div className="space-y-3 rounded-lg border p-4">
        {/* D170: Avance calculado (40% horas, 30% presupuesto, 30% facturación) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium">Avance del proyecto</span>
            <span className="text-xs font-semibold">{Math.round(f.avance_calculado ?? 0)}%</span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: `${Math.min(f.avance_calculado ?? 0, 100)}%` }}
            />
          </div>
          <p className="mt-1 text-[10px] text-muted-foreground">Calculado automáticamente (horas, presupuesto, facturación)</p>
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
        <ActivityLog entidadTipo="proyecto" entidadId={proyectoId} staffList={staffList} oportunidadId={oportunidadId} />
      </div>

      {/* D176: Modal soft gate entrega */}
      {entregarModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl border bg-background p-6 shadow-xl">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
              <div>
                <h3 className="text-base font-semibold">Hay cartera pendiente</h3>
                <p className="mt-1.5 text-sm text-muted-foreground">
                  Este proyecto tiene <span className="font-medium text-foreground">{formatCOP(cartera)}</span> pendiente por cobrar.
                  Puedes marcarlo como entregado igualmente y gestionar el cobro después.
                </p>
              </div>
            </div>
            <div className="mt-5 flex gap-3">
              <button
                onClick={() => setEntregarModal(false)}
                className="flex h-10 flex-1 items-center justify-center rounded-lg border border-input bg-background text-sm font-medium transition-colors hover:bg-accent"
              >
                Cancelar
              </button>
              <button
                onClick={ejecutarEntregado}
                disabled={isPending}
                className="flex h-10 flex-1 items-center justify-center rounded-lg bg-blue-600 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:opacity-50"
              >
                Marcar como entregado
              </button>
            </div>
          </div>
        </div>
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
