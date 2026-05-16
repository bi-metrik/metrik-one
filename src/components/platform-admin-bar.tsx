'use client'

import { useState, useTransition } from 'react'
import { Shield, ChevronDown, Home, Loader2 } from 'lucide-react'
import {
  switchWorkspace,
  returnHome,
  type PlatformAdminState,
} from '@/lib/actions/platform-admin'

// Redirige al subdomain target via magic link cuando se proporciona (caso normal
// — siembra sesion en subdomain destino) o directo (fallback local/dev).
function redirectAfterSwitch(targetSlug: string, actionLink: string | null | undefined) {
  if (typeof window === 'undefined') return
  if (actionLink) {
    window.location.href = actionLink
    return
  }
  // Fallback (dev local sin subdomain routing real, o si generateLink falla)
  const baseDomain = process.env.NEXT_PUBLIC_BASE_DOMAIN || 'metrikone.co'
  if (
    window.location.hostname === 'localhost' ||
    window.location.hostname.endsWith('.localhost')
  ) {
    window.location.reload()
    return
  }
  const protocol = window.location.protocol
  window.location.href = `${protocol}//${targetSlug}.${baseDomain}/`
}

export function PlatformAdminBar({ state }: { state: PlatformAdminState | null }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [isPending, startTransition] = useTransition()

  if (!state) return null

  const filtered = state.workspaces.filter(w => {
    if (!query) return true
    const q = query.toLowerCase()
    return w.name.toLowerCase().includes(q) || w.slug.toLowerCase().includes(q)
  })

  function handleSwitch(targetId: string, targetSlug: string) {
    setOpen(false)
    startTransition(async () => {
      const res = await switchWorkspace(targetId)
      if ('error' in res && res.error) {
        alert(`Error: ${res.error}`)
        return
      }
      const actionLink = 'actionLink' in res ? res.actionLink : null
      redirectAfterSwitch(targetSlug, actionLink)
    })
  }

  function handleReturnHome() {
    startTransition(async () => {
      const res = await returnHome()
      if ('error' in res && res.error) {
        alert(`Error: ${res.error}`)
        return
      }
      if ('targetSlug' in res && res.targetSlug) {
        const actionLink = 'actionLink' in res ? res.actionLink : null
        redirectAfterSwitch(res.targetSlug, actionLink)
      }
    })
  }

  // ── Modo AWAY: banner amarillo destacado con CTA de regreso ──
  if (state.isAway) {
    return (
      <div
        className="sticky top-0 z-50 flex items-center justify-between gap-3 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm"
        role="banner"
      >
        <div className="flex items-center gap-2 text-amber-900">
          <Shield className="h-4 w-4 shrink-0" />
          <span>
            Modo <strong>Platform Admin</strong> — viendo workspace{' '}
            <strong>{state.currentWorkspace?.name ?? '(desconocido)'}</strong>
          </span>
        </div>
        <button
          type="button"
          onClick={handleReturnHome}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-amber-400 bg-white px-3 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
        >
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Home className="h-3.5 w-3.5" />
          )}
          Regresar a {state.homeWorkspace?.name ?? 'home'}
        </button>
      </div>
    )
  }

  // ── Modo HOME: dropdown discreto para entrar a otro workspace ──
  return (
    <div className="sticky top-0 z-40 flex items-center justify-end gap-2 border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-xs">
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen(o => !o)}
          disabled={isPending}
          className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white px-3 py-1 font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
        >
          <Shield className="h-3.5 w-3.5 text-slate-500" />
          Platform Admin
          <ChevronDown className="h-3 w-3 text-slate-400" />
        </button>

        {open && (
          <div className="absolute right-0 top-full mt-1 w-72 rounded-lg border border-slate-200 bg-white shadow-lg">
            <div className="border-b border-slate-100 p-2">
              <input
                type="text"
                placeholder="Buscar workspace..."
                value={query}
                onChange={e => setQuery(e.target.value)}
                className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-emerald-400"
                autoFocus
              />
            </div>
            <div className="max-h-72 overflow-y-auto py-1">
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-center text-xs text-slate-400">
                  Sin resultados
                </div>
              )}
              {filtered.map(w => {
                const isCurrent = w.id === state.currentWorkspace?.id
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => handleSwitch(w.id, w.slug)}
                    disabled={isCurrent || isPending}
                    className={
                      'flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50 disabled:cursor-default disabled:opacity-50 ' +
                      (isCurrent ? 'bg-slate-50' : '')
                    }
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-slate-800">
                        {w.name}
                      </div>
                      <div className="truncate text-[10px] text-slate-400">
                        {w.slug}
                      </div>
                    </div>
                    {isCurrent && (
                      <span className="shrink-0 rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-emerald-700">
                        Aqui
                      </span>
                    )}
                  </button>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
