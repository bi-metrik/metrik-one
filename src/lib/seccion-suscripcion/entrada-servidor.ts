import 'server-only'
import { cache } from 'react'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { todayBogotaISO } from '@/lib/dates/bogota'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { esFuncionAusente } from '@/lib/valida-api/mapeo'
import { entradaValidaCda, type EntradaValidaCda } from '@/lib/valida-cda/puerta'
import { contratoOnePagado, type FilaMisServicios } from './contrato-one'

/**
 * La entrada de `/suscripcion`: de qué contrato habla la sección y por qué puerta se llegó.
 *
 *   - `valida_cda`: un CDA que paga su contrato de Valida. Es la puerta de siempre
 *     (`entradaValidaCda`), sin un cambio: los términos del Plan CDA, su plazo y su mora.
 *   - `one`: un cliente de Clarity que paga su licencia de ONE por cuotas (`contrato-one.ts`). No
 *     pasa por la puerta de Valida porque no tiene Valida.
 *
 * ## Los términos en un contrato `one`
 *
 * La ficha `licencia-clarity` cita `terminos-adhesion-one@1.0`, pero ese documento NO está publicado
 * en `documentos_contractuales_versiones` (medido el 2026-10-05) y la única pantalla que registra una
 * aceptación es la de Valida. Así que un contrato `one` entra con los términos en `aprobada`, que
 * aquí significa «no hay términos que aceptar en la plataforma»: ni pausa ni bloquea la pestaña Pagos.
 * El día que se publique un documento para Clarity, esta es la línea que hay que cambiar.
 *
 * ## Fail-closed
 *
 * Igual que la puerta de Valida: una lectura caída es `no_disponible`, nunca «sin contrato».
 */

export type ProductoSuscripcion = 'valida_cda' | 'one'

export type EntradaOk = Extract<EntradaValidaCda, { tipo: 'ok' }> & { servicioContratadoId: string }

export type EntradaSuscripcion =
  | { tipo: 'no_aplica' }
  | { tipo: 'no_disponible' }
  | { tipo: 'ok'; producto: ProductoSuscripcion; entrada: EntradaOk }

async function resolver(): Promise<EntradaSuscripcion> {
  const valida = await entradaValidaCda()
  if (valida.tipo === 'no_disponible') return { tipo: 'no_disponible' }
  if (valida.tipo === 'ok' && valida.estado.estado === 'no_disponible') return { tipo: 'no_disponible' }
  if (valida.tipo === 'ok' && valida.servicioContratadoId) {
    return { tipo: 'ok', producto: 'valida_cda', entrada: { ...valida, servicioContratadoId: valida.servicioContratadoId } }
  }
  if (valida.tipo === 'sin_sesion') return { tipo: 'no_aplica' }

  // Sin contrato de Valida que pague este espacio: ¿paga una licencia de ONE?
  const { user } = await getCachedUser()
  if (!user) return { tipo: 'no_aplica' }
  const { supabase, workspaceId, role, userId: usuarioEfectivoId, impersonating } = await getWorkspace()
  if (!workspaceId) return { tipo: 'no_aplica' }

  // Cliente de SESIÓN: la RPC deriva el espacio de `current_user_workspace_id()`.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const servicios = await (supabase as any).rpc('mis_servicios')
  if (servicios.error) {
    if (!esFuncionAusente(servicios.error)) console.error('[suscripcion] mis_servicios:', servicios.error.message)
    return { tipo: 'no_disponible' }
  }
  const contrato = contratoOnePagado((servicios.data ?? []) as FilaMisServicios[])
  if (!contrato) return { tipo: 'no_aplica' }

  return {
    tipo: 'ok',
    producto: 'one',
    entrada: {
      tipo: 'ok',
      workspaceId,
      usuarioId: user.id,
      usuarioEfectivoId: usuarioEfectivoId ?? user.id,
      impersonando: impersonating === true,
      role: role ?? 'read_only',
      // Ver el encabezado: sin documento publicado para Clarity, no hay nada que aceptar.
      estado: { estado: 'aprobada' },
      hoy: todayBogotaISO(),
      servicioContratadoId: contrato.servicio_contratado_id,
      plazoTerminos: null,
      enPlazo: false,
      // La licencia de ONE no tiene términos por aviso ni restricción de Valida.
      modificaciones: [],
      modificacion: null,
      restriccionDesde: null,
      usuarioDelCliente: false,
    },
  }
}

/** Una sola resolución por request: la usan el menú, la página, las acciones y las descargas. */
export const entradaSuscripcion = cache(resolver)
