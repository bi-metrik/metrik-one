'use client'

/**
 * Hook useBloqueLock — Superficie 5 spec UX 2026-05-20.
 *
 * Trigger de claim: NO al mount. Solo cuando el usuario hace foco en un input
 * editable del bloque (gotcha Noor — evita locks fantasma por scroll/preview).
 *
 * Estados:
 *   - idle: no claimed (default)
 *   - claiming: request inflight
 *   - mine: yo tengo el lock
 *   - theirs: otro lo tiene
 *   - expired: lock vencido sin renovar
 *   - heartbeat_failed: heartbeat fallo 3x consecutivos
 *
 * Heartbeat cada 60s mientras status === 'mine'.
 * Release en onBlur (debounced) + beforeunload via sendBeacon.
 * Realtime Supabase: subscribir a bloque_locks para reflejar force_unlock.
 *
 * Server actions consumidas (todas existentes Fase 2):
 *   claimBloqueLock, releaseBloqueLock, heartbeatBloqueLock, forceUnlockBloque
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import {
  claimBloqueLock,
  releaseBloqueLock,
  heartbeatBloqueLock,
  forceUnlockBloque,
} from '@/lib/actions/bloque-locks'
import { createClient } from '@/lib/supabase/client'

export type LockStatus =
  | 'idle'
  | 'claiming'
  | 'mine'
  | 'theirs'
  | 'expired'
  | 'heartbeat_failed'

export interface UseBloqueLockState {
  status: LockStatus
  heldByName: string | null
  heldById: string | null
  /** ISO timestamp cuando expira. */
  expiresAt: string | null
  /** Segundos restantes (live). */
  remainingSec: number | null
}

export interface UseBloqueLockApi extends UseBloqueLockState {
  /** Llama al backend para tomar el lock. */
  claim: () => Promise<boolean>
  /** Llama al backend para soltar el lock. */
  release: () => Promise<void>
  /** Forzar unlock (solo owner/admin — el server lo valida). */
  forceUnlock: () => Promise<boolean>
}

const HEARTBEAT_MS = 60_000
const MAX_HEARTBEAT_FAILS = 3
const REMAINING_TICK_MS = 1_000

interface UseBloqueLockOptions {
  /** Callback cuando perdimos el lock por expiracion server. */
  onLockLost?: () => void
  /** Habilita realtime sub. Default true. */
  realtime?: boolean
}

export function useBloqueLock(
  bloqueInstanciaId: string | null,
  opts?: UseBloqueLockOptions,
): UseBloqueLockApi {
  const realtimeEnabled = opts?.realtime ?? true

  const [state, setState] = useState<UseBloqueLockState>({
    status: 'idle',
    heldByName: null,
    heldById: null,
    expiresAt: null,
    remainingSec: null,
  })

  const heartbeatTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const remainingTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const heartbeatFails = useRef(0)
  const statusRef = useRef<LockStatus>('idle')
  statusRef.current = state.status

  // ── claim ──────────────────────────────────────────────────────────
  const claim = useCallback(async (): Promise<boolean> => {
    if (!bloqueInstanciaId) return false
    setState((s) => ({ ...s, status: 'claiming' }))
    const res = await claimBloqueLock(bloqueInstanciaId)
    if (res.ok) {
      setState({
        status: 'mine',
        heldByName: null,
        heldById: null,
        expiresAt: res.expires_at ?? res.lock?.expires_at ?? null,
        remainingSec: null,
      })
      heartbeatFails.current = 0
      return true
    }
    if (res.error === 'busy' && res.held_by) {
      setState({
        status: 'theirs',
        heldByName: res.held_by.name,
        heldById: res.held_by.id,
        expiresAt: res.expires_at ?? null,
        remainingSec: null,
      })
    } else {
      setState((s) => ({ ...s, status: 'idle' }))
    }
    return false
  }, [bloqueInstanciaId])

  // ── release ────────────────────────────────────────────────────────
  const release = useCallback(async () => {
    if (!bloqueInstanciaId) return
    if (statusRef.current !== 'mine') return
    await releaseBloqueLock(bloqueInstanciaId)
    setState({
      status: 'idle',
      heldByName: null,
      heldById: null,
      expiresAt: null,
      remainingSec: null,
    })
  }, [bloqueInstanciaId])

  // ── forceUnlock ────────────────────────────────────────────────────
  const forceUnlock = useCallback(async (): Promise<boolean> => {
    if (!bloqueInstanciaId) return false
    const res = await forceUnlockBloque(bloqueInstanciaId)
    if (res.ok) {
      setState({
        status: 'idle',
        heldByName: null,
        heldById: null,
        expiresAt: null,
        remainingSec: null,
      })
      return true
    }
    return false
  }, [bloqueInstanciaId])

  // ── Heartbeat loop ────────────────────────────────────────────────
  useEffect(() => {
    if (state.status !== 'mine' || !bloqueInstanciaId) return
    heartbeatTimer.current = setInterval(async () => {
      const res = await heartbeatBloqueLock(bloqueInstanciaId)
      if (res.ok) {
        heartbeatFails.current = 0
        if (res.expires_at) {
          setState((s) => ({ ...s, expiresAt: res.expires_at ?? s.expiresAt }))
        }
      } else {
        heartbeatFails.current += 1
        if (heartbeatFails.current >= MAX_HEARTBEAT_FAILS) {
          setState((s) => ({ ...s, status: 'heartbeat_failed' }))
          opts?.onLockLost?.()
        }
      }
    }, HEARTBEAT_MS)
    return () => {
      if (heartbeatTimer.current) clearInterval(heartbeatTimer.current)
      heartbeatTimer.current = null
    }
    // opts.onLockLost intentionally excluded from deps — would re-trigger on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, bloqueInstanciaId])

  // ── Countdown remaining ───────────────────────────────────────────
  useEffect(() => {
    if (!state.expiresAt) return
    function tick() {
      if (!state.expiresAt) return
      const ms = new Date(state.expiresAt).getTime() - Date.now()
      const sec = Math.max(0, Math.floor(ms / 1000))
      setState((s) => (s.remainingSec === sec ? s : { ...s, remainingSec: sec }))
      if (sec === 0 && statusRef.current === 'mine') {
        setState((s) => ({ ...s, status: 'expired' }))
        opts?.onLockLost?.()
      }
    }
    tick()
    remainingTimer.current = setInterval(tick, REMAINING_TICK_MS)
    return () => {
      if (remainingTimer.current) clearInterval(remainingTimer.current)
      remainingTimer.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.expiresAt])

  // ── beforeunload + visibilitychange ───────────────────────────────
  useEffect(() => {
    if (!bloqueInstanciaId) return
    function handleBeforeUnload() {
      if (statusRef.current !== 'mine') return
      // sendBeacon a endpoint dedicado (no podemos usar server action cross-page-unload)
      try {
        const blob = new Blob([JSON.stringify({ bloque_instancia_id: bloqueInstanciaId })], {
          type: 'application/json',
        })
        navigator.sendBeacon('/api/locks/release', blob)
      } catch {
        // ignore
      }
    }
    function handleVisibility() {
      // Si tab oculta y tiene lock, dejar que heartbeat falle eventualmente
      // (no release voluntario — usuario podria volver pronto)
    }
    window.addEventListener('beforeunload', handleBeforeUnload)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [bloqueInstanciaId])

  // ── Realtime sub (decision A2) ────────────────────────────────────
  useEffect(() => {
    if (!realtimeEnabled || !bloqueInstanciaId) return
    const supabase = createClient()
    const channel = supabase
      .channel(`bloque_lock:${bloqueInstanciaId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'bloque_locks',
          filter: `bloque_instancia_id=eq.${bloqueInstanciaId}`,
        },
        (payload) => {
          // INSERT/UPDATE/DELETE en este lock
          if (payload.eventType === 'DELETE') {
            // Lock removido (force_unlock o release). Si tengo el lock, perdi.
            if (statusRef.current === 'mine') {
              setState({
                status: 'expired',
                heldByName: null,
                heldById: null,
                expiresAt: null,
                remainingSec: null,
              })
              opts?.onLockLost?.()
            } else if (statusRef.current === 'theirs') {
              setState({
                status: 'idle',
                heldByName: null,
                heldById: null,
                expiresAt: null,
                remainingSec: null,
              })
            }
          } else {
            // INSERT/UPDATE: re-claim para conocer estado real (held_by ajeno o yo)
            void claim()
          }
        },
      )
      .subscribe()
    return () => {
      void supabase.removeChannel(channel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bloqueInstanciaId, realtimeEnabled])

  return {
    ...state,
    claim,
    release,
    forceUnlock,
  }
}
