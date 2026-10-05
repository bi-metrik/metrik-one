import type { NotificacionesPagina } from '@/lib/actions/notificaciones'
import { pedirJson } from '@/lib/negocios/paginas-lista'

/**
 * Las pendientes, por `GET /api/notificaciones` (ETag). Antes era la server action
 * `getNotificaciones`: Next pone las server actions en fila, y esta lectura (6.136 en 7
 * días, medido 2026-10-05) retrasaba la acción real que la persona hacía después. Sin
 * sesión, `pedirJson` recarga la página para que la tome el flujo de login.
 */
export function leerNotificaciones(desde = 0): Promise<NotificacionesPagina> {
  return pedirJson<NotificacionesPagina>(`/api/notificaciones?desde=${desde}`, undefined, undefined, 'no-cache')
}

/**
 * Al volver a la pestaña la campana se pone al día, pero no más de una vez por minuto:
 * en el celular se entra y se sale de la app a cada rato. Abrir el panel siempre lee.
 */
export const REFRESCO_MINIMO_AL_VOLVER_MS = 60_000
