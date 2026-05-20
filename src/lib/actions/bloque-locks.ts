'use server'

/**
 * Server actions para lock pesimista de bloques (Modelo roles-areas-stages Fase 2)
 *
 * Las funciones SQL viven en migration 20260520000012_lock_functions.sql.
 * Aqui solo se envuelven con validaciones de sesion + workspace + rol.
 *
 * TTL default 5 min. Cliente debe llamar heartbeat cada ~60s (Fase 5 UI).
 */

import { getWorkspace } from '@/lib/actions/get-workspace'
import { createClient } from '@/lib/supabase/server'

type LockResultOk = {
  ok: true
  lock?: {
    locked_by: string
    locked_at: string
    expires_at: string
  }
  expires_at?: string
  note?: string
}

type LockResultErr = {
  ok: false
  error: string
  held_by?: { id: string; name: string }
  locked_at?: string
  expires_at?: string
}

export type LockResult = LockResultOk | LockResultErr

const TTL_MIN = 5

// ── claim ────────────────────────────────────────────────────────────
export async function claimBloqueLock(
  bloqueInstanciaId: string
): Promise<LockResult> {
  const { supabase, workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId || !userId) {
    return { ok: false, error: 'unauthenticated' }
  }

  // Cast to any: la funcion es nueva en migration 20260520000012, no esta
  // tipada en database.ts hasta proxima regeneracion.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: rpcErr } = await (supabase as any).rpc('claim_bloque_lock', {
    p_bloque_instancia_id: bloqueInstanciaId,
    p_profile_id: userId,
    p_workspace_id: workspaceId,
    p_ttl_minutes: TTL_MIN,
  })

  if (rpcErr) {
    return { ok: false, error: rpcErr.message }
  }
  return data as LockResult
}

// ── release ──────────────────────────────────────────────────────────
export async function releaseBloqueLock(
  bloqueInstanciaId: string
): Promise<LockResult> {
  const { supabase, userId, error } = await getWorkspace()
  if (error || !userId) return { ok: false, error: 'unauthenticated' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: rpcErr } = await (supabase as any).rpc('release_bloque_lock', {
    p_bloque_instancia_id: bloqueInstanciaId,
    p_profile_id: userId,
  })

  if (rpcErr) return { ok: false, error: rpcErr.message }
  return data as LockResult
}

// ── heartbeat ────────────────────────────────────────────────────────
export async function heartbeatBloqueLock(
  bloqueInstanciaId: string
): Promise<LockResult> {
  const { supabase, userId, error } = await getWorkspace()
  if (error || !userId) return { ok: false, error: 'unauthenticated' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: rpcErr } = await (supabase as any).rpc('heartbeat_bloque_lock', {
    p_bloque_instancia_id: bloqueInstanciaId,
    p_profile_id: userId,
    p_ttl_minutes: TTL_MIN,
  })

  if (rpcErr) return { ok: false, error: rpcErr.message }
  return data as LockResult
}

// ── forceUnlock (owner/admin only) ───────────────────────────────────
export async function forceUnlockBloque(
  bloqueInstanciaId: string
): Promise<LockResult> {
  const { workspaceId, userId, error } = await getWorkspace()
  if (error || !workspaceId || !userId) {
    return { ok: false, error: 'unauthenticated' }
  }

  // Validar rol owner/admin desde profiles
  const sb = await createClient()
  const { data: profile } = await sb
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .single()

  if (!profile || (profile.role !== 'owner' && profile.role !== 'admin')) {
    return { ok: false, error: 'forbidden' }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: rpcErr } = await (sb as any).rpc('force_unlock_bloque', {
    p_bloque_instancia_id: bloqueInstanciaId,
    p_forced_by: userId,
  })

  if (rpcErr) return { ok: false, error: rpcErr.message }
  return data as LockResult
}
