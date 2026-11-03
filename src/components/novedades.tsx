'use client'

/**
 * Tablero «Novedades»: la lista de `lib/novedades/novedades.ts` en un panel, y el numerito de las
 * que la persona no ha visto. Lo monta el AppShell (una entrada en el menú lateral y un botón en la
 * barra superior del teléfono, que comparten el mismo estado).
 */
import { useSyncExternalStore } from 'react'
import { Sparkles } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { formatFecha, todayBogotaISO } from '@/lib/dates/bogota'
import type { Novedad } from '@/lib/novedades/novedades'
import {
  EVENTO_NOVEDADES_VISTAS,
  contarNoVistas,
  leerVistasCrudo,
  parsearVistas,
} from '@/lib/novedades/vistas'

function suscribir(cambio: () => void): () => void {
  window.addEventListener('storage', cambio)
  window.addEventListener(EVENTO_NOVEDADES_VISTAS, cambio)
  return () => {
    window.removeEventListener('storage', cambio)
    window.removeEventListener(EVENTO_NOVEDADES_VISTAS, cambio)
  }
}

/**
 * Cuántas de `lista` no ha visto la persona. En el servidor y al hidratar es 0 (el navegador aún
 * no se leyó): el numerito aparece después, nunca hay texto distinto entre servidor y cliente.
 */
export function useNovedadesNoVistas(llave: string, lista: readonly Novedad[]): number {
  const crudo = useSyncExternalStore(
    suscribir,
    () => leerVistasCrudo(llave),
    () => null,
  )
  if (crudo === null) return 0
  return contarNoVistas(lista, parsearVistas(crudo), todayBogotaISO())
}

/** El numerito, con el mismo estilo del de la campana. */
export function NumeritoNovedades({ cuenta, className = '' }: { cuenta: number; className?: string }) {
  if (cuenta <= 0) return null
  return (
    <span
      data-numerito-novedades={cuenta}
      className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white ${className}`}
      style={{ backgroundColor: 'var(--acento)' }}
    >
      {cuenta > 9 ? '9+' : cuenta}
    </span>
  )
}

export function etiquetaNovedades(cuenta: number): string {
  if (cuenta <= 0) return 'Novedades'
  return cuenta === 1 ? 'Novedades, 1 sin ver' : `Novedades, ${cuenta} sin ver`
}

/** Botón de la barra superior del teléfono (al lado de la campana). */
export function BotonNovedades({ cuenta, onAbrir }: { cuenta: number; onAbrir: () => void }) {
  return (
    <button
      type="button"
      onClick={onAbrir}
      data-boton-novedades
      className="relative flex h-8 w-8 items-center justify-center rounded-md transition-colors hover:bg-accent"
      aria-label={etiquetaNovedades(cuenta)}
    >
      <Sparkles className="h-4 w-4 text-muted-foreground" />
      <NumeritoNovedades cuenta={cuenta} className="absolute -right-0.5 -top-0.5" />
    </button>
  )
}

export function PanelNovedades({
  abierto,
  onAbiertoChange,
  lista,
}: {
  abierto: boolean
  onAbiertoChange: (abierto: boolean) => void
  lista: readonly Novedad[]
}) {
  return (
    <Dialog open={abierto} onOpenChange={onAbiertoChange}>
      <DialogContent className="max-h-[85dvh] overflow-hidden p-0 gap-0 flex flex-col">
        <DialogHeader className="border-b border-border px-5 py-4 text-left">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            Novedades
          </DialogTitle>
          <DialogDescription className="text-xs">Lo que cambió recientemente.</DialogDescription>
        </DialogHeader>
        <ul className="flex-1 overflow-y-auto">
          {lista.map((n) => (
            <li key={n.id} data-novedad={n.id} className="border-b border-border/50 px-5 py-4 last:border-0">
              <p className="text-[11px] font-medium text-muted-foreground">
                {formatFecha(n.fecha, { day: 'numeric', month: 'long', year: 'numeric' })}
              </p>
              <p className="mt-0.5 text-sm font-semibold text-foreground">{n.titulo}</p>
              <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{n.texto}</p>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  )
}
