'use server'

import { cookies } from 'next/headers'
import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'

const IMPERSONATE_COOKIE = '__impersonate'

export interface ImpersonationOption {
  id: string
  full_name: string | null
  role: string
}

/**
 * Lista los usuarios del workspace para el selector "Ver como".
 * Devuelve ok=false (y lista vacía) si el usuario no es platform_admin.
 */
export async function getImpersonationOptions(): Promise<{
  ok: boolean
  users: ImpersonationOption[]
  current: string | null
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, users: [], current: null }

  const { data: profile } = await supabase
    .from('profiles')
    .select('workspace_id, platform_admin')
    .eq('id', user.id)
    .single()
  if (!(profile as { platform_admin?: boolean } | null)?.platform_admin) {
    return { ok: false, users: [], current: null }
  }

  const { data: users } = await supabase
    .from('profiles')
    .select('id, full_name, role')
    .eq('workspace_id', (profile as { workspace_id: string }).workspace_id)
    .order('full_name', { ascending: true })

  const cookieStore = await cookies()
  const current = cookieStore.get(IMPERSONATE_COOKIE)?.value ?? null

  return {
    ok: true,
    users: (users ?? []) as ImpersonationOption[],
    current: current && current !== user.id ? current : null,
  }
}

/**
 * Activa o desactiva la impersonación. Solo platform_admin. targetProfileId
 * null (o el propio id) limpia la impersonación.
 */
export async function setImpersonation(
  targetProfileId: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'No autenticado' }

  const { data: profile } = await supabase
    .from('profiles')
    .select('platform_admin, workspace_id')
    .eq('id', user.id)
    .single()
  if (!(profile as { platform_admin?: boolean } | null)?.platform_admin) {
    return { ok: false, error: 'Solo platform_admin puede usar Ver como' }
  }

  const cookieStore = await cookies()
  if (!targetProfileId || targetProfileId === user.id) {
    cookieStore.delete(IMPERSONATE_COOKIE)
  } else {
    // Validar que el objetivo pertenece al mismo workspace
    const { data: target } = await supabase
      .from('profiles')
      .select('id')
      .eq('id', targetProfileId)
      .eq('workspace_id', (profile as { workspace_id: string }).workspace_id)
      .maybeSingle()
    if (!target) return { ok: false, error: 'Usuario no encontrado en el workspace' }
    cookieStore.set(IMPERSONATE_COOKIE, targetProfileId, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
    })
  }

  revalidatePath('/', 'layout')
  return { ok: true }
}
