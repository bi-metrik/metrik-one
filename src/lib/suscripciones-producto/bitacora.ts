import { registrarActividad } from '@/lib/activity/registrar-actividad'
import type { Ancla } from './ancla'

/**
 * Deja una línea en la historia del cliente de un contrato, sea cual sea su ancla:
 *   - negocio → su timeline (`activity_log`, `entidad_tipo = 'negocio'`), como siempre;
 *   - suscripción → su bitácora (`suscripciones_producto_eventos`): `activity_log` no admite otra
 *     entidad en su CHECK y la suscripción no está en el CRM.
 *
 * Mismo contrato que `registrarActividad`: nunca lanza (el pago ya quedó, la anotación no lo tumba) y
 * nunca calla (el rechazo va a `console.error`). Sin `server-only`: lo usan módulos que las pruebas
 * importan directo; no toca secretos, recibe el cliente.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export async function anotarEnAncla(
  db: unknown,
  p: {
    ancla: Ancla | null
    workspaceId: string
    texto: string
    tipo?: string
    datos?: Record<string, unknown>
    /** Solo para el timeline de un negocio: `activity_log.autor_id` es FK a `staff(id)`. */
    autorStaffId?: string | null
    /** Solo para la bitácora de una suscripción: `autor_id` es FK a `profiles(id)`. */
    autorPerfilId?: string | null
  },
  origen: string,
): Promise<void> {
  if (!p.ancla) return
  if (p.ancla.tipo === 'negocio') {
    await registrarActividad(
      db,
      {
        workspace_id: p.workspaceId,
        entidad_tipo: 'negocio',
        entidad_id: p.ancla.id,
        tipo: 'sistema',
        autor_id: p.autorStaffId ?? null,
        // `activity_log.contenido` tiene CHECK de 280 caracteres.
        contenido: p.texto.slice(0, 280),
      },
      origen,
    )
    return
  }
  try {
    const { error } = await (db as Db).from('suscripciones_producto_eventos').insert({
      suscripcion_id: p.ancla.id,
      workspace_id: p.workspaceId,
      tipo: p.tipo ?? 'sistema',
      detalle: p.texto.slice(0, 1000),
      datos: p.datos ?? {},
      origen,
      autor_id: p.autorPerfilId ?? null,
    })
    if (error) console.error(`[${origen}] bitácora de la suscripción ${p.ancla.id}:`, error.message)
  } catch (e) {
    console.error(`[${origen}] bitácora de la suscripción ${p.ancla.id}:`, e instanceof Error ? e.message : e)
  }
}
