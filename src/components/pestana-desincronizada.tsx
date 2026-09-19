'use client'

import { useState, useTransition } from 'react'
import { AlertTriangle, ArrowRight, Loader2, Undo2 } from 'lucide-react'
import MetrikLockup from '@/components/metrik-lockup'
import { switchWorkspace } from '@/lib/actions/platform-admin'
import { redirectAfterSwitch } from '@/lib/workspace/redirigir-tras-switch'

/**
 * Lo que ve una pestaña que quedó en otro espacio de trabajo.
 *
 * El corte de escrituras lo hace `getWorkspace` (`lib/tenant/desincronizacion.ts` explica
 * por qué el subdominio no decide el inquilino). Esta pantalla es lo que lo vuelve
 * entendible: sin ella, la pestaña se quedaría en blanco o pidiendo login, y el usuario
 * no tendría forma de saber que el cambio lo hizo él mismo en otra pestaña.
 *
 * Tiene UNA sola puerta: la ruta `/pestana-desincronizada` (fuera de `(app)`), a donde
 * manda el middleware. Vivía dentro de `(app)/layout.tsx`, renderizada en lugar de
 * `AppShell` + children, y ahí era invisible en toda navegación del lado del cliente: el
 * layout no vuelve a correr (medido el 2026-09-19 con un clic real en el nav, ver
 * `middleware.ts`). El layout ya solo detecta y redirige a esta ruta.
 */

export type WorkspaceDePestana = { id: string; slug: string; name: string }

export function PestanaDesincronizada({
  slugPestana,
  slugSesion,
  nombreSesion,
  urlSesion,
  workspaceDePestana,
}: {
  /** Slug del subdominio por el que entró esta pestaña (lo pone el middleware). */
  slugPestana: string
  /** Slug del workspace que tiene la sesión ahora mismo. */
  slugSesion: string
  nombreSesion: string
  /** Raíz del subdominio de la sesión, armada en el servidor con el dominio base. */
  urlSesion: string
  /**
   * Solo llega con valor cuando quien mira es platform admin y el workspace de la
   * pestaña está en su lista. Es la única vía al botón de volver, y `switchWorkspace`
   * vuelve a exigir platform_admin del lado del servidor. Para el resto queda en null:
   * el nombre de un workspace ajeno no se pinta, el slug sí, porque está en la barra de
   * direcciones de esa misma pestaña.
   */
  workspaceDePestana: WorkspaceDePestana | null
}) {
  const [isPending, startTransition] = useTransition()
  const [errorAlVolver, setErrorAlVolver] = useState<string | null>(null)

  const nombrePestana = workspaceDePestana?.name ?? slugPestana

  function handleVolver() {
    if (!workspaceDePestana) return
    setErrorAlVolver(null)
    startTransition(async () => {
      const res = await switchWorkspace(workspaceDePestana.id)
      if ('error' in res && res.error) {
        setErrorAlVolver(res.error)
        return
      }
      const actionLink = 'actionLink' in res ? res.actionLink : null
      redirectAfterSwitch(workspaceDePestana.slug, actionLink)
    })
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-8 text-center">
        <MetrikLockup size="md" />

        <div className="space-y-3">
          <div className="flex justify-center">
            <AlertTriangle className="h-6 w-6 text-amber-600" aria-hidden="true" />
          </div>
          <h1
            className="text-xl font-bold text-foreground"
            style={{ fontFamily: 'var(--font-schibsted), sans-serif' }}
          >
            Esta pestaña quedó en otro espacio de trabajo
          </h1>
          <p className="text-sm text-muted-foreground">
            La abriste en{' '}
            <strong className="font-medium text-foreground" data-desync="nombre-pestana">
              {nombrePestana}
            </strong>{' '}
            y tu sesión está ahora en{' '}
            <strong className="font-medium text-foreground" data-desync="nombre-sesion">
              {nombreSesion}
            </strong>
            . Pasa cuando se cambia de espacio de trabajo desde otra pestaña: el espacio
            activo es uno solo por usuario, así que el cambio se lleva todas las pestañas
            abiertas.
          </p>
          <p className="text-sm text-muted-foreground">
            Mientras tanto esta pestaña no muestra ni guarda nada, para que ningún dato
            termine en el espacio equivocado.
          </p>
        </div>

        <div className="space-y-2 rounded-lg border border-border bg-background p-4 text-left text-xs">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">Esta pestaña</span>
            <span className="font-mono text-foreground" data-desync="slug-pestana">
              {slugPestana}
            </span>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-muted-foreground">Tu sesión</span>
            <span className="font-mono text-foreground" data-desync="slug-sesion">
              {slugSesion}
            </span>
          </div>
        </div>

        <div className="space-y-2">
          <a
            href={urlSesion}
            data-desync="continuar"
            className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-acento text-sm font-medium text-white transition-colors hover:bg-acento-hover"
          >
            Continuar en {nombreSesion}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </a>

          {workspaceDePestana && (
            <button
              type="button"
              onClick={handleVolver}
              disabled={isPending}
              data-desync="volver"
              className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background text-sm font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Undo2 className="h-4 w-4" aria-hidden="true" />
              )}
              Traer esta pestaña de vuelta a {nombrePestana}
            </button>
          )}

          {errorAlVolver && (
            <p className="text-xs text-red-600" role="alert">
              No se pudo cambiar de espacio: {errorAlVolver}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}

export default PestanaDesincronizada
