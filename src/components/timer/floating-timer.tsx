'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Play, Pause, Square, Clock, X } from 'lucide-react'
import { toast } from 'sonner'
import {
  startTimer, stopTimer, getActiveTimer, getProyectosActivos,
  type ActiveTimer,
} from '@/app/(app)/timer-actions'

const STORAGE_KEY = 'metrik-timer-v2'

interface LocalState {
  isRunning: boolean
  proyectoId: string
  proyectoNombre: string
  inicio: string | null
}

const DEFAULT_STATE: LocalState = {
  isRunning: false,
  proyectoId: '',
  proyectoNombre: '',
  inicio: null,
}

export default function FloatingTimer() {
  const [state, setState] = useState<LocalState>(DEFAULT_STATE)
  const [elapsed, setElapsed] = useState(0)
  const [expanded, setExpanded] = useState(false)
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [saving, setSaving] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ── Hydrate from server (source of truth) ──────────────

  useEffect(() => {
    async function hydrate() {
      const [timer, projs] = await Promise.all([
        getActiveTimer(),
        getProyectosActivos(),
      ])
      setProjects(projs)

      if (timer) {
        const s: LocalState = {
          isRunning: true,
          proyectoId: timer.proyecto_id,
          proyectoNombre: timer.proyecto_nombre,
          inicio: timer.inicio,
        }
        setState(s)
        persist(s)
      } else {
        // Check localStorage for any stale state
        try {
          const saved = localStorage.getItem(STORAGE_KEY)
          if (saved) {
            const parsed = JSON.parse(saved) as LocalState
            if (parsed.isRunning) {
              // Timer was running locally but not on server — it was stopped elsewhere
              localStorage.removeItem(STORAGE_KEY)
            }
          }
        } catch { /* ignore */ }
      }
      setLoaded(true)
    }
    hydrate()
  }, [])

  // ── Listen for FAB "open timer" event ──────────────────

  useEffect(() => {
    const handler = () => setExpanded(true)
    window.addEventListener('metrik-timer-open', handler)
    return () => window.removeEventListener('metrik-timer-open', handler)
  }, [])

  // ── Persist to localStorage ────────────────────────────

  const persist = useCallback((s: LocalState) => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
    } catch { /* ignore */ }
  }, [])

  // ── Timer tick ─────────────────────────────────────────

  useEffect(() => {
    if (state.isRunning && state.inicio) {
      // Calculate current elapsed
      const calcElapsed = () => Math.floor((Date.now() - new Date(state.inicio!).getTime()) / 1000)
      setElapsed(calcElapsed())

      intervalRef.current = setInterval(() => {
        setElapsed(calcElapsed())
      }, 1000)
    } else {
      setElapsed(0)
      if (intervalRef.current) {
        clearInterval(intervalRef.current)
        intervalRef.current = null
      }
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [state.isRunning, state.inicio])

  // ── Helpers ────────────────────────────────────────────

  const formatTime = (seconds: number) => {
    const h = Math.floor(seconds / 3600)
    const m = Math.floor((seconds % 3600) / 60)
    const s = seconds % 60
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
  }

  const handleStart = async () => {
    if (!state.proyectoId) {
      toast.error('Selecciona un proyecto primero')
      setExpanded(true)
      return
    }
    setSaving(true)
    const res = await startTimer(state.proyectoId)
    if (res.success && res.timer) {
      const s: LocalState = {
        isRunning: true,
        proyectoId: res.timer.proyecto_id,
        proyectoNombre: res.timer.proyecto_nombre,
        inicio: res.timer.inicio,
      }
      setState(s)
      persist(s)
      toast.success(`Timer iniciado: ${res.timer.proyecto_nombre}`)
    } else {
      toast.error(res.error ?? 'Error al iniciar timer')
    }
    setSaving(false)
  }

  const handleStop = async () => {
    setSaving(true)
    const res = await stopTimer()
    if (res.success) {
      if (res.descartado) {
        toast.info('Timer descartado (menos de 1 minuto)')
      } else {
        toast.success(`${res.horasRegistradas}h registradas en ${state.proyectoNombre}`)
      }
      setState(DEFAULT_STATE)
      persist(DEFAULT_STATE)
    } else {
      toast.error(res.error ?? 'Error al detener timer')
    }
    setSaving(false)
  }

  // Don't show anything until we've hydrated
  if (!loaded) return null

  // Don't show if no projects and no timer running
  if (projects.length === 0 && !state.isRunning) return null

  return (
    <div className="fixed bottom-20 right-4 z-40 md:bottom-6 md:right-24">
      {/* Expanded panel */}
      {expanded && !state.isRunning && (
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
              value={state.proyectoId}
              onChange={e => {
                const proj = projects.find(p => p.id === e.target.value)
                setState(prev => ({
                  ...prev,
                  proyectoId: e.target.value,
                  proyectoNombre: proj?.name || '',
                }))
              }}
              className="mt-1 w-full rounded-md border bg-background px-2 py-1.5 text-sm"
            >
              <option value="">Seleccionar...</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>

          {/* Start button */}
          <button
            onClick={handleStart}
            disabled={!state.proyectoId || saving}
            className="w-full rounded-lg bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            {saving ? 'Iniciando...' : 'Iniciar timer'}
          </button>
        </div>
      )}

      {/* Timer pill (visible when running or collapsed) */}
      {state.isRunning ? (
        <div className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 shadow-lg">
          <Clock className="h-4 w-4 text-green-500 animate-pulse" />
          <span className="text-sm font-mono font-medium">{formatTime(elapsed)}</span>
          {state.proyectoNombre && (
            <span className="max-w-24 truncate text-xs text-muted-foreground">
              {state.proyectoNombre}
            </span>
          )}
          <button
            onClick={handleStop}
            disabled={saving}
            className="flex h-7 w-7 items-center justify-center rounded-full bg-red-100 text-red-600 hover:bg-red-200 dark:bg-red-900/30 dark:hover:bg-red-900/50 disabled:opacity-50"
          >
            <Square className="h-3 w-3" />
          </button>
        </div>
      ) : (
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex h-10 w-10 items-center justify-center rounded-full border bg-card shadow-lg hover:bg-accent transition-colors"
          title="Abrir timer"
        >
          <Clock className="h-4 w-4 text-muted-foreground" />
        </button>
      )}
    </div>
  )
}
