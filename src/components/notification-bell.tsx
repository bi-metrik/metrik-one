'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Check, X, CheckCheck, Flame, FolderKanban, AtSign, TrendingDown, UserPlus, UserCheck, Package, CircleDollarSign } from 'lucide-react'
import { LoadingSpinner } from '@/components/ui/loading-spinner'
import { createClient } from '@/lib/supabase/client'
import {
  getNotificaciones,
  marcarCompletada,
  descartarNotificacion,
  marcarTodasCompletadas,
  type NotificacionItem,
} from '@/lib/actions/notificaciones'

// ── Helpers ───────────────────────────────────────────

function tiempoRelativo(fechaIso: string): string {
  const ahora = Date.now()
  const fecha = new Date(fechaIso).getTime()
  const diff = Math.floor((ahora - fecha) / 1000)

  if (diff < 60) return 'Ahora'
  if (diff < 3600) return `Hace ${Math.floor(diff / 60)} min`
  if (diff < 86400) return `Hace ${Math.floor(diff / 3600)} h`
  if (diff < 172800) return 'Ayer'
  return `Hace ${Math.floor(diff / 86400)} d`
}

// Mapas indexados por string (no por NotificacionTipo): la DB puede traer tipos
// que el front todavía no conoce y el acceso siempre cae al default. Un tipo
// nuevo pierde su ícono propio, jamás rompe el render de la lista.
const TIPO_ICON: Record<string, React.ElementType> = {
  inactividad_oportunidad: Flame,
  handoff: Package,
  asignacion_responsable: UserCheck,
  asignacion_colaborador: UserPlus,
  mencion: AtSign,
  streak_roto: TrendingDown,
  inactividad_proyecto: FolderKanban,
  proyecto_entregado: FolderKanban,
  proyecto_cerrado: FolderKanban,
  responsable_faltante_area: UserPlus,
  cobro_vencido: CircleDollarSign,
  cuenta_cobro_pendiente_aprobacion: CircleDollarSign,
}

const TIPO_COLOR: Record<string, string> = {
  inactividad_oportunidad: '#F59E0B',
  handoff: '#8B5CF6',
  asignacion_responsable: '#10B981',
  asignacion_colaborador: '#10B981',
  mencion: '#3B82F6',
  streak_roto: '#EF4444',
  inactividad_proyecto: '#F59E0B',
  proyecto_entregado: '#10B981',
  proyecto_cerrado: '#6B7280',
  responsable_faltante_area: '#F59E0B',
  cobro_vencido: '#EF4444',
  cuenta_cobro_pendiente_aprobacion: '#8B5CF6',
}

// ── Componente principal ──────────────────────────────

interface NotificationBellProps {
  userId: string
  /**
   * Notificaciones pendientes resueltas en el server (layout). Sin esto la campana
   * arrancaba SIEMPRE en cero y solo cargaba al abrir el panel: el badge no
   * anunciaba nada y el usuario tenía que hacer clic para que aparecieran.
   */
  initialItems?: NotificacionItem[]
  /** Total real de pendientes (puede superar lo cargado: la consulta pagina). */
  initialTotal?: number
}

export default function NotificationBell({ userId, initialItems, initialTotal }: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificacionItem[]>(initialItems ?? [])
  const [total, setTotal] = useState(initialTotal ?? initialItems?.length ?? 0)
  const [loading, setLoading] = useState(false)
  const [cargandoMas, setCargandoMas] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Cargar notificaciones
  const cargar = useCallback(async () => {
    setLoading(true)
    const { items: data, total: t } = await getNotificaciones()
    setItems(data)
    setTotal(t)
    setLoading(false)
  }, [])

  // Traer la siguiente página. Con backlog alto (hay usuarios con 68 pendientes)
  // las más viejas quedaban fuera del corte y eran invisibles.
  const cargarMas = useCallback(async () => {
    setCargandoMas(true)
    const { items: data, total: t } = await getNotificaciones(items.length)
    setItems(prev => {
      const vistos = new Set(prev.map(n => n.id))
      return [...prev, ...data.filter(n => !vistos.has(n.id))]
    })
    setTotal(t)
    setCargandoMas(false)
  }, [items.length])

  // Abrir panel carga datos
  useEffect(() => {
    if (open) {
      cargar()
    }
  }, [open, cargar])

  // Refresco al volver a la pestaña. Respaldo del realtime: si el canal se cayó
  // (o la tabla no está en la publicación), el conteo igual se pone al día
  // cuando el usuario regresa, sin polling permanente.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') cargar()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [cargar])

  // Supabase Realtime: escuchar cambios en notificaciones del usuario.
  //
  // ⚠️ El canal SE RINDE tras unos intentos, a propósito. Si el WebSocket no
  // conecta, la librería reintenta con backoff PARA SIEMPRE: es trabajo constante
  // en el navegador de un usuario que dejó la pestaña abierta toda la jornada, y
  // es el mejor candidato a los reportes de "la aplicación se pega y toca
  // actualizar". Medido el 2026-08-01 en producción: 17.007 rechazos 401 en 24 h,
  // cero conexiones exitosas, con la aplicación en uso normal.
  //
  // Rendirse NO deja la campana desactualizada: el efecto de `visibilitychange`
  // de arriba recarga el conteo cada vez que el usuario vuelve a la pestaña, y el
  // contador inicial llega resuelto desde el servidor. Se pierde el aviso
  // instantáneo mientras la pestaña está al frente, nada más.
  useEffect(() => {
    const supabase = createClient()
    const MAX_FALLOS = 3
    let fallos = 0
    let rendido = false
    let suscrito = false

    // La referencia se declara antes del `subscribe` porque su callback puede
    // dispararse de forma síncrona: leer `channel` desde `rendirse` antes de que
    // exista rompería con "used before its declaration".
    let canal: ReturnType<typeof supabase.channel> | null = null

    const rendirse = (motivo: string) => {
      if (rendido) return
      rendido = true
      console.warn(`[notificaciones] realtime deja de reintentar: ${motivo}`)
      // Al quitar el último canal, la librería cierra el socket (RealtimeClient
      // .removeChannel llama a disconnect cuando no quedan canales) → se acaba el
      // bucle de reconexión, no solo la suscripción.
      if (canal) supabase.removeChannel(canal)
    }

    canal = supabase
      .channel('notificaciones-realtime')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notificaciones',
          filter: `destinatario_id=eq.${userId}`,
        },
        (payload) => {
          const nueva = payload.new as NotificacionItem
          // Dedup por id: la misma notificación puede llegar por realtime y por
          // un `cargar()` concurrente (apertura del panel o vuelta a la pestaña).
          setItems(prev => (prev.some(n => n.id === nueva.id) ? prev : [nueva, ...prev]))
        }
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          suscrito = true
          fallos = 0
          return
        }
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          fallos += 1
          if (fallos >= MAX_FALLOS) rendirse(`${fallos} intentos fallidos (${status})`)
        }
      })

    // Red de seguridad: si el socket ni siquiera llega a abrirse, el callback de
    // arriba puede no dispararse nunca y el bucle quedaría vivo igual.
    const plazo = setTimeout(() => {
      if (!suscrito) rendirse('no conectó dentro del plazo')
    }, 30_000)

    return () => {
      clearTimeout(plazo)
      rendido = true
      if (canal) supabase.removeChannel(canal)
    }
  }, [userId])

  // Cerrar al hacer click fuera
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const pendientes = items.filter(n => n.estado === 'pendiente')
  // El badge muestra el total del server, no lo que alcanzó a cargarse: con
  // backlog alto la primera página no es todo. Si el realtime trajo algo nuevo
  // que aún no cuenta el total, gana lo cargado.
  const count = Math.max(total, pendientes.length)
  const hayMas = pendientes.length < total

  // Acciones
  async function handleCompletar(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setItems(prev => prev.filter(n => n.id !== id))
    setTotal(t => Math.max(0, t - 1))
    await marcarCompletada(id)
  }

  async function handleDescartar(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setItems(prev => prev.filter(n => n.id !== id))
    setTotal(t => Math.max(0, t - 1))
    await descartarNotificacion(id)
  }

  async function handleMarcarTodas() {
    setItems([])
    setTotal(0)
    await marcarTodasCompletadas()
  }

  function handleClick(item: NotificacionItem) {
    if (item.deep_link) {
      setOpen(false)
      router.push(item.deep_link)
    }
    // Marcar como completada al hacer click en la notificación
    marcarCompletada(item.id)
    setItems(prev => prev.filter(n => n.id !== item.id))
    setTotal(t => Math.max(0, t - 1))
  }

  return (
    <div className="relative" ref={panelRef}>
      {/* Botón campana */}
      <button
        onClick={() => setOpen(!open)}
        className="relative flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent"
        aria-label="Notificaciones"
      >
        <Bell className="h-4 w-4 text-muted-foreground" />
        {count > 0 && (
          <span
            className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white"
            style={{ backgroundColor: '#10B981' }}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {/* Overlay móvil */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/30 sm:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Panel: full-screen en móvil, dropdown en sm+ */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-card sm:absolute sm:inset-auto sm:right-0 sm:top-10 sm:w-[360px] sm:max-h-[480px] sm:rounded-xl sm:border sm:border-border sm:shadow-xl overflow-hidden"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold text-foreground">Notificaciones</span>
              {count > 0 && (
                <span
                  className="flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold text-white"
                  style={{ backgroundColor: '#10B981' }}
                >
                  {count}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {count > 0 && (
                <button
                  onClick={handleMarcarTodas}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
                >
                  <CheckCheck className="h-3 w-3" />
                  Marcar todas
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                aria-label="Cerrar"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {/* Lista */}
          <div className="flex-1 overflow-y-auto">
            {loading && (
              <div className="py-8">
                <LoadingSpinner size="sm" />
              </div>
            )}

            {!loading && pendientes.length === 0 && (
              <div className="flex flex-col items-center justify-center py-10 px-4">
                <Bell className="h-8 w-8 text-muted-foreground/40 mb-2" />
                <p className="text-sm font-medium text-muted-foreground">Sin notificaciones pendientes</p>
                <p className="text-xs text-muted-foreground/60 mt-1">Estás al dia con todo</p>
              </div>
            )}

            {!loading && pendientes.map((item) => {
              const Icon = TIPO_ICON[item.tipo] ?? Bell
              const color = TIPO_COLOR[item.tipo] ?? '#6B7280'

              return (
                <div
                  key={item.id}
                  onClick={() => handleClick(item)}
                  className={`flex items-start gap-3 px-4 py-3 border-b border-border/50 transition-colors last:border-0 ${
                    item.deep_link ? 'cursor-pointer hover:bg-accent/40' : ''
                  }`}
                >
                  {/* Icono tipo */}
                  <div
                    className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full"
                    style={{ backgroundColor: color + '15' }}
                  >
                    <Icon className="h-3.5 w-3.5" style={{ color }} />
                  </div>

                  {/* Contenido */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-foreground leading-snug">
                      {item.contenido}
                    </p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">
                      {tiempoRelativo(item.created_at)}
                    </p>
                  </div>

                  {/* Acciones */}
                  <div className="flex shrink-0 items-center gap-1 ml-1">
                    <button
                      onClick={(e) => handleCompletar(item.id, e)}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-emerald-100 hover:text-emerald-600"
                      title="Marcar como completada"
                    >
                      <Check className="h-3 w-3" />
                    </button>
                    <button
                      onClick={(e) => handleDescartar(item.id, e)}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-100 hover:text-red-500"
                      title="Descartar"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              )
            })}

            {!loading && hayMas && (
              <button
                onClick={cargarMas}
                disabled={cargandoMas}
                className="w-full py-3 text-[12px] font-medium text-muted-foreground transition-colors hover:bg-accent/40 hover:text-foreground disabled:opacity-50"
              >
                {cargandoMas
                  ? 'Cargando…'
                  : `Ver ${total - pendientes.length} más`}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
