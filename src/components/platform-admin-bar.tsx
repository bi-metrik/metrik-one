'use client'

import { useState, useTransition } from 'react'
import { Shield, ChevronDown, Home, Loader2 } from 'lucide-react'
import {
  switchWorkspace,
  returnHome,
  type PlatformAdminState,
} from '@/lib/actions/platform-admin'
import { agruparWorkspaces } from '@/lib/workspace/grupo'
// Redirige al subdomain target via magic link cuando se proporciona (caso normal
// - siembra sesion en subdomain destino) o directo (fallback local/dev). Se mudo a
// `lib/workspace` para que la pantalla de pestaña desincronizada use el mismo camino.
import { redirectAfterSwitch } from '@/lib/workspace/redirigir-tras-switch'

/**
 * El desplegable de workspaces, usado por las DOS ramas de la barra.
 *
 * Antes vivía solo en la rama de casa, así que estando dentro de un workspace ajeno la
 * única salida era "Regresar a {home}": para ir de un cliente a otro había que pasar por
 * MeTRIK. `switchWorkspace` ya soportaba A → B; lo que faltaba era la puerta.
 *
 * `paleta` solo cambia el BOTÓN. En el banner ámbar del modo away un botón gris desentona,
 * pero el panel es el mismo en los dos modos a propósito: es la misma lista.
 */
function SelectorDeWorkspaces({
  state,
  onSwitch,
  isPending,
  paleta = 'gris',
}: {
  state: PlatformAdminState
  onSwitch: (targetId: string, targetSlug: string) => void
  isPending: boolean
  paleta?: 'gris' | 'ambar'
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')

  const filtered = state.workspaces.filter(w => {
    if (!query) return true
    const q = query.toLowerCase()
    return w.name.toLowerCase().includes(q) || w.slug.toLowerCase().includes(q)
  })
  // Agrupa DESPUÉS de filtrar: un grupo sin coincidencias no deja su encabezado vacío.
  const grupos = agruparWorkspaces(filtered)

  const claseBoton =
    paleta === 'ambar'
      ? 'border-amber-400 bg-white text-amber-900 hover:bg-amber-100'
      : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-100'
  const claseEscudo = paleta === 'ambar' ? 'text-amber-700' : 'text-slate-500'
  const claseChevron = paleta === 'ambar' ? 'text-amber-600' : 'text-slate-400'

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        disabled={isPending}
        className={
          'inline-flex items-center gap-1.5 rounded-md border px-3 py-1 text-xs font-medium disabled:opacity-50 ' +
          claseBoton
        }
      >
        <Shield className={'h-3.5 w-3.5 ' + claseEscudo} />
        Platform Admin
        <ChevronDown className={'h-3 w-3 ' + claseChevron} />
      </button>

      {open && (
        // `z-50` explícito: el panel es `absolute` dentro de una barra sticky, y así queda
        // por encima del contenido de la página en los dos modos.
        <div className="absolute right-0 top-full z-50 mt-1 w-72 rounded-lg border border-slate-200 bg-white text-xs shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <input
              type="text"
              placeholder="Buscar workspace..."
              value={query}
              onChange={e => setQuery(e.target.value)}
              className="w-full rounded-md border border-slate-200 px-2 py-1 text-xs outline-none focus:border-acento-claro"
              autoFocus
            />
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <div className="px-3 py-4 text-center text-xs text-slate-400">
                Sin resultados
              </div>
            )}
            {grupos.map(g => (
              <div key={g.clave} role="group" aria-label={g.etiqueta}>
                <div className="sticky top-0 bg-white px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                  {g.etiqueta}
                </div>
                {g.workspaces.map(w => {
                  const isCurrent = w.id === state.currentWorkspace?.id
                  return (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => {
                        setOpen(false)
                        onSwitch(w.id, w.slug)
                      }}
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
                        <span className="shrink-0 rounded bg-acento/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-acento">
                          Aqui
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export function PlatformAdminBar({ state }: { state: PlatformAdminState | null }) {
  const [isPending, startTransition] = useTransition()

  if (!state) return null

  function handleSwitch(targetId: string, targetSlug: string) {
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

  // ── Modo AWAY: banner amarillo destacado, con salto directo a otro workspace ──
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
        <div className="flex shrink-0 items-center gap-2">
          <SelectorDeWorkspaces
            state={state}
            onSwitch={handleSwitch}
            isPending={isPending}
            paleta="ambar"
          />
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
      </div>
    )
  }

  // ── Modo HOME: dropdown discreto para entrar a otro workspace ──
  return (
    <div className="sticky top-0 z-40 flex items-center justify-end gap-2 border-b border-slate-200 bg-slate-50 px-4 py-1.5 text-xs">
      <SelectorDeWorkspaces state={state} onSwitch={handleSwitch} isPending={isPending} />
    </div>
  )
}
