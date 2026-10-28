'use server'

import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'
import { contextoSuscripcion } from '@/lib/seccion-suscripcion/contexto-servidor'
import { enlaceDeReactivacion } from '@/lib/valida-registro/reactivacion-servidor'

/**
 * «Pagar el período» del plan suspendido por la reversión del pago. ⚠️ Endpoint alcanzable desde
 * cualquier sesión: el espacio sale de la sesión (`contextoSuscripcion`), paga solo la persona designada
 * del contrato y nunca en «Ver como» (la misma regla de `/suscripcion`).
 */
export async function pagarPeriodoReactivacion(): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const ctx = await contextoSuscripcion()
  if (ctx.tipo === 'no_disponible') return { ok: false, error: 'No se pudo leer tu plan. Intenta de nuevo en un momento.' }
  if (ctx.tipo !== 'ok') return { ok: false, error: 'Solo la persona designada por tu empresa puede pagar el período.' }
  if (ctx.soloLectura) return { ok: false, error: 'Estás viendo la cuenta como otra persona: es solo lectura.' }
  try {
    const r = await enlaceDeReactivacion(ctx.workspaceId, { db: createServiceClient() as unknown as SupabaseClient })
    if (r.ok) revalidatePath('/valida')
    return r
  } catch (e) {
    console.error('[valida] pagar período de reactivación:', e instanceof Error ? e.message : e)
    return { ok: false, error: 'No pudimos preparar el pago. Intenta de nuevo en un momento.' }
  }
}
