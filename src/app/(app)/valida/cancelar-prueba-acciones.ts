'use server'

import { revalidatePath } from 'next/cache'
import { createServiceClient } from '@/lib/supabase/server'
import { getCachedUser } from '@/lib/supabase/auth-user'
import { esEspacioAutogestion } from '@/lib/valida-registro/plan'
import { cancelarCobroDelEspacio } from '@/lib/valida-registro/cobro-prueba-servidor'

/**
 * «Cancelar prueba» (Condiciones v2.0, 7.3), desde la franja de `/valida` y desde `/suscripcion`: la misma
 * acción (cancela el cobro, pide borrar la tarjeta y cierra la suscripción en prueba). ⚠️ Endpoint alcanzable desde cualquier sesión: el espacio
 * sale de la sesión (nunca del navegador), solo la persona dueña de un espacio del registro
 * autogestionado cancela, y la guarda del cobro (`cobro_estado = 'programado'`) está en el update.
 */
export async function cancelarPruebaValida(): Promise<{ ok: true; texto: string } | { ok: false; texto: string }> {
  const { user } = await getCachedUser()
  if (!user?.id) return { ok: false, texto: 'Tu sesión terminó. Vuelve a entrar con tu correo.' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = createServiceClient() as any
  const perfil = await svc.from('profiles').select('workspace_id, role').eq('id', user.id).maybeSingle()
  const workspaceId = (perfil.data?.workspace_id as string | null) ?? null
  if (perfil.error || !workspaceId) return { ok: false, texto: 'Tu sesión terminó. Vuelve a entrar con tu correo.' }
  if (perfil.data?.role !== 'owner') return { ok: false, texto: 'Solo la persona que abrió la prueba puede cancelarla.' }
  const ws = await svc.from('workspaces').select('config_extra').eq('id', workspaceId).maybeSingle()
  if (ws.error || !esEspacioAutogestion(ws.data?.config_extra ?? null)) return { ok: false, texto: 'Esta cuenta no tiene una prueba que cancelar.' }

  try {
    const r = await cancelarCobroDelEspacio({ db: svc }, { workspaceId, por: 'boton' })
    revalidatePath('/valida')
    revalidatePath('/suscripcion')
    switch (r.tipo) {
      case 'cancelada':
      case 'ya_cancelada':
        return { ok: true, texto: 'Cancelaste la prueba: no se cobrará nada. Las consultas que te quedan siguen disponibles.' }
      case 'tarde':
        return { ok: false, texto: 'El cobro ya está en curso y no se puede cancelar desde aquí. Escríbenos a mauricio.moreno@metrik.com.co.' }
      default:
        return { ok: false, texto: 'Esta cuenta no tiene una prueba que cancelar.' }
    }
  } catch (e) {
    console.error('[valida] cancelar prueba:', e instanceof Error ? e.message : e)
    return { ok: false, texto: 'No pudimos cancelar ahora. Intenta de nuevo en un momento o escríbenos a mauricio.moreno@metrik.com.co.' }
  }
}
