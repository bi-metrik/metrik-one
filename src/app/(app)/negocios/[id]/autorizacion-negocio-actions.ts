'use server'

/**
 * H7-2 (QA de punta a punta del 2026-10-29, viaje 07): faltaba la casilla de MENORES y el envío
 * se frenaba con «Envíale el link desde Autorización de datos», pero ese bloque es de Solicitud
 * (E1) y no se ve en Cotización ni en Seguimiento. La única salida era intentar avanzar de etapa
 * para que el modal del gate diera «Copiar link para el cliente».
 *
 * Ahora la franja «Falta la autorización…» de la ficha (visible en cualquier etapa) pide el link
 * por el NEGOCIO, sin depender de que el bloque de E1 se pinte: copia un link nuevo o lo manda
 * por correo, con las mismas funciones que el bloque y que el gate (`pedirEnlace`,
 * `enviarCorreoAutorizacion`).
 *
 * Permiso: ver el negocio (`guardVerNegocio`) y no ser solo lectura; negocio abierto. Es el mismo
 * alcance del gate, que entrega el link a quien intenta avanzar.
 */

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { guardVerNegocio } from '@/lib/permissions/guard-negocio'
import { enviarCorreoAutorizacion, pedirEnlace } from '@/lib/autorizacion-datos/servidor'
import { MENSAJE_SIN_CORREO } from '@/lib/autorizacion-datos/correo'
import { MENSAJE_NEGOCIO_CERRADO, negocioCerrado } from '@/lib/negocios/motivo-cierre'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

async function contactoDelNegocio(negocioId: string): Promise<
  | { error: string }
  | { error: null; workspaceId: string; staffId: string | null; contactoId: string }
> {
  const { supabase, workspaceId, staffId, role, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }
  if (!role || role === 'read_only') return { error: 'Tu rol no permite pedir la autorización.' }
  const g = await guardVerNegocio(negocioId)
  if (!g.ok) return { error: g.error ?? 'Sin acceso a este negocio' }
  const { data } = await (supabase as Db)
    .from('negocios')
    .select('contacto_id, estado')
    .eq('id', negocioId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const neg = data as { contacto_id: string | null; estado: string | null } | null
  if (!neg) return { error: 'Negocio no encontrado' }
  if (negocioCerrado(neg.estado)) return { error: MENSAJE_NEGOCIO_CERRADO }
  if (!neg.contacto_id) return { error: 'Este negocio no tiene contacto asociado' }
  return { error: null, workspaceId, staffId: staffId ?? null, contactoId: neg.contacto_id }
}

/** Un link de autorización para copiarlo y mandarlo por WhatsApp. */
export async function linkAutorizacionDelNegocio(negocioId: string): Promise<{ url: string | null; error: string | null }> {
  const c = await contactoDelNegocio(negocioId)
  if (c.error !== null) return { url: null, error: c.error }
  const { enlace, error } = await pedirEnlace({
    workspaceId: c.workspaceId, contactoId: c.contactoId, staffId: c.staffId, negocioId, medio: 'whatsapp_reenviado',
  })
  if (!enlace) {
    console.error('[linkAutorizacionDelNegocio]', error)
    return { url: null, error: 'No se pudo generar el link' }
  }
  return { url: enlace.url, error: null }
}

/** El mismo link, por correo al cliente. */
export async function correoAutorizacionDelNegocio(negocioId: string): Promise<{ enviadoA: string | null; error: string | null }> {
  const c = await contactoDelNegocio(negocioId)
  if (c.error !== null) return { enviadoA: null, error: c.error }
  const r = await enviarCorreoAutorizacion({
    workspaceId: c.workspaceId, contactoId: c.contactoId, negocioId, staffId: c.staffId, origen: 'manual',
  })
  if (r.enviado) {
    revalidatePath(`/negocios/${negocioId}`)
    return { enviadoA: r.email, error: null }
  }
  if (r.motivo === 'error') {
    console.error('[correoAutorizacionDelNegocio]', r.detalle)
    return { enviadoA: null, error: 'No se pudo enviar el correo. Copia el link y envíaselo por WhatsApp.' }
  }
  return { enviadoA: null, error: MENSAJE_SIN_CORREO[r.motivo] }
}
