'use client'

import { useState, useEffect, useRef, useCallback, useTransition } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { Plus, X, Flame, Receipt, Clock, Play, Square, Landmark, Banknote, FileText, Loader2, Wallet, CheckCircle, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import {
  startTimer, stopTimer, getActiveTimer, getDestinosParaTimer,
} from './timer-actions'
import { FEATURES } from '@/lib/feature-flags'
import { agregarPagoFab, getNegociosParaPagoFab, type NegocioParaPagoFab } from '@/lib/actions/fab-pago-actions'
import { consultarEpayco } from '@/lib/actions/epayco-actions'
import type { EpaycoDesglose } from '@/lib/epayco'

const VERDE = '#10B981'

// ── Types ─────────────────────────────────────────────

interface FABProps {
  role: string
  /** Muestra la acción "Registrar pago" (opt-in por workspace, flag modules.fab_registrar_pago). */
  registrarPagoEnabled?: boolean
}

interface FABAction {
  label: string
  icon: typeof Flame
  roles: string[]
  href?: string
  action?: string
  feature?: keyof typeof FEATURES
  contextAware?: boolean
  contextOnly?: boolean  // Only visible when in a project context
}

const FAB_ACTIONS: FABAction[] = [
  {
    label: 'Registrar cobro',
    icon: Banknote,
    href: '/nuevo/cobro',
    roles: ['owner', 'admin'],
  },
  {
    label: 'Registrar horas',
    icon: Clock,
    href: '/nuevo/horas',
    roles: ['owner', 'admin', 'operator', 'supervisor'],
    contextAware: true,
  },
  {
    label: 'Registrar gasto',
    icon: Receipt,
    href: '/nuevo/gasto',
    roles: ['owner', 'admin', 'operator', 'supervisor'],
    contextAware: true,
  },
  {
    label: 'Nuevo negocio',
    icon: Flame,
    href: '/negocios/nuevo',
    roles: ['owner', 'admin', 'supervisor', 'operator'],
  },
  {
    label: 'Programar cobro',
    icon: FileText,
    roles: ['owner', 'admin'],
    action: 'factura',
    contextOnly: true,
  },
  {
    label: 'Actualizar saldo',
    icon: Landmark,
    roles: ['owner', 'admin'],
    action: 'saldo',
    feature: 'CONCILIACION',
  },
]

const STORAGE_KEY = 'metrik-timer-v2'

interface TimerLocal {
  isRunning: boolean
  proyectoId: string | null
  proyectoNombre: string
  inicio: string | null
}

const DEFAULT_TIMER: TimerLocal = {
  isRunning: false,
  proyectoId: null,
  proyectoNombre: '',
  inicio: null,
}

// ── FAB Component ─────────────────────────────────────

export default function FAB({ role, registrarPagoEnabled = false }: FABProps) {
  const [open, setOpen] = useState(false)
  const [timerPanel, setTimerPanel] = useState(false)
  const [pagoModal, setPagoModal] = useState(false)
  const router = useRouter()
  const pathname = usePathname()
  const negocioContextMatch = pathname.match(/^\/negocios\/([a-f0-9-]{36})/)
  const contextNegocioId = negocioContextMatch?.[1] ?? null
  const contextEntityId = contextNegocioId

  // Timer state
  const [timer, setTimer] = useState<TimerLocal>(DEFAULT_TIMER)
  const [elapsed, setElapsed] = useState(0)
  const [projects, setProjects] = useState<{ id: string; name: string; code: string }[]>([])
  const [timerLoaded, setTimerLoaded] = useState(false)
  const [isPending, startTransition] = useTransition()
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // "Registrar pago" es opt-in por workspace (flag) y se inyecta dinámicamente.
  // Visible para roles que tocan dinero; el guard server (rolHabilitadoParaPagoFab)
  // es la barrera real — excluye operaciones pura aunque la UI lo muestre.
  const dynamicActions: FABAction[] = [
    ...(registrarPagoEnabled
      ? [{
          label: 'Registrar pago',
          icon: Wallet,
          action: 'pago',
          roles: ['owner', 'admin', 'supervisor', 'operator'],
        } as FABAction]
      : []),
  ]

  const visibleActions = [...FAB_ACTIONS, ...dynamicActions].filter(a =>
    a.roles.includes(role) &&
    (a.feature === undefined || FEATURES[a.feature]) &&
    (!a.contextOnly || contextEntityId !== null)
  )

  // ── Hydrate timer from server ──────────────────────

  useEffect(() => {
    async function hydrate() {
      const [activeTimer, destinos] = await Promise.all([
        getActiveTimer(),
        getDestinosParaTimer(),
      ])
      setProjects(destinos.negocios)

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
    if (action.action === 'pago') {
      setPagoModal(true)
    } else if (action.action === 'saldo') {
      router.push('/numeros?saldo=1')
    } else if (action.action === 'factura' && contextNegocioId) {
      router.push(`/negocios/${contextNegocioId}?action=factura`)
    } else if (action.href) {
      let href = action.href
      if (action.contextAware && contextNegocioId) {
        href = `${action.href}?negocio=${contextNegocioId}`
      }
      router.push(href)
    }
  }, [router, contextNegocioId])

  const handleOpenTimer = () => {
    setOpen(false)
    setTimerPanel(true)
  }

  const handleStartTimer = () => {
    const destinoId = timer.proyectoId
    if (!destinoId) {
      toast.error('Selecciona un negocio o proyecto primero')
      return
    }
    startTransition(async () => {
      const res = await startTimer(destinoId, 'negocio')
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
        <div className="fixed bottom-[9.5rem] right-6 z-50 w-64 rounded-2xl border bg-card p-4 shadow-xl space-y-3">
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
            value={timer.proyectoId ?? ''}
            onChange={e => {
              const proj = projects.find(p => p.id === e.target.value)
              setTimer(prev => ({ ...prev, proyectoId: e.target.value || null, proyectoNombre: proj?.name || '' }))
            }}
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          >
            <option value="">Seleccionar...</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.code ? `${p.code} · ${p.name}` : p.name}</option>
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
        <div className="fixed bottom-[9.5rem] right-6 z-50 w-56 overflow-hidden rounded-2xl border bg-card shadow-xl">
          {/* Vista simplificada cuando hay timer corriendo */}
          {timer.isRunning && timerLoaded ? (
            <>
              {/* Timer activo con proyecto */}
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <div className="h-2 w-2 shrink-0 rounded-full bg-green-500 animate-pulse" />
                <div className="min-w-0 flex-1">
                  <span className="text-xs font-mono font-semibold tabular-nums">{formatTime(elapsed)}</span>
                  <p className="truncate text-[10px] text-muted-foreground">{timer.proyectoNombre}</p>
                </div>
              </div>
              {/* Detener timer */}
              <button
                onClick={() => { handleStopTimer(); setOpen(false) }}
                disabled={isPending}
                className="flex w-full items-center gap-3 border-b px-4 py-3 text-sm font-medium text-red-600 hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors disabled:opacity-50"
              >
                <Square className="h-4 w-4 shrink-0" />
                {isPending ? 'Deteniendo...' : 'Detener timer'}
              </button>
              {/* Cancelar (cerrar menú) */}
              <button
                onClick={() => setOpen(false)}
                className="flex w-full items-center gap-3 px-4 py-3 text-sm font-medium text-muted-foreground hover:bg-accent transition-colors"
              >
                <X className="h-4 w-4 shrink-0" />
                Cancelar
              </button>
            </>
          ) : (
            <>
              {/* Timer start action (when not running) */}
              {timerLoaded && projects.length > 0 && (
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
            </>
          )}
        </div>
      )}

      {/* ── Active timer pill (above FAB — hidden when menu open) ── */}
      {timer.isRunning && timerLoaded && !open && (
        <div className="fixed bottom-[8.5rem] right-6 z-50 flex items-center gap-2 rounded-full border bg-card pl-3 pr-1.5 py-1.5 shadow-lg">
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
        className={`fixed bottom-20 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-all ${
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

      {/* ── Modal Registrar pago (FAB global, formulario aislado de captura) ── */}
      {pagoModal && (
        <RegistrarPagoModal
          onClose={() => setPagoModal(false)}
          onDone={() => { setPagoModal(false); router.refresh() }}
        />
      )}

    </>
  )
}

// ── Modal "Registrar pago" ───────────────────────────
//
// Formulario aislado de captura: selecciona negocio + fuente + referencia + valor +
// fecha. NO abre el editor de bloque de la etapa. Escribe por agregarPagoFab, que
// reusa la vía única registrarPagoEnNegocio (misma validación ePayco/duplicado/saldo).

function RegistrarPagoModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [negocios, setNegocios] = useState<NegocioParaPagoFab[]>([])
  const [loadingNegocios, setLoadingNegocios] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  const [negocioId, setNegocioId] = useState('')
  const [fuente, setFuente] = useState<'epayco' | 'davivienda' | 'otra'>('epayco')
  const [referencia, setReferencia] = useState('')
  const [monto, setMonto] = useState('')
  const [fecha, setFecha] = useState('')
  const [justificacion, setJustificacion] = useState('')
  const [needJust, setNeedJust] = useState(false)
  const [pending, startTransition] = useTransition()

  // Estado de verificacion ePayco
  const [epaycoStatus, setEpaycoStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [epaycoData, setEpaycoData] = useState<EpaycoDesglose | null>(null)
  const [epaycoError, setEpaycoError] = useState<string | null>(null)

  const esEpayco = fuente === 'epayco'

  useEffect(() => {
    let cancel = false
    getNegociosParaPagoFab().then((res) => {
      if (cancel) return
      if (res.error) setLoadError(res.error)
      else setNegocios(res.negocios)
      setLoadingNegocios(false)
    })
    return () => { cancel = true }
  }, [])

  // Debounce de verificacion ePayco
  useEffect(() => {
    if (!esEpayco || !referencia || referencia.length < 5) return

    let cancelled = false

    const timer = setTimeout(async () => {
      if (cancelled) return
      setEpaycoStatus('loading')
      const res = await consultarEpayco(referencia, true)
      if (cancelled) return
      if (res.success) {
        setEpaycoStatus('success')
        setEpaycoData(res.data)
        setMonto(String(res.data.monto_bruto))
        const fechaIso = res.data.fecha
          ? new Date(res.data.fecha).toISOString().slice(0, 10)
          : ''
        setFecha(fechaIso)
      } else {
        setEpaycoStatus('error')
        setEpaycoError(res.error)
      }
    }, 600)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [esEpayco, referencia])

  function handleSubmit() {
    if (!negocioId) return toast.error('Elige el negocio')
    if (!referencia.trim()) return toast.error('Ingresa la referencia del pago')
    if (esEpayco && epaycoStatus !== 'success') return toast.error('Verifica la referencia ePayco antes de registrar')
    if (!esEpayco && (!Number(monto) || Number(monto) <= 0)) return toast.error('Ingresa el monto del pago')

    startTransition(async () => {
      const res = await agregarPagoFab({
        negocio_id: negocioId,
        fuente,
        fuente_nombre: undefined,
        referencia: referencia.trim(),
        monto: esEpayco ? undefined : Number(monto),
        fecha: fecha || undefined,
        justificacion: needJust ? justificacion.trim() : undefined,
      })
      if (res.success) {
        toast.success('Pago registrado')
        onDone()
      } else if (res.code === 'referencia_duplicada') {
        setNeedJust(true)
        toast.error(res.error)
      } else {
        toast.error(res.error)
      }
    })
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[92vh] w-full max-w-md flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b px-5 py-3" style={{ borderColor: '#E5E7EB' }}>
          <div className="flex items-center gap-2">
            <Wallet className="h-4 w-4" style={{ color: VERDE }} />
            <h3 className="text-[15px] font-bold" style={{ color: '#1A1A1A' }}>Registrar pago</h3>
          </div>
          <button onClick={onClose} className="rounded p-1 hover:bg-gray-100"><X className="h-4 w-4" style={{ color: '#6B7280' }} /></button>
        </div>

        <div className="flex-1 space-y-3.5 overflow-y-auto px-5 py-4">
          <PagoField label="Negocio">
            {loadingNegocios ? (
              <div className="flex items-center gap-2 px-1 py-1.5 text-[13px]" style={{ color: '#6B7280' }}>
                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Cargando negocios…
              </div>
            ) : loadError ? (
              <p className="text-[12px]" style={{ color: '#DC2626' }}>{loadError}</p>
            ) : (
              <select value={negocioId} onChange={(e) => setNegocioId(e.target.value)} className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none" style={{ borderColor: '#E5E7EB' }}>
                <option value="">Elige negocio…</option>
                {negocios.map((n) => (
                  <option key={n.negocio_id} value={n.negocio_id}>
                    {(n.codigo ?? n.nombre ?? '')}{n.empresa ? ` · ${n.empresa}` : (n.nombre ? ` · ${n.nombre}` : '')}
                  </option>
                ))}
              </select>
            )}
          </PagoField>

          <PagoField label="Fuente del pago">
            <div className="grid grid-cols-1 gap-2">
              {(['epayco'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => {
                    setFuente(f)
                    setNeedJust(false)
                    setEpaycoStatus('idle')
                    setEpaycoData(null)
                    setEpaycoError(null)
                    setMonto('')
                    setFecha('')
                  }}
                  className="rounded-md border px-2 py-1.5 text-[12px] font-semibold transition"
                  style={fuente === f
                    ? { borderColor: VERDE, color: VERDE, backgroundColor: '#ECFDF5' }
                    : { borderColor: '#E5E7EB', color: '#6B7280' }}
                >
                  ePayco
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px]" style={{ color: '#9CA3AF' }}>Los comerciales registran solo pagos por ePayco.</p>
          </PagoField>

          <PagoField label={esEpayco ? 'Referencia ePayco (ref_payco)' : 'Referencia / comprobante'}>
            <div className="relative">
              <input
                value={referencia}
                onChange={(e) => {
                const val = esEpayco ? e.target.value.replace(/[^\d]/g, '') : e.target.value
                setReferencia(val)
                if (esEpayco) {
                  setEpaycoStatus('idle')
                  setEpaycoData(null)
                  setEpaycoError(null)
                }
              }}
                inputMode={esEpayco ? 'numeric' : 'text'}
                placeholder={esEpayco ? 'ej. 123456789' : 'ej. comprobante o nº de transacción'}
                className="w-full rounded-md border px-2.5 py-1.5 pr-8 text-[13px] outline-none"
                style={{ borderColor: epaycoStatus === 'success' ? VERDE : epaycoStatus === 'error' ? '#DC2626' : '#E5E7EB' }}
              />
              {esEpayco && epaycoStatus === 'loading' && (
                <Loader2 className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin" style={{ color: '#9CA3AF' }} />
              )}
              {esEpayco && epaycoStatus === 'success' && (
                <CheckCircle className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: VERDE }} />
              )}
              {esEpayco && epaycoStatus === 'error' && (
                <XCircle className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2" style={{ color: '#DC2626' }} />
              )}
            </div>
            {esEpayco && epaycoStatus === 'idle' && (
              <p className="mt-1 text-[11px]" style={{ color: '#9CA3AF' }}>Se valida con ePayco: solo se registra si está Aceptada.</p>
            )}
            {esEpayco && epaycoStatus === 'error' && epaycoError && (
              <p className="mt-1 text-[11px]" style={{ color: '#DC2626' }}>{epaycoError}</p>
            )}
            {esEpayco && epaycoStatus === 'success' && (
              <p className="mt-1 text-[11px] font-medium" style={{ color: VERDE }}>Transaccion ePayco verificada</p>
            )}
          </PagoField>

          {esEpayco && epaycoStatus === 'success' && epaycoData && (
            <div className="grid grid-cols-2 gap-3">
              <PagoField label="Valor (ePayco)">
                <input
                  value={Number(monto).toLocaleString('es-CO')}
                  readOnly
                  className="w-full rounded-md border px-2.5 py-1.5 text-right text-[13px] tabular-nums outline-none"
                  style={{ borderColor: VERDE, backgroundColor: '#ECFDF5', color: '#065F46' }}
                />
              </PagoField>
              <PagoField label="Fecha (ePayco)">
                <input
                  value={fecha}
                  readOnly
                  className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none"
                  style={{ borderColor: VERDE, backgroundColor: '#ECFDF5', color: '#065F46' }}
                />
              </PagoField>
            </div>
          )}

          {!esEpayco && (
            <div className="grid grid-cols-2 gap-3">
              <PagoField label="Valor">
                <input value={monto} onChange={(e) => setMonto(e.target.value.replace(/[^\d]/g, ''))} inputMode="numeric" placeholder="0" className="w-full rounded-md border px-2.5 py-1.5 text-right text-[13px] tabular-nums outline-none" style={{ borderColor: '#E5E7EB' }} />
              </PagoField>
              <PagoField label="Fecha">
                <input type="date" value={fecha} onChange={(e) => setFecha(e.target.value)} className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none" style={{ borderColor: '#E5E7EB' }} />
              </PagoField>
            </div>
          )}

          {needJust && (
            <PagoField label="Justificación (referencia duplicada)">
              <textarea value={justificacion} onChange={(e) => setJustificacion(e.target.value)} rows={2} placeholder="Explica por qué registrar esta referencia que ya existe…" className="w-full rounded-md border px-2.5 py-1.5 text-[13px] outline-none" style={{ borderColor: '#F59E0B' }} />
            </PagoField>
          )}
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t px-5 py-3" style={{ borderColor: '#E5E7EB' }}>
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-[13px] font-semibold" style={{ color: '#6B7280' }}>Cancelar</button>
          <button onClick={handleSubmit} disabled={pending || loadingNegocios || (esEpayco && epaycoStatus !== 'success')} className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-semibold text-white shadow-sm transition hover:opacity-90 disabled:opacity-50" style={{ backgroundColor: VERDE }}>
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wallet className="h-4 w-4" />}
            Registrar pago
          </button>
        </div>
      </div>
    </div>
  )
}

function PagoField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-semibold" style={{ color: '#374151' }}>{label}</span>
      {children}
    </label>
  )
}
