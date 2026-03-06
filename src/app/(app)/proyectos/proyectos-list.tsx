'use client'

import { useState, useEffect, useRef, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FolderOpen, Play, Square, Plus, Receipt, FileText, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { formatCOP } from '@/lib/contacts/constants'
import { ESTADO_PROYECTO_CONFIG } from '@/lib/pipeline/constants'
import type { EstadoProyecto } from '@/lib/pipeline/constants'
import { startTimer, stopTimer, type ActiveTimer } from '../timer-actions'
import { cambiarEstadoProyecto } from './actions-v2'
import NuevoInternoDialog from './nuevo-interno-dialog'
import GastoDialog from './[id]/gasto-dialog'
import HorasDialog from './[id]/horas-dialog'
import FacturaDialog from './[id]/factura-dialog'

// ── Types ─────────────────────────────────────────────

interface ProyectoFinanciero {
  proyecto_id: string | null
  codigo: string | null
  nombre: string | null
  estado: string | null
  tipo: string | null
  presupuesto_total: number | null
  avance_porcentaje: number | null
  presupuesto_consumido_pct: number | null
  ganancia_real: number | null
  costo_acumulado: number | null
  empresa_nombre: string | null
  empresa_codigo: string | null
  cobrado: number | null
  facturado: number | null
  cartera: number | null
  horas_reales: number | null
  created_at: string | null
}

interface Props {
  proyectos: ProyectoFinanciero[]
  activeTimer: ActiveTimer | null
}

// ── Filter chips ──────────────────────────────────────

type FilterTab = 'activos' | 'todos' | 'en_ejecucion' | 'pausado' | 'cerrado'
type DialogType = 'gasto' | 'horas' | 'factura'

const ESTADOS_ACTIVOS = ['en_ejecucion', 'pausado']

const FILTER_TABS: { key: FilterTab; label: string }[] = [
  { key: 'activos', label: 'Activos' },
  { key: 'todos', label: 'Todos' },
  { key: 'en_ejecucion', label: 'En ejecución' },
  { key: 'pausado', label: 'Pausados' },
  { key: 'cerrado', label: 'Cerrados' },
]

// ── Component ─────────────────────────────────────────

export default function ProyectosList({ proyectos, activeTimer: serverTimer }: Props) {
  const router = useRouter()
  const [tipoTab, setTipoTab] = useState<'cliente' | 'interno'>('cliente')
  const [activeFilter, setActiveFilter] = useState<FilterTab>('activos')
  const [timer, setTimer] = useState<ActiveTimer | null>(serverTimer)
  const [showNuevoInterno, setShowNuevoInterno] = useState(false)
  const [openDialog, setOpenDialog] = useState<{ type: DialogType; proyecto: ProyectoFinanciero } | null>(null)

  // Sync with server when prop changes (revalidation)
  useEffect(() => { setTimer(serverTimer) }, [serverTimer])

  const porTipo = proyectos.filter(p => (p.tipo ?? 'cliente') === tipoTab)
  const clienteCount = proyectos.filter(p => (p.tipo ?? 'cliente') === 'cliente').length
  const internoCount = proyectos.filter(p => (p.tipo ?? 'cliente') === 'interno').length

  const filtered = activeFilter === 'todos'
    ? porTipo
    : activeFilter === 'activos'
      ? porTipo.filter(p => ESTADOS_ACTIVOS.includes(p.estado ?? ''))
      : porTipo.filter(p => p.estado === activeFilter)

  const handleCloseDialog = () => {
    setOpenDialog(null)
    router.refresh()
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Proyectos</h1>
        <span className="text-sm text-muted-foreground">{filtered.length} proyecto{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Tipo tabs: De clientes / Internos */}
      <div className="flex gap-1 rounded-lg bg-muted p-1">
        <button
          onClick={() => { setTipoTab('cliente'); setActiveFilter('activos') }}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tipoTab === 'cliente' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          De clientes ({clienteCount})
        </button>
        <button
          onClick={() => { setTipoTab('interno'); setActiveFilter('activos') }}
          className={`flex-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
            tipoTab === 'interno' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
          }`}
        >
          Internos ({internoCount})
        </button>
      </div>

      {/* Filter chips */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {FILTER_TABS.map(tab => {
          const count = tab.key === 'activos'
            ? porTipo.filter(p => ESTADOS_ACTIVOS.includes(p.estado ?? '')).length
            : tab.key === 'todos'
              ? porTipo.length
              : porTipo.filter(p => p.estado === tab.key).length
          return (
            <button
              key={tab.key}
              onClick={() => setActiveFilter(tab.key)}
              className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                activeFilter === tab.key
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:bg-accent'
              }`}
            >
              {tab.label}
              <span className="ml-1 opacity-70">({count})</span>
            </button>
          )
        })}
      </div>

      {/* Nuevo proyecto interno button */}
      {tipoTab === 'interno' && (
        <button
          onClick={() => setShowNuevoInterno(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border-2 border-dashed border-muted-foreground/25 py-3 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
        >
          <Plus className="h-4 w-4" />
          Nuevo proyecto interno
        </button>
      )}

      {/* Project cards */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center py-16 text-center">
          <FolderOpen className="h-12 w-12 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            {tipoTab === 'interno'
              ? 'No hay proyectos internos. Crea uno para registrar inversiones operativas.'
              : activeFilter === 'activos'
                ? 'No hay proyectos activos. Gana una oportunidad para crear tu primer proyecto.'
                : 'No hay proyectos en este estado.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(p => (
            <ProyectoCard
              key={p.proyecto_id}
              proyecto={p}
              isInterno={tipoTab === 'interno'}
              activeTimer={timer}
              onTimerChange={setTimer}
              onOpenDialog={(type) => setOpenDialog({ type, proyecto: p })}
            />
          ))}
        </div>
      )}

      {/* Nuevo proyecto interno dialog */}
      {showNuevoInterno && (
        <NuevoInternoDialog onClose={() => setShowNuevoInterno(false)} />
      )}

      {/* ── Register dialogs (opened from card shortcuts) ── */}
      {openDialog?.type === 'gasto' && openDialog.proyecto.proyecto_id && (
        <GastoDialog
          proyectoId={openDialog.proyecto.proyecto_id}
          rubrosLista={[]}
          onClose={handleCloseDialog}
        />
      )}
      {openDialog?.type === 'horas' && openDialog.proyecto.proyecto_id && (
        <HorasDialog
          proyectoId={openDialog.proyecto.proyecto_id}
          onClose={handleCloseDialog}
        />
      )}
      {openDialog?.type === 'factura' && openDialog.proyecto.proyecto_id && (
        <FacturaDialog
          proyectoId={openDialog.proyecto.proyecto_id}
          presupuesto={openDialog.proyecto.presupuesto_total ?? 0}
          facturado={openDialog.proyecto.facturado ?? 0}
          onClose={handleCloseDialog}
        />
      )}
    </div>
  )
}

// ── Project Card ──────────────────────────────────────

function ProyectoCard({
  proyecto: p,
  isInterno,
  activeTimer,
  onTimerChange,
  onOpenDialog,
}: {
  proyecto: ProyectoFinanciero
  isInterno: boolean
  activeTimer: ActiveTimer | null
  onTimerChange: (t: ActiveTimer | null) => void
  onOpenDialog: (type: DialogType) => void
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const estado = (p.estado ?? 'en_ejecucion') as EstadoProyecto
  const config = ESTADO_PROYECTO_CONFIG[estado]
  const avance = Math.min(p.avance_porcentaje ?? 0, 100)
  const consumo = Math.min(p.presupuesto_consumido_pct ?? 0, 150)
  const ganancia = p.ganancia_real ?? 0

  const isThisProjectTimer = activeTimer?.proyecto_id === p.proyecto_id
  const canTimer = estado === 'en_ejecucion'

  // Quick cycle: en_ejecucion ↔ pausado (cerrado is terminal)
  const ESTADO_CYCLE: Record<string, EstadoProyecto | null> = {
    en_ejecucion: 'pausado',
    pausado: 'en_ejecucion',
    cerrado: null,
  }

  const handleCycleEstado = (e: React.MouseEvent) => {
    e.stopPropagation()
    e.preventDefault()
    if (!p.proyecto_id) return
    const next = ESTADO_CYCLE[estado]
    if (!next) return
    const nextLabel = ESTADO_PROYECTO_CONFIG[next]?.label ?? next
    startTransition(async () => {
      const res = await cambiarEstadoProyecto(p.proyecto_id!, next)
      if (res.success) {
        toast.success(`Estado: ${nextLabel}`)
        router.refresh()
      } else {
        toast.error(res.error ?? 'Error')
      }
    })
  }

  // Semáforo for presupuesto consumido bar
  const semaforoBar = consumo > 90
    ? 'bg-red-500'
    : consumo > 70
      ? 'bg-yellow-500'
      : 'bg-green-500'

  // ── Elapsed time (client tick) ───────────────────
  const [elapsed, setElapsed] = useState('')
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    if (isThisProjectTimer && activeTimer?.inicio) {
      const tick = () => {
        const secs = Math.floor((Date.now() - new Date(activeTimer.inicio).getTime()) / 1000)
        const h = Math.floor(secs / 3600)
        const m = Math.floor((secs % 3600) / 60)
        const s = secs % 60
        setElapsed(`${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`)
      }
      tick()
      intervalRef.current = setInterval(tick, 1000)
    } else {
      setElapsed('')
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [isThisProjectTimer, activeTimer?.inicio])

  const handleStartTimer = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!p.proyecto_id) return
    startTransition(async () => {
      const res = await startTimer(p.proyecto_id!)
      if (res.success && res.timer) {
        onTimerChange(res.timer)
        toast.success(`Timer iniciado: ${p.nombre}`)
      } else {
        toast.error(res.error ?? 'Error al iniciar timer')
      }
    })
  }

  const handleStopTimer = (e: React.MouseEvent) => {
    e.stopPropagation()
    startTransition(async () => {
      const res = await stopTimer()
      if (res.success) {
        onTimerChange(null)
        if (res.descartado) {
          toast.info('Timer descartado (menos de 1 minuto)')
        } else {
          toast.success(`${res.horasRegistradas}h registradas`)
        }
      } else {
        toast.error(res.error ?? 'Error al detener timer')
      }
    })
  }

  return (
    <div
      onClick={() => router.push(`/proyectos/${p.proyecto_id}`)}
      className="block cursor-pointer rounded-lg border bg-card p-4 shadow-sm transition-shadow hover:shadow-md"
    >
      {/* Row 1: Name + Timer + Status + Value */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {p.codigo && (
              <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono font-bold text-muted-foreground">
                P {p.codigo}
              </span>
            )}
            <h3 className="truncate text-sm font-semibold">{p.nombre ?? 'Sin nombre'}</h3>
            {/* Timer button */}
            {isThisProjectTimer ? (
              <button
                onClick={handleStopTimer}
                disabled={isPending}
                className="flex shrink-0 items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 disabled:opacity-50 transition-colors"
              >
                <Square className="h-3 w-3" />
                <span className="text-[10px] font-mono font-medium">{elapsed}</span>
              </button>
            ) : canTimer ? (
              <button
                onClick={handleStartTimer}
                disabled={isPending}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-green-100 hover:text-green-600 dark:hover:bg-green-900/30 disabled:opacity-50 transition-colors"
              >
                <Play className="h-3 w-3" />
              </button>
            ) : null}
          </div>
          {isInterno ? (
            <span className="mt-0.5 inline-block rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">Interno</span>
          ) : p.empresa_nombre ? (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{p.empresa_nombre}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {p.presupuesto_total ? (
            <span className="text-sm font-semibold">{formatCOP(p.presupuesto_total)}</span>
          ) : null}
          {config && (
            ESTADO_CYCLE[estado] ? (
              <button
                onClick={handleCycleEstado}
                disabled={isPending}
                className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-opacity hover:opacity-75 disabled:opacity-50 ${config.chipClass}`}
              >
                {config.label} ›
              </button>
            ) : (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${config.chipClass}`}>
                {config.label}
              </span>
            )
          )}
        </div>
      </div>

      {/* Row 2: Dual progress bars */}
      <div className="mt-3 space-y-1.5">
        {/* Avance bar */}
        <div className="flex items-center gap-2">
          <span className="w-16 text-[10px] text-muted-foreground shrink-0">Avance</span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-blue-500 transition-all"
              style={{ width: `${Math.min(avance, 100)}%` }}
            />
          </div>
          <span className="w-10 text-right text-[10px] font-medium">{avance}%</span>
        </div>

        {/* Presupuesto consumido bar */}
        <div className="flex items-center gap-2">
          <span className="w-16 text-[10px] text-muted-foreground shrink-0">Costo</span>
          <div className="flex-1 h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${semaforoBar}`}
              style={{ width: `${Math.min(consumo, 100)}%` }}
            />
          </div>
          <span className="w-10 text-right text-[10px] font-medium">{consumo}%</span>
        </div>
      </div>

      {/* Row 3: Ganancia (client) or Inversión (interno) */}
      <div className="mt-2 flex items-center justify-between">
        {isInterno ? (
          <>
            <span className="text-[10px] text-muted-foreground">Inversión acumulada</span>
            <span className="text-xs font-semibold text-orange-600">{formatCOP(p.costo_acumulado ?? 0)}</span>
          </>
        ) : (
          <>
            <span className="text-[10px] text-muted-foreground">Ganancia actual</span>
            <span className={`text-xs font-semibold ${ganancia >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {ganancia >= 0 ? '+' : ''}{formatCOP(ganancia)}
            </span>
          </>
        )}
      </div>

      {/* Row 4: Quick register shortcuts (only for active projects) */}
      {estado === 'en_ejecucion' && (
        <div className="mt-3 flex items-center gap-1.5 border-t pt-3" onClick={e => e.stopPropagation()}>
          <button
            onClick={() => onOpenDialog('gasto')}
            className="inline-flex items-center gap-1 rounded-md bg-orange-50 border border-orange-200 px-2.5 py-1.5 text-[11px] font-medium text-orange-700 transition-colors hover:bg-orange-100 dark:bg-orange-950/30 dark:border-orange-900 dark:text-orange-400 dark:hover:bg-orange-950/50"
          >
            <Receipt className="h-3 w-3" />
            Gasto
          </button>
          <button
            onClick={() => onOpenDialog('horas')}
            className="inline-flex items-center gap-1 rounded-md bg-blue-50 border border-blue-200 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:bg-blue-950/30 dark:border-blue-900 dark:text-blue-400 dark:hover:bg-blue-950/50"
          >
            <Clock className="h-3 w-3" />
            Horas
          </button>
          {!isInterno && (
            <button
              onClick={() => onOpenDialog('factura')}
              className="inline-flex items-center gap-1 rounded-md bg-green-50 border border-green-200 px-2.5 py-1.5 text-[11px] font-medium text-green-700 transition-colors hover:bg-green-100 dark:bg-green-950/30 dark:border-green-900 dark:text-green-400 dark:hover:bg-green-950/50"
            >
              <FileText className="h-3 w-3" />
              Factura
            </button>
          )}
        </div>
      )}
    </div>
  )
}
