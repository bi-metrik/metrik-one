'use client'

import { useState, useEffect, useRef, useCallback, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, X, Flame, UserPlus, Receipt, Clock, Play, Square } from 'lucide-react'
import { toast } from 'sonner'
import {
  startTimer, stopTimer, getActiveTimer, getProyectosActivos,
  type ActiveTimer,
} from './timer-actions'

// ── Types ─────────────────────────────────────────────

interface FABProps {
  role: string
}

interface FABAction {
  label: string
  icon: typeof Flame
  roles: string[]
  href?: string
  action?: string
}

const FAB_ACTIONS: FABAction[] = [
  {
    label: 'Nueva oportunidad',
    icon: Flame,
    href: '/nuevo/oportunidad',
    roles: ['owner', 'admin'],
  },
  {
    label: 'Nuevo contacto',
    icon: UserPlus,
    href: '/nuevo/contacto',
    roles: ['owner', 'admin'],
  },
  {
    label: 'Registrar gasto',
    icon: Receipt,
    href: '/nuevo/gasto',
    roles: ['owner', 'admin', 'operator'],
  },
]

const STORAGE_KEY = 'metrik-timer-v2'

interface TimerLocal {
  isRunning: boolean
  proyectoId: string
  proyectoNombre: string
  inicio: string | null
}

const DEFAULT_TIMER: TimerLocal = {
  isRunning: false,
  proyectoId: '',
  proyectoNombre: '',
  inicio: null,
}

// ── FAB Component ─────────────────────────────────────

export default function FAB({ role }: FABProps) {
  const [open, setOpen] = useState(false)
  const [timerPanel, setTimerPanel] = useState(false)
  const router = useRouter()

  // Timer state
  const [timer, setTimer] = useState<TimerLocal>(DEFAULT_TIMER)
  const [elapsed, setElapsed] = useState(0)
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [timerLoaded, setTimerLoaded] = useState(false)
  const [isPending, startTransition] = useTransition()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const visibleActions = FAB_ACTIONS.filter(a => a.roles.includes(role))

  // ── Hydrate timer from server ──────────────────────

  useEffect(() => {
    async function hydrate() {
      const [activeTimer, projs] = await Promise.all([
        getActiveTimer(),
        getProyectosActivos(),
      ])
      setProjects(projs)

      if (activeTimer) {
        const s: TimerLocal = {
          isRunning: true,
          proyectoId: activeTimer.proyecto_id,
          proyectoNombre: activeTimer.proyecto_nombre,
          inicio: activeTimer.inicio,
        }
        setTimer(s)
        persist(s)
      } else {
        try {
          const saved = localStorage.getItem(STORAGE_KEY)
          if (saved) {
            const parsed = JSON.parse(saved) as TimerLocal
            if (parsed.isRunning) localStorage.removeItem(STORAGE_KEY)
          }
        } catch { /* ignore */ }
      }
      setTimerLoaded(true)
    }
    hydrate()
  }, [])

  // ── Timer tick ─────────────────────────────────────

  useEffect(() => {
    if (timer.isRunning && timer.inicio) {
      const calcElapsed = () => Math.floor((Date.now() - new Date(timer.inicio!).getTime()) / 1000)
      setElapsed(calcElapsed())
      intervalRef.current = setInterval(() => setElapsed(calcElapsed()), 1000)
    } else {
      setElapsed(0)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [timer.isRunning, timer.inicio])

  // ── Persist ────────────────────────────────────────

  const persist = useCallback((s: TimerLocal) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* */ }
  }, [])

  // ── Helpers ────────────────────────────────────────

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const handleAction = useCallback((action: FABAction) => {
    setOpen(false)
    if (action.href) router.push(action.href)
  }, [router])

  const handleOpenTimer = () => {
    setOpen(false)
    setTimerPanel(true)
  }

  const handleStartTimer = () => {
    if (!timer.proyectoId) {
      toast.error('Selecciona un proyecto primero')
      return
    }
    startTransition(async () => {
      const res = await startTimer(timer.proyectoId)
      if (res.success && res.timer) {
        const s: TimerLocal = {
          isRunning: true,
          proyectoId: res.timer.proyecto_id,
          proyectoNombre: res.timer.proyecto_nombre,
          inicio: res.timer.inicio,
        }
        setTimer(s)
        persist(s)
        setTimerPanel(false)
        toast.success(`Timer iniciado: ${res.timer.proyecto_nombre}`)
      } else {
        toast.error(res.error ?? 'Error al iniciar timer')
      }
    })
  }

  const handleStopTimer = () => {
    startTransition(async () => {
      const res = await stopTimer()
      if (res.success) {
        if (res.descartado) {
          toast.info('Timer descartado (menos de 1 minuto)')
        } else {
          toast.success(`${res.horasRegistradas}h registradas en ${timer.proyectoNombre}`)
        }
        setTimer(DEFAULT_TIMER)
        persist(DEFAULT_TIMER)
      } else {
        toast.error(res.error ?? 'Error al detener timer')
      }
    })
  }

  if (visibleActions.length === 0) return null

  return (
    <>
      {/* Backdrop */}
      {(open || timerPanel) && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-[1px]"
          onClick={() => { setOpen(false); setTimerPanel(false) }}
        />
      )}

      {/* ── Timer panel (select project + start) ───────── */}
      {timerPanel && !timer.isRunning && (
        <div className="fixed bottom-24 right-6 z-50 w-64 rounded-2xl border bg-card p-4 shadow-xl space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-4 w-4 text-violet-500" />
              <p className="text-sm font-semibold">Iniciar timer</p>
            </div>
            <button onClick={() => setTimerPanel(false)} className="rounded-lg p-1 hover:bg-accent">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
          </div>

          <select
            value={timer.proyectoId}
            onChange={e => {
              const proj = projects.find(p => p.id === e.target.value)
              setTimer(prev => ({ ...prev, proyectoId: e.target.value, proyectoNombre: proj?.name || '' }))
            }}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          >
            <option value="">Seleccionar proyecto...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          <button
            onClick={handleStartTimer}
            disabled={!timer.proyectoId || isPending}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-violet-600 py-2.5 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50 transition-colors"
          >
            <Play className="h-3.5 w-3.5" />
            {isPending ? 'Iniciando...' : 'Iniciar'}
          </button>
        </div>
      )}

      {/* ── Action menu (card style) ───────────────────── */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-56 overflow-hidden rounded-2xl border bg-card shadow-xl">
          {/* Active timer row (when running, replaces "Iniciar timer") */}
          {timer.isRunning && timerLoaded && (
            <div className="flex items-center gap-2 border-b px-4 py-3">
              <div className="h-2 w-2 shrink-0 rounded-full bg-green-500 animate-pulse" />
              <div className="min-w-0 flex-1">
                <span className="text-xs font-mono font-semibold tabular-nums">{formatTime(elapsed)}</span>
                <p className="truncate text-[10px] text-muted-foreground">{timer.proyectoNombre}</p>
              </div>
              <button
                onClick={handleStopTimer}
                disabled={isPending}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 disabled:opacity-50 transition-colors"
              >
                <Square className="h-3 w-3" />
              </button>
            </div>
          )}

          {/* Timer start action (when not running) */}
          {timerLoaded && projects.length > 0 && !timer.isRunning && (
            <button
              onClick={handleOpenTimer}
              className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-violet-600 hover:bg-violet-50 dark:hover:bg-violet-950/20 transition-colors border-b"
            >
              <Clock className="h-4 w-4 shrink-0" />
              Iniciar timer
            </button>
          )}

          {/* Regular actions */}
          {visibleActions.map((action, i) => {
            const Icon = action.icon
            return (
              <button
                key={action.href ?? action.action}
                onClick={() => handleAction(action)}
                className={`flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-foreground hover:bg-accent transition-colors ${
                  i < visibleActions.length - 1 ? 'border-b' : ''
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                {action.label}
              </button>
            )
          })}
        </div>
      )}

      {/* ── Active timer pill (above FAB — hidden when menu open) ── */}
      {timer.isRunning && timerLoaded && !open && (
        <div className="fixed bottom-[5.5rem] right-6 z-50 flex items-center gap-2 rounded-full border bg-card pl-3 pr-1.5 py-1.5 shadow-lg">
          <div className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
          <span className="text-xs font-mono font-semibold tabular-nums">{formatTime(elapsed)}</span>
          <span className="max-w-20 truncate text-[10px] text-muted-foreground">{timer.proyectoNombre}</span>
          <button
            onClick={handleStopTimer}
            disabled={isPending}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 disabled:opacity-50 transition-colors"
          >
            <Square className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* ── Main FAB button ────────────────────────────── */}
      <button
        onClick={() => { setOpen(!open); setTimerPanel(false) }}
        className={`fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all ${
          open
            ? 'bg-foreground text-background'
            : timer.isRunning
              ? 'bg-violet-600 text-white'
              : 'bg-primary text-primary-foreground'
        }`}
      >
        {open ? (
          <X className="h-6 w-6" />
        ) : timer.isRunning ? (
          <Clock className="h-6 w-6" />
        ) : (
          <Plus className="h-6 w-6" />
        )}
      </button>
    </>
  )
}
