'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { guardEditarBloque, guardVerNegocio } from '@/lib/permissions/guard-negocio'
import {
  separarCampos,
  AUTORIZACION_SLUG,
  AUTORIZACION_FECHA_SLUG,
  AUTORIZACION_AUTOR_SLUG,
  AUTORIZACION_LINK_SLUG,
  type ValoresContacto,
} from '@/lib/contactos/campos-contacto'
import {
  configDelWorkspace,
  enviarCorreoAutorizacion,
  estadoDelContacto,
  MENSAJE_EVIDENCIA,
  pedirEnlace,
  registrarConEvidencia,
  versionesPublicadas,
} from '@/lib/autorizacion-datos/servidor'
import { faseDe, type FaseAutorizacion } from '@/lib/autorizacion-datos/estado'
import { MENSAJE_SIN_CORREO } from '@/lib/autorizacion-datos/correo'
import type { ClaveCasilla } from '@/lib/autorizacion-datos/texto'

/**
 * Acciones del bloque `contacto`. Escriben en `contactos`, no en `negocio_bloques`.
 *
 * El permiso lo sigue dando el BLOQUE (rol + area + responsable, via `guardEditarBloque`),
 * igual que cualquier otra escritura de negocio: quien puede trabajar esta etapa puede
 * completar la ficha del cliente desde ella. Lo que cambia es el destino del dato, no
 * quien lo puede tocar.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

/** Resuelve bloque → negocio → contacto dentro del workspace del usuario. */
async function resolverContacto(
  supabase: Cliente,
  workspaceId: string,
  negocioBloqueId: string,
): Promise<{ negocioId: string; contactoId: string | null; error: string | null }> {
  const { data: nb } = await supabase
    .from('negocio_bloques')
    .select('negocio_id, negocios!inner(id, contacto_id, workspace_id)')
    .eq('id', negocioBloqueId)
    .maybeSingle()
  const negocio = (nb as { negocios?: { id: string; contacto_id: string | null; workspace_id: string } | null } | null)
    ?.negocios
  if (!negocio) return { negocioId: '', contactoId: null, error: 'Bloque no encontrado' }
  // El guard ya valida rol y area sobre el bloque, pero no que el negocio sea de este
  // workspace: sin esta linea un id filtrado de otro tenant se leeria igual.
  if (negocio.workspace_id !== workspaceId) {
    return { negocioId: '', contactoId: null, error: 'Bloque no encontrado' }
  }
  return { negocioId: negocio.id, contactoId: negocio.contacto_id, error: null }
}

export interface FichaContacto {
  contactoId: string
  valores: ValoresContacto
}

/**
 * Carga la ficha del contacto del negocio.
 *
 * Se lee aqui y no en el payload del negocio a proposito: `custom_data` se retira del
 * join de `getNegocio` (lleva perfil completo de la persona) y no hay razon para mandarlo
 * al cliente en cada negocio solo porque alguna linea tenga un bloque de contacto.
 */
export async function cargarFichaContacto(
  negocioBloqueId: string,
): Promise<{ ficha: FichaContacto | null; error: string | null }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { ficha: null, error: 'No autenticado' }

  const res = await resolverContacto(supabase, workspaceId, negocioBloqueId)
  if (res.error) return { ficha: null, error: res.error }

  const guard = await guardVerNegocio(res.negocioId)
  if (!guard.ok) return { ficha: null, error: guard.error ?? 'Sin permiso' }

  if (!res.contactoId) return { ficha: null, error: null }

  const { data: c } = await supabase
    .from('contactos')
    .select('id, nombre, email, telefono, rol, segmento, custom_data')
    .eq('id', res.contactoId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!c) return { ficha: null, error: null }

  const row = c as ValoresContacto & { id: string; custom_data: Record<string, unknown> | null }
  return {
    ficha: {
      contactoId: row.id,
      valores: {
        nombre: row.nombre,
        email: row.email,
        telefono: row.telefono,
        rol: row.rol,
        segmento: row.segmento,
        custom_data: row.custom_data ?? {},
      },
    },
    error: null,
  }
}

/**
 * Guarda campos de la ficha del contacto desde un bloque del negocio.
 *
 * `custom_data` se MEZCLA con lo que ya tenia. Escribirlo entero borraria el perfil que
 * escribio otra linea de negocio o el `origen` que graba el webhook de campanas, que no
 * estan entre los campos de este bloque y no tienen por que desaparecer.
 */
export async function guardarFichaContacto(
  negocioBloqueId: string,
  values: Record<string, unknown>,
): Promise<{ error: string | null }> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }

  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) return { error: guard.error ?? 'Sin permiso' }

  const res = await resolverContacto(supabase, workspaceId, negocioBloqueId)
  if (res.error) return { error: res.error }
  if (!res.contactoId) return { error: 'Este negocio no tiene contacto asociado' }

  const { data: actual } = await supabase
    .from('contactos')
    .select('custom_data')
    .eq('id', res.contactoId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!actual) return { error: 'Contacto no encontrado' }

  const { nativos, custom } = separarCampos(values)
  // La autorizacion la da el titular en su link (o, si el workspace la enciende, la via con
  // evidencia). Dejarla entrar por aqui permitiria marcarla como un campo mas, sin prueba.
  delete custom[AUTORIZACION_SLUG]
  delete custom[AUTORIZACION_FECHA_SLUG]
  delete custom[AUTORIZACION_AUTOR_SLUG]
  delete custom[AUTORIZACION_LINK_SLUG]

  const previo = ((actual as { custom_data: Record<string, unknown> | null }).custom_data ?? {})
  const update: Record<string, unknown> = { ...nativos, updated_at: new Date().toISOString() }
  if (Object.keys(custom).length > 0) update.custom_data = { ...previo, ...custom }

  const { error: updErr } = await supabase
    .from('contactos')
    .update(update)
    .eq('id', res.contactoId)
    .eq('workspace_id', workspaceId)
  if (updErr) return { error: (updErr as { message: string }).message }

  revalidatePath(`/negocios/${res.negocioId}`)
  revalidatePath(`/directorio/contacto/${res.contactoId}`)
  return { error: null }
}

// ── Autorizacion de tratamiento de datos (link del titular) ─────────────────────

/**
 * Desde el 2026-10-08 la autorizacion la da el TITULAR en su link (ver
 * `lib/autorizacion-datos/`). El boton de un clic que la registraba a nombre de la comercial se
 * quito (Emilio, pieza 4.4): un «autorizado» sin poder mostrar que acepto la persona es lo que
 * prohibe el deber de conservar prueba. Las marcas que ya existen se muestran con su etiqueta y
 * no cuentan para el gate.
 */

export interface VistaAutorizacionBloque {
  contactoNombre: string
  tieneCorreo: boolean
  fase: FaseAutorizacion
  aceptadoAt: string | null
  version: string | null
  casillas: Partial<Record<ClaveCasilla, boolean | null>> | null
  vigente: Record<ClaveCasilla, boolean>
  correoEnviadoAt: string | null
  rechazadoAt: string | null
  manualSinEvidencia: { fecha: string | null } | null
  textoPublicado: boolean
  versionVigente: string | null
  /** `link` o `evidencia` (registrada por el equipo con el archivo). */
  via: 'link' | 'evidencia' | null
  /** La vía «recibida por otro medio» está encendida en el workspace: sus versiones para elegir. */
  evidencia: { versiones: Array<{ id: string; version: string; casillas: Array<{ clave: ClaveCasilla; texto: string }> }> } | null
}

async function contactoDelBloque(negocioBloqueId: string, editar: boolean) {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' as const }
  const guard = editar ? await guardEditarBloque(negocioBloqueId) : null
  if (guard && !guard.ok) return { error: guard.error ?? 'Sin permiso' }
  const res = await resolverContacto(supabase, workspaceId, negocioBloqueId)
  if (res.error) return { error: res.error }
  if (!editar) {
    const g = await guardVerNegocio(res.negocioId)
    if (!g.ok) return { error: g.error ?? 'Sin permiso' }
  }
  if (!res.contactoId) return { error: 'Este negocio no tiene contacto asociado' }
  return { error: null, workspaceId, staffId: staffId ?? null, negocioId: res.negocioId, contactoId: res.contactoId }
}

export async function cargarAutorizacionContacto(
  negocioBloqueId: string,
): Promise<{ vista: VistaAutorizacionBloque | null; error: string | null }> {
  const c = await contactoDelBloque(negocioBloqueId, false)
  if (c.error !== null) return { vista: null, error: c.error === 'Este negocio no tiene contacto asociado' ? null : c.error }
  const [{ estado, error }, { config }] = await Promise.all([
    estadoDelContacto(c.workspaceId, c.contactoId),
    configDelWorkspace(c.workspaceId),
  ])
  if (error) return { vista: null, error: 'No se pudo leer la autorización de datos' }
  const evidencia = config.registroConEvidencia ? { versiones: await versionesPublicadas(c.workspaceId) } : null
  return {
    vista: {
      contactoNombre: estado.contacto?.nombre ?? '',
      tieneCorreo: !!estado.contacto?.email,
      fase: faseDe(estado),
      aceptadoAt: estado.aceptacion?.aceptado_at ?? null,
      version: estado.aceptacion?.version ?? null,
      casillas: estado.aceptacion?.casillas ?? null,
      vigente: estado.vigente,
      correoEnviadoAt: estado.pendiente?.correo_enviado_at ?? null,
      rechazadoAt: estado.pendiente?.rechazado_at ?? null,
      manualSinEvidencia: estado.manual_sin_evidencia,
      textoPublicado: !!estado.texto,
      versionVigente: estado.texto?.version ?? null,
      via: estado.aceptacion?.via ?? null,
      evidencia,
    },
    error: null,
  }
}

/** El link del titular para copiarlo (reusa el pendiente). */
export async function linkAutorizacionContacto(
  negocioBloqueId: string,
): Promise<{ url: string | null; error: string | null }> {
  const c = await contactoDelBloque(negocioBloqueId, true)
  if (c.error !== null) return { url: null, error: c.error }
  const { enlace, error } = await pedirEnlace({
    workspaceId: c.workspaceId, contactoId: c.contactoId, staffId: c.staffId, negocioId: c.negocioId, medio: 'whatsapp_reenviado',
  })
  if (!enlace) {
    console.error('[linkAutorizacionContacto]', error)
    return { url: null, error: 'No se pudo generar el link' }
  }
  return { url: enlace.url, error: null }
}

/** «Enviar por correo» desde el bloque. */
export async function enviarCorreoAutorizacionContacto(
  negocioBloqueId: string,
): Promise<{ enviadoA: string | null; error: string | null }> {
  const c = await contactoDelBloque(negocioBloqueId, true)
  if (c.error !== null) return { enviadoA: null, error: c.error }
  const r = await enviarCorreoAutorizacion({
    workspaceId: c.workspaceId, contactoId: c.contactoId, negocioId: c.negocioId, staffId: c.staffId, origen: 'manual',
  })
  if (r.enviado) {
    revalidatePath(`/negocios/${c.negocioId}`)
    return { enviadoA: r.email, error: null }
  }
  if (r.motivo === 'error') {
    console.error('[enviarCorreoAutorizacionContacto]', r.detalle)
    return { enviadoA: null, error: 'No se pudo enviar el correo. Copia el link y envíaselo por WhatsApp.' }
  }
  return { enviadoA: null, error: MENSAJE_SIN_CORREO[r.motivo] }
}

/**
 * «Registrar autorización recibida por otro medio»: con el archivo que la prueba, la fecha en que el cliente autorizó,
 * el medio, la versión que se le mostró y las casillas que cubre. Solo si el workspace la encendió.
 */
export async function registrarAutorizacionConEvidencia(
  negocioBloqueId: string,
  form: FormData,
): Promise<{ error: string | null }> {
  const c = await contactoDelBloque(negocioBloqueId, true)
  if (c.error !== null) return { error: c.error }
  const casillas: Record<string, boolean> = {}
  for (const clave of ['generales', 'sensibles', 'menores', 'ofertas']) casillas[clave] = form.get(`casilla_${clave}`) === 'on'
  const archivo = form.get('archivo')
  const r = await registrarConEvidencia({
    workspaceId: c.workspaceId,
    contactoId: c.contactoId,
    negocioId: c.negocioId,
    staffId: c.staffId,
    textoId: String(form.get('texto_id') ?? ''),
    fecha: String(form.get('fecha') ?? ''),
    medio: String(form.get('medio') ?? ''),
    casillas,
    archivo: archivo instanceof File ? archivo : null,
  })
  if (!r.ok) return { error: MENSAJE_EVIDENCIA[r.error] }
  revalidatePath(`/negocios/${c.negocioId}`)
  return { error: null }
}
