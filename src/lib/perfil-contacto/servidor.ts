import 'server-only'

/**
 * El perfil del contacto del lado del servidor: leerlo y traducir lo que la base rechaza.
 *
 * La tabla se lee y escribe con el cliente del USUARIO (`authenticated`, RLS por workspace). Las
 * invariantes que no dependen de quién escribe están en el trigger de la tabla
 * (`20261012234500_contacto_perfil_hechos.sql`): contacto del workspace, autorización vigente para
 * crear o confirmar, transiciones de estado y hechos inmutables. Quien llama revisa antes el rol y la
 * autorización para dar un mensaje claro; el trigger es la red.
 */

import { estadoDelContacto } from '@/lib/autorizacion-datos/servidor'
import { hechoDeFila, type HechoPerfilVista } from './vista'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Cliente = any

export async function leerPerfil(
  supabase: Cliente,
  workspaceId: string,
  contactoId: string,
  o: { soloConfirmados?: boolean } = {},
): Promise<{ hechos: HechoPerfilVista[]; error: string | null }> {
  let q = supabase
    .from('contacto_perfil_hechos')
    .select('id, dimension, texto, estado, origen_tipo, created_at, confirmado_at')
    .eq('workspace_id', workspaceId)
    .eq('contacto_id', contactoId)
  q = o.soloConfirmados ? q.eq('estado', 'confirmado') : q.neq('estado', 'descartado')
  const { data, error } = await q.order('created_at', { ascending: true }).limit(300)
  if (error) return { hechos: [], error: (error as { message: string }).message }
  const hechos = ((data ?? []) as Array<Record<string, unknown>>).map(hechoDeFila).filter((h): h is HechoPerfilVista => !!h)
  return { hechos, error: null }
}

/** ¿Autorizó (vigente.generales, la regla de la RPC)? `null`: no se pudo revisar. */
export async function autorizacionVigente(workspaceId: string, contactoId: string): Promise<boolean | null> {
  const { estado, error } = await estadoDelContacto(workspaceId, contactoId)
  if (error) return null
  return estado.vigente.generales === true
}

/** Lo que la base rechazó, dicho a una persona. */
export function mensajeDeErrorPerfil(e: { message?: string; code?: string } | null, nombre = 'Este contacto'): string {
  const m = e?.message ?? ''
  if (m.includes('perfil_sin_autorizacion')) return `${nombre} todavía no autoriza el uso de sus datos: no se puede guardar en su perfil.`
  if (e?.code === '23505') return 'Eso ya está en su perfil.'
  if (m.includes('perfil_transicion_invalida')) return 'Ese dato ya cambió de estado. Recarga la página.'
  return 'No se pudo guardar en el perfil.'
}
