'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { configDelWorkspace } from '@/lib/autorizacion-datos/servidor'
import { contactoYResponsable } from '@/lib/contactos/permiso-contacto'
import { autorizacionVigente, leerPerfil, mensajeDeErrorPerfil } from '@/lib/perfil-contacto/servidor'
import { puedeEditarPerfil, puedeVerPerfil, validarHechoManual, type HechoPerfilVista } from '@/lib/perfil-contacto/vista'

/**
 * El perfil del contacto desde su ficha en el directorio: ver lo que hay (agrupado por dimensión),
 * confirmar o descartar lo sugerido y agregar a mano. Mismos permisos que la sección de
 * autorización (#1138).
 *
 * Solo en workspaces que usan la autorización de datos (`config_extra.autorizacion_datos`): sin
 * autorización vigente no se guarda nada en el perfil, así que sin ese mecanismo la sección no
 * tiene cómo funcionar y no se muestra.
 *
 * Descartar es un cambio de estado, nunca un borrado (la sesión no tiene DELETE sobre la tabla).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

const SIN_ACCESO = 'Tu rol no tiene acceso al perfil de este contacto'

type Contexto =
  | { error: string }
  | { error: null; activa: false }
  | {
      error: null
      activa: true
      supabase: Cliente
      workspaceId: string
      userId: string | null
      staffId: string | null
      contactoId: string
      nombre: string
      puedeEditar: boolean
    }

async function contexto(contactoId: string, editar: boolean): Promise<Contexto> {
  const { supabase, workspaceId, userId, role, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { error: 'No autenticado' }
  const { config } = await configDelWorkspace(workspaceId)
  if (!config.activa) return { error: null, activa: false }
  if (!puedeVerPerfil(role)) return { error: SIN_ACCESO }

  const { existe, esResponsable } = await contactoYResponsable({
    supabase: supabase as Cliente, workspaceId, role, staffId: staffId ?? null, contactoId,
  })
  if (!existe) return { error: 'Contacto no encontrado' }
  const puedeEditar = puedeEditarPerfil(role, esResponsable)
  if (editar && !puedeEditar) return { error: 'Tu rol no permite cambiar el perfil de este contacto' }

  const { data: c } = await (supabase as Cliente)
    .from('contactos').select('nombre').eq('id', contactoId).eq('workspace_id', workspaceId).maybeSingle()
  return {
    error: null, activa: true, supabase, workspaceId, userId: userId ?? null, staffId: staffId ?? null, contactoId,
    nombre: String((c as { nombre?: string } | null)?.nombre ?? 'Este contacto'), puedeEditar,
  }
}

export interface PerfilDeContacto {
  hechos: HechoPerfilVista[]
  puedeEditar: boolean
  /** `vigente.generales`; `null` si no se pudo revisar. Sin ella no se agrega ni se confirma. */
  autorizado: boolean | null
  nombre: string
}

export async function cargarPerfilDeContacto(
  contactoId: string,
): Promise<{ perfil: PerfilDeContacto | null; error: string | null }> {
  const c = await contexto(contactoId, false)
  // Sin acceso por rol (contador) o sin el mecanismo de autorización: la ficha no muestra la sección.
  if (c.error === SIN_ACCESO) return { perfil: null, error: null }
  if (c.error !== null) return { perfil: null, error: c.error }
  if (!c.activa) return { perfil: null, error: null }
  const [{ hechos, error }, autorizado] = await Promise.all([
    leerPerfil(c.supabase, c.workspaceId, c.contactoId),
    autorizacionVigente(c.workspaceId, c.contactoId),
  ])
  if (error) {
    console.error('[cargarPerfilDeContacto]', error)
    return { perfil: null, error: 'No se pudo leer el perfil' }
  }
  return { perfil: { hechos, puedeEditar: c.puedeEditar, autorizado, nombre: c.nombre }, error: null }
}

async function conAutorizacion(c: Extract<Contexto, { activa: true }>): Promise<string | null> {
  const a = await autorizacionVigente(c.workspaceId, c.contactoId)
  if (a === null) return 'No se pudo revisar la autorización de datos. Intenta de nuevo.'
  if (!a) return `${c.nombre} todavía no autoriza el uso de sus datos: no se puede guardar en su perfil.`
  return null
}

/** «Agregar» a mano: queda confirmado, con origen `manual` y quien lo escribió. */
export async function agregarHechoPerfil(
  contactoId: string,
  dimension: string,
  texto: string,
): Promise<{ error: string | null }> {
  const c = await contexto(contactoId, true)
  if (c.error !== null) return { error: c.error }
  if (!c.activa) return { error: 'Este workspace no usa el perfil de contactos' }
  const v = validarHechoManual(dimension, texto)
  if (!v.ok) return { error: v.error }
  const sinAut = await conAutorizacion(c)
  if (sinAut) return { error: sinAut }
  const ahora = new Date().toISOString()
  const { error } = await c.supabase.from('contacto_perfil_hechos').insert({
    workspace_id: c.workspaceId,
    contacto_id: c.contactoId,
    dimension: v.dimension,
    texto: v.texto,
    estado: 'confirmado',
    origen_tipo: 'manual',
    origen_ref: `usuario:${c.userId ?? c.staffId ?? 'desconocido'}`,
    creado_por: c.staffId,
    confirmado_por: c.staffId,
    confirmado_at: ahora,
  })
  if (error) {
    console.error('[agregarHechoPerfil]', error)
    return { error: mensajeDeErrorPerfil(error, c.nombre) }
  }
  revalidatePath(`/directorio/contacto/${c.contactoId}`)
  return { error: null }
}

/** Confirmar un sugerido (lo que el bot separó de una conversación). */
export async function confirmarHechoPerfil(contactoId: string, hechoId: string): Promise<{ error: string | null }> {
  const c = await contexto(contactoId, true)
  if (c.error !== null) return { error: c.error }
  if (!c.activa) return { error: 'Este workspace no usa el perfil de contactos' }
  const sinAut = await conAutorizacion(c)
  if (sinAut) return { error: sinAut }
  const { data, error } = await c.supabase
    .from('contacto_perfil_hechos')
    .update({ estado: 'confirmado', confirmado_por: c.staffId, confirmado_at: new Date().toISOString() })
    .eq('id', hechoId)
    .eq('contacto_id', c.contactoId)
    .eq('workspace_id', c.workspaceId)
    .eq('estado', 'sugerido')
    .select('id')
  if (error) {
    console.error('[confirmarHechoPerfil]', error)
    return { error: mensajeDeErrorPerfil(error, c.nombre) }
  }
  if (!((data ?? []) as unknown[]).length) return { error: 'Ese dato ya cambió de estado. Recarga la página.' }
  revalidatePath(`/directorio/contacto/${c.contactoId}`)
  return { error: null }
}

/** Descartar (sugerido o confirmado): cambio de estado, no borrado. Un descartado no se vuelve a sugerir. */
export async function descartarHechoPerfil(contactoId: string, hechoId: string): Promise<{ error: string | null }> {
  const c = await contexto(contactoId, true)
  if (c.error !== null) return { error: c.error }
  if (!c.activa) return { error: 'Este workspace no usa el perfil de contactos' }
  const { data, error } = await c.supabase
    .from('contacto_perfil_hechos')
    .update({ estado: 'descartado', descartado_por: c.staffId, descartado_at: new Date().toISOString() })
    .eq('id', hechoId)
    .eq('contacto_id', c.contactoId)
    .eq('workspace_id', c.workspaceId)
    .in('estado', ['sugerido', 'confirmado'])
    .select('id')
  if (error) {
    console.error('[descartarHechoPerfil]', error)
    return { error: mensajeDeErrorPerfil(error, c.nombre) }
  }
  if (!((data ?? []) as unknown[]).length) return { error: 'Ese dato ya cambió de estado. Recarga la página.' }
  revalidatePath(`/directorio/contacto/${c.contactoId}`)
  return { error: null }
}
