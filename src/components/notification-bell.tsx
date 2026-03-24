'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, Check, X, CheckCheck, Flame, FolderKanban, AtSign, TrendingDown, UserPlus, UserCheck, Package } from 'lucide-react'
import { createClient } from '@/lib/supabase/client'
import {
  getNotificaciones,
  marcarCompletada,
  descartarNotificacion,
  marcarTodasCompletadas,
  type NotificacionItem,
  type NotificacionTipo,
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

const TIPO_ICON: Record<NotificacionTipo, React.ElementType> = {
  inactividad_oportunidad: Flame,
  handoff: Package,
  asignacion_responsable: UserCheck,
  asignacion_colaborador: UserPlus,
  mencion: AtSign,
  streak_roto: TrendingDown,
  inactividad_proyecto: FolderKanban,
  proyecto_entregado: FolderKanban,
  proyecto_cerrado: FolderKanban,
}

const TIPO_COLOR: Record<NotificacionTipo, string> = {
  inactividad_oportunidad: '#F59E0B',
  handoff: '#8B5CF6',
  asignacion_responsable: '#10B981',
  asignacion_colaborador: '#10B981',
  mencion: '#3B82F6',
  streak_roto: '#EF4444',
  inactividad_proyecto: '#F59E0B',
  proyecto_entregado: '#10B981',
  proyecto_cerrado: '#6B7280',
}

// ── Componente principal ──────────────────────────────

interface NotificationBellProps {
  userId: string
}

export default function NotificationBell({ userId }: NotificationBellProps) {
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<NotificacionItem[]>([])
  const [loading, setLoading] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const router = useRouter()

  // Cargar notificaciones
  const cargar = useCallback(async () => {
    setLoading(true)
    const data = await getNotificaciones()
    setItems(data)
    setLoading(false)
  }, [])

  // Abrir panel carga datos
  useEffect(() => {
    if (open) {
      cargar()
    }
  }, [open, cargar])

  // Supabase Realtime: escuchar cambios en notificaciones del usuario
  useEffect(() => {
    const supabase = createClient()

    const channel = supabase
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
          setItems(prev => [nueva, ...prev])
        }
      )
      .subscribe()

    return () => {
      supabase.removeChannel(channel)
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
  const count = pendientes.length

  // Acciones
  async function handleCompletar(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setItems(prev => prev.filter(n => n.id !== id))
    await marcarCompletada(id)
  }

  async function handleDescartar(id: string, e: React.MouseEvent) {
    e.stopPropagation()
    setItems(prev => prev.filter(n => n.id !== id))
    await descartarNotificacion(id)
  }

  async function handleMarcarTodas() {
    setItems([])
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
              <div className="flex items-center justify-center py-8">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-muted border-t-foreground" />
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
          </div>
        </div>
      )}
    </div>
  )
}
