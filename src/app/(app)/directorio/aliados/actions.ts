'use server'

import { revalidatePath } from 'next/cache'
import { getWorkspace } from '@/lib/actions/get-workspace'
import { canGestionarAliados, type Area, type Role } from '@/lib/permissions/can-edit'

// La tabla `aliados` aun no esta en database.ts generado (migracion nueva) → cast.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function db(client: unknown): any {
  return client
}

export interface Aliado {
  id: string
  nombre: string
  nit: string | null
  contacto_nombre: string | null
  email: string | null
  telefono: string | null
  estado: string
  notas: string | null
  created_at: string | null
}

/** Opcion liviana para selectores (marcar un negocio como alianza). */
export interface AliadoOption {
  id: string
  nombre: string
}

export interface AliadoInput {
  nombre: string
  nit?: string | null
  contacto_nombre?: string | null
  email?: string | null
  telefono?: string | null
  notas?: string | null
}

const COLUMNAS = 'id, nombre, nit, contacto_nombre, email, telefono, estado, notas, created_at'

/**
 * Contexto de ESCRITURA. Guard server-side obligatorio: la UI oculta los botones,
 * pero la barrera real es esta (ver can-edit.ts → canGestionarAliados).
 */
async function ctxEscritura(): Promise<
  | { ok: true; supabase: unknown; workspaceId: string; userId: string | null }
  | { ok: false; error: string }
> {
  const { supabase, workspaceId, userId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return { ok: false, error: error ?? 'No autenticado' }

  const user = {
    id: '',
    role: (role ?? 'read_only') as Role,
    areas: (areas ?? []) as Area[],
  }
  if (!canGestionarAliados(user)) {
    return { ok: false, error: 'Solo el dueño o un supervisor del área comercial gestiona aliados' }
  }
  return { ok: true, supabase, workspaceId, userId }
}

/**
 * ¿El usuario actual puede crear/editar/desactivar aliados? Para que la UI
 * oculte los botones. NO sustituye el guard de cada action de escritura.
 */
export async function puedeGestionarAliados(): Promise<boolean> {
  const { workspaceId, role, areas, error } = await getWorkspace()
  if (error || !workspaceId) return false
  return canGestionarAliados({
    id: '',
    role: (role ?? 'read_only') as Role,
    areas: (areas ?? []) as Area[],
  })
}

/** Listado completo. Lectura abierta a cualquier usuario autenticado del workspace. */
export async function getAliados(): Promise<Aliado[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await db(supabase)
    .from('aliados')
    .select(COLUMNAS)
    .eq('workspace_id', workspaceId)
    .order('nombre', { ascending: true })

  return (data ?? []) as Aliado[]
}

/**
 * Aliados activos (id + nombre). Lo consume el resto del sistema para marcar
 * negocios de tipo "alianza". Lectura abierta como getAliados.
 */
export async function getAliadosActivos(): Promise<AliadoOption[]> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return []

  const { data } = await db(supabase)
    .from('aliados')
    .select('id, nombre')
    .eq('workspace_id', workspaceId)
    .eq('estado', 'activo')
    .order('nombre', { ascending: true })

  return (data ?? []) as AliadoOption[]
}

/** Normaliza texto opcional: vacio → null. */
function opt(value?: string | null): string | null {
  const v = (value ?? '').trim()
  return v === '' ? null : v
}

export async function crearAliado(
  input: AliadoInput,
): Promise<{ success: boolean; error?: string }> {
  const ctx = await ctxEscritura()
  if (!ctx.ok) return { success: false, error: ctx.error }

  const nombre = (input.nombre ?? '').trim()
  if (!nombre) return { success: false, error: 'El nombre es obligatorio' }

  const { error } = await db(ctx.supabase)
    .from('aliados')
    .insert({
      workspace_id: ctx.workspaceId,
      nombre,
      nit: opt(input.nit),
      contacto_nombre: opt(input.contacto_nombre),
      email: opt(input.email),
      telefono: opt(input.telefono),
      notas: opt(input.notas),
      created_by: ctx.userId,
    })

  if (error) return { success: false, error: error.message }
  revalidatePath('/directorio/aliados')
  return { success: true }
}

export async function actualizarAliado(
  id: string,
  input: AliadoInput,
): Promise<{ success: boolean; error?: string }> {
  const ctx = await ctxEscritura()
  if (!ctx.ok) return { success: false, error: ctx.error }

  const nombre = (input.nombre ?? '').trim()
  if (!nombre) return { success: false, error: 'El nombre es obligatorio' }

  const { error } = await db(ctx.supabase)
    .from('aliados')
    .update({
      nombre,
      nit: opt(input.nit),
      contacto_nombre: opt(input.contacto_nombre),
      email: opt(input.email),
      telefono: opt(input.telefono),
      notas: opt(input.notas),
    })
    .eq('id', id)
    .eq('workspace_id', ctx.workspaceId)

  if (error) return { success: false, error: error.message }
  revalidatePath('/directorio/aliados')
  return { success: true }
}

export async function cambiarEstadoAliado(
  id: string,
  estado: 'activo' | 'inactivo',
): Promise<{ success: boolean; error?: string }> {
  const ctx = await ctxEscritura()
  if (!ctx.ok) return { success: false, error: ctx.error }

  if (estado !== 'activo' && estado !== 'inactivo') {
    return { success: false, error: 'Estado inválido' }
  }

  const { error } = await db(ctx.supabase)
    .from('aliados')
    .update({ estado })
    .eq('id', id)
    .eq('workspace_id', ctx.workspaceId)

  if (error) return { success: false, error: error.message }
  revalidatePath('/directorio/aliados')
  return { success: true }
}

export async function eliminarAliado(
  id: string,
): Promise<{ success: boolean; error?: string }> {
  const ctx = await ctxEscritura()
  if (!ctx.ok) return { success: false, error: ctx.error }

  const { error } = await db(ctx.supabase)
    .from('aliados')
    .delete()
    .eq('id', id)
    .eq('workspace_id', ctx.workspaceId)

  if (error) return { success: false, error: error.message }
  revalidatePath('/directorio/aliados')
  return { success: true }
}
