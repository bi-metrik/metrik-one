'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { guardEditarBloque, guardVerNegocio } from '@/lib/permissions/guard-negocio'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import {
  separarCampos,
  estadoAutorizacion,
  AUTORIZACION_SLUG,
  AUTORIZACION_FECHA_SLUG,
  AUTORIZACION_AUTOR_SLUG,
  type ValoresContacto,
} from '@/lib/contactos/campos-contacto'

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
  // La autorizacion tiene su propia accion, con su estampa de fecha y autor. Dejarla
  // entrar por aqui permitiria marcarla como un campo mas y perder la trazabilidad.
  delete custom[AUTORIZACION_SLUG]
  delete custom[AUTORIZACION_FECHA_SLUG]
  delete custom[AUTORIZACION_AUTOR_SLUG]

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

/**
 * Registra la autorizacion de tratamiento de datos en el CONTACTO.
 *
 * Deja estampa de fecha y autor, y una linea en la bitacora del contacto: es el dato que
 * habilita el gate y el unico con consecuencia legal de todo el bloque. En Airtable el
 * campo equivalente lleva dos anos al 0% de llenado, asi que aqui se registra donde se
 * consulta y no donde se digita.
 *
 * No se puede revocar desde el negocio. Retirar una autorizacion es un acto del titular,
 * se atiende en su ficha, y un boton de un clic dentro de un viaje no es el sitio.
 */
export async function registrarAutorizacionContacto(
  negocioBloqueId: string,
): Promise<{ error: string | null; fecha: string | null }> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado', fecha: null }

  const guard = await guardEditarBloque(negocioBloqueId)
  if (!guard.ok) return { error: guard.error ?? 'Sin permiso', fecha: null }

  const res = await resolverContacto(supabase, workspaceId, negocioBloqueId)
  if (res.error) return { error: res.error, fecha: null }
  if (!res.contactoId) return { error: 'Este negocio no tiene contacto asociado', fecha: null }

  const { data: actual } = await supabase
    .from('contactos')
    .select('nombre, custom_data')
    .eq('id', res.contactoId)
    .eq('workspace_id', workspaceId)
    .maybeSingle()
  if (!actual) return { error: 'Contacto no encontrado', fecha: null }

  const row = actual as { nombre: string; custom_data: Record<string, unknown> | null }
  const previo = row.custom_data ?? {}
  const yaEstaba = estadoAutorizacion(previo)
  // Re-registrar pisaria la fecha original con la de hoy y envejeceria la autorizacion
  // hacia adelante. Si ya esta, no hay nada que hacer.
  if (yaEstaba.autorizado) return { error: null, fecha: yaEstaba.fecha }

  const fecha = new Date().toISOString()
  const { error: updErr } = await supabase
    .from('contactos')
    .update({
      custom_data: {
        ...previo,
        [AUTORIZACION_SLUG]: true,
        [AUTORIZACION_FECHA_SLUG]: fecha,
        [AUTORIZACION_AUTOR_SLUG]: staffId ?? null,
      },
      updated_at: fecha,
    })
    .eq('id', res.contactoId)
    .eq('workspace_id', workspaceId)
  if (updErr) return { error: (updErr as { message: string }).message, fecha: null }

  if (staffId) {
    await registrarActividad(
      supabase,
      {
        workspace_id: workspaceId,
        entidad_tipo: 'contacto',
        entidad_id: res.contactoId,
        tipo: 'cambio',
        autor_id: staffId,
        contenido: 'Autorizacion de tratamiento de datos registrada desde el negocio',
        campo_modificado: AUTORIZACION_SLUG,
        valor_nuevo: 'true',
      },
      'registrarAutorizacionContacto',
    )
  }

  revalidatePath(`/negocios/${res.negocioId}`)
  revalidatePath(`/directorio/contacto/${res.contactoId}`)
  return { error: null, fecha }
}
