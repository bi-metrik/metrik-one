'use server'

import { headers } from 'next/headers'
import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { esEspacioAutogestion } from '@/lib/valida-registro/plan'
import { PRUEBA_DE_LAS_CONDICIONES } from '@/lib/valida-registro/condiciones'
import { COBRO_TRAS_PRUEBA } from '@/lib/valida-registro/condiciones-cobro'
import { textoConfirmacionCobro, textoTrasConfirmar } from '@/lib/valida-registro/cobro-prueba'
import { cobrarAlConfirmar, ofertaCobroAlConfirmar } from '@/lib/valida-registro/cobro-prueba-servidor'

/**
 * El cobro del primer mes al confirmar (Condiciones v2.1, 7.1 literal a). ⚠️ Endpoints alcanzables
 * desde cualquier sesión: el espacio sale de la sesión (nunca del navegador) y el servidor exige que
 * quien confirma sea la persona que se registró (`motivoSinCobroAlConfirmar`). Del navegador solo
 * llega si la pantalla era la del corte (consulta 11) o la de «Activar plan»: cambia el título de la
 * constancia, no el valor ni la tarjeta.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

async function espacioDeLaSesion(): Promise<{ svc: Db; workspaceId: string; usuarioId: string } | null> {
  const { user } = await getCachedUser()
  if (!user?.id) return null
  const svc = createServiceClient() as Db
  const perfil = await svc.from('profiles').select('workspace_id, role').eq('id', user.id).maybeSingle()
  const workspaceId = (perfil.data?.workspace_id as string | null) ?? null
  if (perfil.error || !workspaceId || perfil.data?.role !== 'owner') return null
  const ws = await svc.from('workspaces').select('config_extra').eq('id', workspaceId).maybeSingle()
  if (ws.error || !esEspacioAutogestion(ws.data?.config_extra ?? null)) return null
  return { svc, workspaceId, usuarioId: user.id }
}

export type OfertaEnPantalla = { disponible: false } | { disponible: true; titulo: string; detalle: string; boton: string; valor: number; ultimos4: string | null }

export async function ofertaDeCobroAlConfirmar(agotada: boolean): Promise<OfertaEnPantalla> {
  try {
    const s = await espacioDeLaSesion()
    if (!s) return { disponible: false }
    const o = await ofertaCobroAlConfirmar({ db: s.svc }, { workspaceId: s.workspaceId, usuarioId: s.usuarioId })
    if (!o.disponible) return { disponible: false }
    const t = textoConfirmacionCobro({ valor: o.valor, ultimos4: o.ultimos4, agotada: agotada === true, consultasPrueba: PRUEBA_DE_LAS_CONDICIONES.consultas })
    return { disponible: true, ...t, valor: o.valor, ultimos4: o.ultimos4 }
  } catch (e) {
    console.error('[valida] oferta del cobro al confirmar:', e instanceof Error ? e.message : e)
    return { disponible: false }
  }
}

export async function confirmarCobroAlConfirmar(agotada: boolean): Promise<{ ok: boolean; texto: string }> {
  const s = await espacioDeLaSesion()
  if (!s) return { ok: false, texto: textoTrasConfirmar('no_disponible', { valor: 0, ultimos4: null }) }
  const h = await headers()
  const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() || h.get('x-real-ip')?.trim() || null
  try {
    const r = await cobrarAlConfirmar({ db: s.svc }, { workspaceId: s.workspaceId, usuarioId: s.usuarioId, agotada: agotada === true, ip })
    revalidatePath('/valida')
    revalidatePath('/suscripcion')
    const ultimos4 = r.tipo === 'cobrado' || r.tipo === 'rechazado' ? r.ultimos4 : null
    return { ok: r.tipo === 'cobrado', texto: textoTrasConfirmar(r.tipo, { valor: COBRO_TRAS_PRUEBA.precio, ultimos4 }) }
  } catch (e) {
    // Lo único que lanza es la lectura del registro, ANTES del reclamo: no se cobró nada.
    console.error('[valida] cobro al confirmar:', e instanceof Error ? e.message : e)
    return { ok: false, texto: textoTrasConfirmar('reintentar', { valor: 0, ultimos4: null }) }
  }
}
