import 'server-only'
import { cache } from 'react'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { createServiceClient } from '@/lib/supabase/server'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { ultimosDigitosTarjetaEpayco } from '@/lib/suscripciones/pasarela/epayco'
import { leerSaldoValida } from '@/lib/valida/credencial-servidor'
import { pruebaDeConfig } from '@/lib/valida/corte-bolsa'
import { estadoCobroDelEspacio } from '@/lib/valida-registro/cobro-prueba-servidor'
import { esEspacioAutogestion } from '@/lib/valida-registro/plan'
import { resolverSuscripcionEnPrueba, type DepsSuscripcionEnPrueba, type SuscripcionEnPrueba } from './prueba'

export type { SuscripcionEnPrueba }

/**
 * La sección Suscripción DURANTE la prueba gratis de Valida (2026-10-16): el espacio todavía no tiene
 * contrato (`contextoSuscripcion` responde `no_aplica`), pero su suscripción ya existe en prueba
 * (`suscripciones_producto`, nacida en el registro). La regla de quién la ve es la de la persona
 * designada: en la prueba, la persona que se registró y aceptó (es la que la activación designa).
 * Una sola resolución por request.
 */
async function resolver(): Promise<SuscripcionEnPrueba | null> {
  try {
    const { user } = await getCachedUser()
    if (!user) return null
    const { workspaceId, userId, impersonating, realRole } = await getWorkspace()
    if (!workspaceId) return null
    const deps: DepsSuscripcionEnPrueba = {
      db: createServiceClient(),
      esAutogestion: esEspacioAutogestion,
      pruebaDeConfig,
      cobro: (db, ws) => estadoCobroDelEspacio(db, ws),
      saldo: (ws) => leerSaldoValida(ws),
      ultimos4: (ref) => ultimosDigitosTarjetaEpayco(ref),
    }
    return await resolverSuscripcionEnPrueba(deps, {
      workspaceId,
      usuarioRealId: user.id,
      usuarioEfectivoId: userId ?? user.id,
      impersonando: impersonating === true,
      rolReal: realRole ?? null,
    })
  } catch (e) {
    console.error('[suscripcion] en prueba:', e instanceof Error ? e.message : e)
    return null
  }
}

export const suscripcionEnPrueba = cache(resolver)
