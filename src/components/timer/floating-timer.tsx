'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, Square, Clock, ChevronDown, X, Check } from 'lucide-react'
import { toast } from 'sonner'
import { saveTimerEntry, getActiveProjects } from '@/app/(app)/timer-actions'

const TIMER_CATEGORIES = [
  'Diseño', 'Desarrollo', 'Reunión', 'Planeación',
  'Revisión', 'Administrativo', 'Soporte', 'Investigación',
  'Contenido', 'Otro',
]

const STORAGE_KEY = 'metrik-timer'

interface TimerState {
  isRunning: boolean
  elapsed: number // seconds
  projectId: string
  projectName: string
  category: string
  activity: string
  startedAt: string | null
}

const DEFAULT_STATE: TimerState = {
  isRunning: false,
  elapsed: 0,
  projectId: '',
  projectName: '',
  category: '',
  activity: '',
  startedAt: null,
}

export default function FloatingTimer() {
  const [state, setState] = useState<TimerState>(DEFAULT_STATE)
  const [expanded, setExpanded] = useState(false)
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load state from localStorage on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const parsed = JSON.parse(saved) as TimerState
        // If it was running, calculate elapsed from startedAt
        if (parsed.isRunning && parsed.startedAt) {
          const elapsed = Math.floor((Date.now() - new Date(parsed.startedAt).getTime()) / 1000)
          setState({ ...parsed, elapsed })
        } else {
          setState(parsed)
        }
      }
    } catch {
      // ignore
    }
  }, [])

  // Load projects
  useEffect(() => {
    getActiveProjects().then(setProjects)
  }, [])

  // Persist to localStorage
  const persist = useCallback((s: TimerState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    } catch {
      // ignore
    }
  }, [])

  // Timer tick
  useEffect(() => {
    if (state.isRunning) {
      intervalRef.current = setInterval(() => {
        setState(prev => {
          const next = { ...prev, elapsed: prev.elapsed + 1 }
          return next
        })
      }, 1000)
    } else {
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [state.isRunning])

  // Persist on state change
  useEffect(() => {
    persist(state)
  }, [state, persist])

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const handleStart = () => {
    if (!state.projectId) {
      toast.error('Selecciona un proyecto primero')
      setExpanded(true)
      return
    }
    setState(prev => ({
      ...prev,
      isRunning: true,
      startedAt: prev.startedAt || new Date().toISOString(),
    }))
  }

  const handlePause = () => {
    setState(prev => ({ ...prev, isRunning: false }))
  }

  const handleStop = async () => {
    if (state.elapsed < 60) {
      toast.error('Mínimo 1 minuto para registrar')
      return
    }

    setSaving(true)
    const hours = Math.round((state.elapsed / 3600) * 100) / 100 // 2 decimals

    const res = await saveTimerEntry({
      project_id: state.projectId,
      hours,
      activity: state.activity || undefined,
      category: state.category || undefined,
      start_time: state.startedAt || undefined,
      end_time: new Date().toISOString(),
    })

    if (res.success) {
      toast.success(`${hours}h registradas en ${state.projectName}`)
      setState(DEFAULT_STATE)
      persist(DEFAULT_STATE)
    } else {
      toast.error(res.error)
    }
    setSaving(false)
  }

  const handleReset = () => {
    setState(DEFAULT_STATE)
    persist(DEFAULT_STATE)
  }

  // If no projects, don't show timer
  if (projects.length === 0 && !state.isRunning) return null

  return (
    <div className="fixed bottom-20 right-4 z-40 md:bottom-6">
      {/* Expanded panel */}
      {expanded && (
        <div className="mb-2 w-72 rounded-xl border bg-card p-4 shadow-lg space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium">Timer</p>
            <button onClick={() => setExpanded(false)} className="rounded p-1 hover:bg-accent">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          {/* Project selector */}
          <div>
            <label className="text-xs text-muted-foreground">Proyecto</label>
            <select
              value={state.projectId}
              onChange={e => {
                const proj = projects.find(p => p.id === e.target.value)
                setState(prev => ({
                  ...prev,
                  projectId: e.target.value,
                  projectName: proj?.name || '',
                }))
              }}
              disabled={state.isRunning}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm disabled:opacity-50"
            >
              <option value="">Seleccionar...</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Category */}
          <div>
            <label className="text-xs text-muted-foreground">Categoría</label>
            <div className="mt-1 flex flex-wrap gap-1">
              {TIMER_CATEGORIES.map(cat => (
                <button
                  key={cat}
                  onClick={() => setState(prev => ({ ...prev, category: prev.category === cat ? '' : cat }))}
                  className={`rounded-full px-2 py-0.5 text-[10px] font-medium transition-colors ${
                    state.category === cat
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
              value={state.activity}
              onChange={e => setState(prev => ({ ...prev, activity: e.target.value }))}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
              placeholder="¿Qué estás haciendo?"
            />
          </div>
        </div>
      )}

      {/* Timer button */}
      <div className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 shadow-lg">
        {/* Timer display */}
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-2 text-sm font-mono font-medium"
        >
          <Clock className={`h-4 w-4 ${state.isRunning ? 'text-green-500 animate-pulse' : 'text-muted-foreground'}`} />
          {formatTime(state.elapsed)}
        </button>

        {/* Project name */}
        {state.projectName && (
          <span className="max-w-24 truncate text-xs text-muted-foreground">
            {state.projectName}
          </span>
        )}

        {/* Controls */}
        <div className="flex gap-1 ml-1">
          {state.isRunning ? (
            <button
              onClick={handlePause}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-amber-100 text-amber-600 hover:bg-amber-200 dark:bg-amber-900/30 dark:hover:bg-amber-900/50"
            >
              <Pause className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              onClick={handleStart}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-green-100 text-green-600 hover:bg-green-200 dark:bg-green-900/30 dark:hover:bg-green-900/50"
            >
              <Play className="h-3.5 w-3.5" />
            </button>
          )}
          {state.elapsed > 0 && (
            <button
              onClick={handleStop}
              disabled={saving}
              className="flex h-7 w-7 items-center justify-center rounded-full bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 disabled:opacity-50"
            >
              <Square className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
