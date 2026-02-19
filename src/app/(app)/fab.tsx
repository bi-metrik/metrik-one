'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Plus, X, Funnel, Receipt, Play, Pause, Square, Clock, Timer } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import OpportunityModal from './pipeline/opportunity-modal'
import ExpenseModal from './gastos/expense-modal'
import { saveTimerEntry, getActiveProjects } from '@/app/(app)/timer-actions'
import type { Opportunity } from '@/types/database'

type OpportunityWithClient = Opportunity & {
  clients: { name: string } | null
}

interface FABProps {
  role?: string
}

const TIMER_CATEGORIES = [
  'Diseño', 'Desarrollo', 'Reunión', 'Planeación',
  'Revisión', 'Administrativo', 'Soporte', 'Investigación',
  'Contenido', 'Otro',
]

const STORAGE_KEY = 'metrik-timer'

interface TimerState {
  isRunning: boolean
  elapsed: number
  projectId: string
  projectName: string
  category: string
  activity: string
  startedAt: string | null
}

const DEFAULT_TIMER: TimerState = {
  isRunning: false,
  elapsed: 0,
  projectId: '',
  projectName: '',
  category: '',
  activity: '',
  startedAt: null,
}

/**
 * FAB — D43: Floating Action Button visible en todas las pantallas
 * Integra: Nueva oportunidad + Registrar gasto + Timer (F23)
 * Sprint 9: Role-adaptive (D169)
 */
export default function FAB({ role = 'owner' }: FABProps) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [showOppModal, setShowOppModal] = useState(false)
  const [showExpenseModal, setShowExpenseModal] = useState(false)
  const [timerPanel, setTimerPanel] = useState(false)

  // Timer state
  const [timer, setTimer] = useState<TimerState>(DEFAULT_TIMER)
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const canCreateOpportunity = role === 'owner' || role === 'admin'
  const canRegisterExpense = role === 'owner' || role === 'admin' || role === 'operator'

  // Load timer state from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as TimerState
        if (parsed.isRunning && parsed.startedAt) {
          const elapsed = Math.floor((Date.now() - new Date(parsed.startedAt).getTime()) / 1000)
          setTimer({ ...parsed, elapsed })
        } else {
          setTimer(parsed)
        }
      }
    } catch { /* ignore */ }
  }, [])

  // Load projects
  useEffect(() => {
    getActiveProjects().then(setProjects)
  }, [])

  // Persist timer
  const persist = useCallback((s: TimerState) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* ignore */ }
  }, [])

  // Timer tick
  useEffect(() => {
    if (timer.isRunning) {
      intervalRef.current = setInterval(() => {
        setTimer(prev => ({ ...prev, elapsed: prev.elapsed + 1 }))
      }, 1000)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [timer.isRunning])

  // Persist on change
  useEffect(() => {
    persist(timer)
  }, [timer, persist])

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const handleTimerStart = () => {
    if (!timer.projectId) {
      toast.error('Selecciona un proyecto primero')
      return
    }
    setTimer(prev => ({
      ...prev,
      isRunning: true,
      startedAt: prev.startedAt || new Date().toISOString(),
    }))
  }

  const handleTimerPause = () => {
    setTimer(prev => ({ ...prev, isRunning: false }))
  }

  const handleTimerStop = async () => {
    if (timer.elapsed < 60) {
      toast.error('Mínimo 1 minuto para registrar')
      return
    }
    setSaving(true)
    const hours = Math.round((timer.elapsed / 3600) * 100) / 100

    const res = await saveTimerEntry({
      project_id: timer.projectId,
      hours,
      activity: timer.activity || undefined,
      category: timer.category || undefined,
      start_time: timer.startedAt || undefined,
      end_time: new Date().toISOString(),
    })

    if (res.success) {
      toast.success(`${hours}h registradas en ${timer.projectName}`)
      setTimer(DEFAULT_TIMER)
      persist(DEFAULT_TIMER)
      setTimerPanel(false)
    } else {
      toast.error(res.error)
    }
    setSaving(false)
  }

  const handleTimerReset = () => {
    setTimer(DEFAULT_TIMER)
    persist(DEFAULT_TIMER)
  }

  const handleOppCreated = (_opp: OpportunityWithClient) => {
    setShowOppModal(false)
    setOpen(false)
    router.push('/pipeline')
    router.refresh()
  }

  const handleExpenseCreated = () => {
    setShowExpenseModal(false)
    setOpen(false)
    router.refresh()
  }

  const timerActive = timer.isRunning || timer.elapsed > 0
  const hasProjects = projects.length > 0

  // D169: read_only → no FAB
  if (role === 'read_only') return null

  return (
    <>
      {/* FAB container */}
      <div className="fixed bottom-6 right-6 z-40 flex flex-col items-end gap-2">

        {/* Timer panel (expands above FAB) */}
        {timerPanel && (
          <div className="mb-2 w-72 rounded-xl border bg-card p-4 shadow-lg space-y-3 animate-in fade-in slide-in-from-bottom-4 duration-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className={`h-4 w-4 ${timer.isRunning ? 'text-green-500 animate-pulse' : 'text-muted-foreground'}`} />
                <span className="font-mono text-lg font-bold">{formatTime(timer.elapsed)}</span>
              </div>
              <div className="flex items-center gap-1">
                {/* Timer controls */}
                {timer.isRunning ? (
                  <button
                    onClick={handleTimerPause}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-600 hover:bg-amber-200 dark:bg-amber-900/30 dark:hover:bg-amber-900/50"
                    title="Pausar"
                  >
                    <Pause className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={handleTimerStart}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/50"
                    title="Iniciar"
                  >
                    <Play className="h-3.5 w-3.5" />
                  </button>
                )}
                {timer.elapsed > 0 && (
                  <button
                    onClick={handleTimerStop}
                    disabled={saving}
                    className="flex h-7 w-7 items-center justify-center rounded-full bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 disabled:opacity-50"
                    title="Guardar y detener"
                  >
                    <Square className="h-3 w-3" />
                  </button>
                )}
                <button
                  onClick={() => setTimerPanel(false)}
                  className="ml-1 rounded p-1 hover:bg-accent"
                >
                  <X className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
            </div>

            {/* Project selector */}
            <div>
              <label className="text-xs text-muted-foreground">Proyecto</label>
              <select
                value={timer.projectId}
                onChange={e => {
                  const proj = projects.find(p => p.id === e.target.value)
                  setTimer(prev => ({
                    ...prev,
                    projectId: e.target.value,
                    projectName: proj?.name || '',
                  }))
                }}
                disabled={timer.isRunning}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
              >
                <option value="">Seleccionar...</option>
                {projects.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            {/* Category pills */}
            <div>
              <label className="text-xs text-muted-foreground">Categoría</label>
              <div className="mt-1 flex flex-wrap gap-1">
                {TIMER_CATEGORIES.map(cat => (
                  <button
                    key={cat}
                    onClick={() => setTimer(prev => ({ ...prev, category: prev.category === cat ? '' : cat }))}
                    className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                      timer.category === cat
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-muted text-muted-foreground hover:bg-accent'
                    }`}
                  >
                    {cat}
                  </button>
                ))}
              </div>
            </div>

            {/* Activity note */}
            <div>
              <label className="text-xs text-muted-foreground">Actividad (opcional)</label>
              <input
                type="text"
                value={timer.activity}
                onChange={e => setTimer(prev => ({ ...prev, activity: e.target.value }))}
                className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
                placeholder="¿Qué estás haciendo?"
              />
            </div>

            {/* Reset button */}
            {timer.elapsed > 0 && !timer.isRunning && (
              <button
                onClick={handleTimerReset}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                Descartar tiempo
              </button>
            )}
          </div>
        )}

        {/* Quick actions menu (when FAB open, no timer panel) */}
        {open && !timerPanel && (
          <div className="mb-2 space-y-2 animate-in fade-in slide-in-from-bottom-4 duration-200">
            {/* Timer action */}
            {hasProjects && (
              <button
                onClick={() => {
                  setOpen(false)
                  setTimerPanel(true)
                }}
                className="flex items-center gap-3 rounded-full border bg-background py-2.5 pl-4 pr-5 text-sm font-medium shadow-lg transition-colors hover:bg-accent"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-600 text-white">
                  <Timer className="h-4 w-4" />
                </div>
                Cronómetro
              </button>
            )}

            {/* Nueva oportunidad — only owner/admin */}
            {canCreateOpportunity && (
              <button
                onClick={() => {
                  setOpen(false)
                  setShowOppModal(true)
                }}
                className="flex items-center gap-3 rounded-full border bg-background py-2.5 pl-4 pr-5 text-sm font-medium shadow-lg transition-colors hover:bg-accent"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-primary-foreground">
                  <Funnel className="h-4 w-4" />
                </div>
                Nueva oportunidad
              </button>
            )}

            {/* Registrar gasto — owner/admin/operator */}
            {canRegisterExpense && (
              <button
                onClick={() => {
                  setOpen(false)
                  setShowExpenseModal(true)
                }}
                className="flex items-center gap-3 rounded-full border bg-background py-2.5 pl-4 pr-5 text-sm font-medium shadow-lg transition-colors hover:bg-accent"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-600 text-white">
                  <Receipt className="h-4 w-4" />
                </div>
                Registrar gasto
              </button>
            )}
          </div>
        )}

        {/* Running timer indicator (shown when timer is active and panels are closed) */}
        {timerActive && !timerPanel && !open && (
          <button
            onClick={() => setTimerPanel(true)}
            className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 shadow-lg animate-in fade-in duration-200"
          >
            <Clock className={`h-3.5 w-3.5 ${timer.isRunning ? 'text-green-500 animate-pulse' : 'text-amber-500'}`} />
            <span className="font-mono text-xs font-medium">{formatTime(timer.elapsed)}</span>
            {timer.projectName && (
              <span className="max-w-20 truncate text-[10px] text-muted-foreground">{timer.projectName}</span>
            )}
          </button>
        )}

        {/* Main FAB button */}
        <button
          onClick={() => {
            if (timerPanel) {
              setTimerPanel(false)
            } else {
              setOpen(!open)
            }
          }}
          className={`flex h-14 w-14 items-center justify-center rounded-full shadow-xl transition-all active:scale-95 ${
            timer.isRunning
              ? 'bg-green-600 text-white hover:bg-green-700 ring-4 ring-green-600/20'
              : 'bg-primary text-primary-foreground hover:bg-primary/90'
          } ${open || timerPanel ? 'rotate-45' : ''}`}
        >
          {open || timerPanel ? (
            <X className="h-6 w-6" />
          ) : timer.isRunning ? (
            <Timer className="h-6 w-6" />
          ) : (
            <Plus className="h-6 w-6" />
          )}
        </button>
      </div>

      {/* Backdrop when menu is open */}
      {(open || timerPanel) && (
        <div
          className="fixed inset-0 z-30"
          onClick={() => {
            setOpen(false)
            setTimerPanel(false)
          }}
        />
      )}

      {/* Opportunity Modal */}
      {showOppModal && (
        <OpportunityModal
          defaultStage="lead"
          onClose={() => setShowOppModal(false)}
          onCreated={handleOppCreated}
        />
      )}

      {/* Expense Modal — Sprint 4 */}
      {showExpenseModal && (
        <ExpenseModal
          onClose={() => setShowExpenseModal(false)}
          onCreated={handleExpenseCreated}
        />
      )}
    </>
  )
}
