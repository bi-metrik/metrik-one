'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { exigirModulo, MENSAJE_MODULO_NO_ACTIVO, REQUISITO } from '@/lib/modulos/exigir-modulo'
import {
  configDelWorkspace,
  enviarCorreoAutorizacion,
  estadoDelContacto,
  pedirEnlace,
} from '@/lib/autorizacion-datos/servidor'
import { MENSAJE_SIN_CORREO } from '@/lib/autorizacion-datos/correo'
import {
  armarVista,
  puedePedirAutorizacion,
  puedeVerAutorizacion,
  type VistaAutorizacionContacto,
} from '@/lib/autorizacion-datos/vista'

/**
 * La autorización de datos desde la ficha del contacto en el directorio: la misma vista y el
 * mismo link que el bloque del viaje, pero por `contacto_id` (la autorización vive en el
 * contacto). Sin negocio de por medio, el permiso no lo da un bloque: lo da el rol
 * (`puedeVerAutorizacion` / `puedePedirAutorizacion`) y, para el `operator`, ser responsable
 * del contacto o de uno de sus viajes.
 *
 * El contacto se lee con el cliente del usuario Y el filtro de workspace antes de tocar la
 * RPC, que corre con `service_role`: un id de otro inquilino no llega a ella.
 *
 * Si el workspace no usa la autorización (`config_extra.autorizacion_datos` ausente), la
 * lectura devuelve `vista: null` y la ficha no muestra la sección.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

const SIN_ACCESO = 'Tu rol no tiene acceso a la autorización de datos'

type Contexto =
  | { error: string }
  | { error: null; workspaceId: string; staffId: string | null; contactoId: string; puedePedir: boolean; activa: boolean }

async function contextoDelContacto(contactoId: string, pedir: boolean): Promise<Contexto> {
  const { supabase, workspaceId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  const { config } = await configDelWorkspace(workspaceId)
  if (!config.activa) return { error: null, workspaceId, staffId: staffId ?? null, contactoId, puedePedir: false, activa: false }
  if (!puedeVerAutorizacion(role)) return { error: SIN_ACCESO }

  const { data: c } = await (supabase as Cliente)
    .from('contactos')
    .select('id, responsable_id')
    .eq('id', contactoId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  const contacto = c as { id: string; responsable_id: string | null } | null
  if (!contacto) return { error: 'Contacto no encontrado' }

  // Los viajes son de Clarity: como en `guard-negocio`, sin el módulo no se pide nada.
  const modulo = await exigirModulo(REQUISITO.clarity)
  if (!modulo.ok) return { error: modulo.error === 'no_autenticado' ? 'No autenticado' : MENSAJE_MODULO_NO_ACTIVO }

  let esResponsable = !!staffId && contacto.responsable_id === staffId
  if (!esResponsable && staffId && role === 'operator') {
    const { data: filas } = await (supabase as Cliente)
      .from('negocio_responsables')
      .select('negocio_id, negocios!inner(contacto_id, workspace_id)')
      .eq('staff_id', staffId)
      .eq('negocios.contacto_id', contactoId)
      .eq('negocios.workspace_id', workspaceId)
      .limit(1)
    esResponsable = ((filas ?? []) as unknown[]).length > 0
  }
  const puedePedir = puedePedirAutorizacion(role, esResponsable)
  if (pedir && !puedePedir) return { error: 'Tu rol no permite pedir la autorización de este contacto' }
  return { error: null, workspaceId, staffId: staffId ?? null, contactoId, puedePedir, activa: true }
}

export async function cargarAutorizacionDeContacto(
  contactoId: string,
): Promise<{ vista: VistaAutorizacionContacto | null; puedePedir: boolean; error: string | null }> {
  const c = await contextoDelContacto(contactoId, false)
  // Sin acceso por rol (contador) la ficha simplemente no muestra la sección.
  if (c.error === SIN_ACCESO) return { vista: null, puedePedir: false, error: null }
  if (c.error !== null) return { vista: null, puedePedir: false, error: c.error }
  if (!c.activa) return { vista: null, puedePedir: false, error: null }
  const { estado, error } = await estadoDelContacto(c.workspaceId, c.contactoId)
  if (error) return { vista: null, puedePedir: false, error: 'No se pudo leer la autorización de datos' }
  // La vía «recibida por otro medio» pide un viaje: se registra desde el bloque, no aquí.
  return { vista: armarVista(estado, null), puedePedir: c.puedePedir, error: null }
}

/** El link del titular para copiarlo (reusa el pendiente). */
export async function linkAutorizacionDeContacto(
  contactoId: string,
): Promise<{ url: string | null; error: string | null }> {
  const c = await contextoDelContacto(contactoId, true)
  if (c.error !== null) return { url: null, error: c.error }
  if (!c.activa) return { url: null, error: 'Este workspace no usa la autorización de datos' }
  const { enlace, error } = await pedirEnlace({
    workspaceId: c.workspaceId, contactoId: c.contactoId, staffId: c.staffId, negocioId: null, medio: 'whatsapp_reenviado',
  })
  if (!enlace) {
    console.error('[linkAutorizacionDeContacto]', error)
    return { url: null, error: 'No se pudo generar el link' }
  }
  return { url: enlace.url, error: null }
}

/** «Enviar por correo» desde la ficha del contacto. */
export async function enviarCorreoAutorizacionDeContacto(
  contactoId: string,
): Promise<{ enviadoA: string | null; error: string | null }> {
  const c = await contextoDelContacto(contactoId, true)
  if (c.error !== null) return { enviadoA: null, error: c.error }
  if (!c.activa) return { enviadoA: null, error: 'Este workspace no usa la autorización de datos' }
  const r = await enviarCorreoAutorizacion({
    workspaceId: c.workspaceId, contactoId: c.contactoId, negocioId: null, staffId: c.staffId, origen: 'manual',
  })
  if (r.enviado) {
    revalidatePath(`/directorio/contacto/${c.contactoId}`)
    return { enviadoA: r.email, error: null }
  }
  if (r.motivo === 'error') {
    console.error('[enviarCorreoAutorizacionDeContacto]', r.detalle)
    return { enviadoA: null, error: 'No se pudo enviar el correo. Copia el link y envíaselo por WhatsApp.' }
  }
  return { enviadoA: null, error: MENSAJE_SIN_CORREO[r.motivo] }
}
