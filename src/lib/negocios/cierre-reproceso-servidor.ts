/**
 * Aplica el cierre automático del reproceso cuando el caso rehizo su tramo.
 *
 * Cuelga del ÚNICO punto de escritura que mueve un negocio de etapa
 * (`cambiarEtapaNegocioConGate`). No hay trigger de base ni cierre derivado al leer: un
 * estado que se deriva en cada lectura no se puede auditar después, y el indicador de
 * calidad tiene que poder reconstruirse.
 *
 * La regla de cuándo cierra vive aparte y es pura (`reprocesoQuedaRehecho`). Aquí solo
 * están los efectos, y cada uno tiene su razón de estar escrito así:
 *
 * - **`reproceso_eventos` se escribe con `service_role`, nunca con el cliente de sesión.**
 *   `authenticated` solo tiene SELECT sobre esa tabla A PROPÓSITO: de ahí cuelga el 40% del
 *   bono. Con el cliente de sesión el UPDATE muere con **42501 y el error se traga**; ya
 *   costó 7 eventos de calidad perdidos (PR #440).
 * - **Nunca se tocan `abierto_at`, `atribuido_a`, `causa` ni `tipo`.** El indicador cuenta
 *   por `abierto_at`: cerrar un reproceso NO lo borra del mes en que ocurrió. El certificado
 *   malo ya pasó.
 * - **El `tipo` de la traza es `sistema`.** El CHECK de `activity_log` NO acepta
 *   `reproceso`, y un tipo fuera del CHECK falla EN SILENCIO — ya mordió cuatro veces.
 * - **Nada de esto puede tumbar el avance.** El caso ya se movió y eso es lo que el equipo
 *   necesita; si el cierre falla, el reproceso se queda abierto con su botón manual, que es
 *   exactamente el estado de hoy. Por eso todo va dentro de un `try` y el fallo se reporta.
 */

import { createServiceClient } from '@/lib/supabase/server'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { reprocesoQuedaRehecho, type MarcaParaCierre } from './cierre-reproceso'
import type { EtapaRetorno } from './retorno-reproceso'

/**
 * Los tipos generados de Supabase van por detrás del esquema: `negocios.metadata` existe en
 * la base y no en `database.ts`. Mismo escape que usa `negocio-v2-actions`.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(supabase: unknown): any {
  return supabase
}

/** Quién cerró la marca. `sistema` la distingue de un cierre a mano. */
export const CERRADO_POR_SISTEMA = 'sistema'

export type ResultadoCierreAuto =
  | { cerrado: false; motivo: string }
  | { cerrado: true; ciclo: number; etapaOrigen: string }

/**
 * Cierra el reproceso del negocio si el avance a `ordenDestino` completó el tramo.
 *
 * Silenciosa por diseño: un negocio sin reproceso abierto (la enorme mayoría) no paga más
 * que la lectura que el avance ya necesitaba, porque la marca llega por parámetro.
 */
export async function cerrarReprocesoSiSeRehizoElTramo(input: {
  workspaceId: string
  negocioId: string
  /** `negocios.metadata` COMPLETO, leído después del avance para no pisar escrituras. */
  metadata: Record<string, unknown> | null
  etapas: readonly EtapaRetorno[]
  ordenDestino: number
  /** Autor de la traza (`staff.id`). El cierre es del sistema; esto dice quién lo gatilló. */
  staffId: string | null
}): Promise<ResultadoCierreAuto> {
  const { workspaceId, negocioId, metadata, etapas, ordenDestino, staffId } = input

  const marca = ((metadata ?? {}).reproceso ?? null) as MarcaParaCierre | null
  const decision = reprocesoQuedaRehecho({ marca, etapas, ordenDestino })
  if (!decision.cierra) return { cerrado: false, motivo: decision.motivo }

  const cerradoAt = new Date().toISOString()

  try {
    const svc = createServiceClient()

    // La marca. Se conserva TODO lo que traía (causa, detalle, atribución, quién la abrió):
    // lo único que cambia es que el negocio deja de estar señalado como urgente.
    const { error: errMarca } = await db(svc)
      .from('negocios')
      .update({
        metadata: {
          ...(metadata ?? {}),
          reproceso: { ...(marca ?? {}), activo: false, cerrado_at: cerradoAt, cerrado_por: CERRADO_POR_SISTEMA },
        },
      })
      .eq('id', negocioId)
      .eq('workspace_id', workspaceId)

    if (errMarca) {
      console.error('[reproceso] no se pudo cerrar la marca de', negocioId, errMarca)
      return { cerrado: false, motivo: 'error_marca' }
    }

    // El hecho del indicador. Solo se le pone fecha de cierre, y solo a la fila de ESTE
    // ciclo que siga abierta: `is('cerrado_at', null)` deja intacto el ciclo 0
    // (`CICLO_SIN_RETORNO`, el error registrado sin devolver el caso, que nace cerrado).
    const { error: errEvento } = await db(svc)
      .from('reproceso_eventos')
      .update({ cerrado_at: cerradoAt })
      .eq('workspace_id', workspaceId)
      .eq('negocio_id', negocioId)
      .eq('ciclo', decision.ciclo)
      .is('cerrado_at', null)

    if (errEvento) {
      // La marca ya se cerró; el hecho quedó sin fecha de cierre. No se revierte: el
      // indicador cuenta por `abierto_at`, así que el mes no se mueve. Se deja visible.
      console.error('[reproceso] no se pudo cerrar el evento de calidad de', negocioId, errEvento)
    }

    await registrarActividad(db(svc), {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      tipo: 'sistema',
      autor_id: staffId,
      contenido:
        `Reproceso ${decision.ciclo} cerrado automáticamente: el caso volvió a ` +
        `${decision.etapaOrigen}, la etapa de la que había salido.`.slice(0, 280),
    }, 'cerrarReprocesoSiSeRehizoElTramo')

    return { cerrado: true, ciclo: decision.ciclo, etapaOrigen: decision.etapaOrigen }
  } catch (e) {
    // El avance ya ocurrió: no convertir el cierre en un fallo del movimiento.
    console.error('[reproceso] cierre automático falló en', negocioId, e)
    return { cerrado: false, motivo: 'excepcion' }
  }
}
