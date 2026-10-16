'use client'

import { ClipboardPaste, ExternalLink } from 'lucide-react'

import { CONSEJO_FALLA, TITULO_FALLA, type MotivoFallaPagina } from '@/lib/fotos/falla-pagina'

/** Lo que la búsqueda en la página oficial no pudo traer, y la página para abrir. */
export interface AvisoPagina {
  motivo: MotivoFallaPagina
  pagina: string | null
}

/**
 * El aviso cuando la página del hotel no dio fotos (Mauricio, 2026-10-16): la página bloquea la
 * lectura (Hilton, Marriott, Accor…), cargó sin fotos (galería con JavaScript) o no respondió. La
 * salida es la misma: abrirla, copiar la foto y pegarla aquí (pasa por la casilla de autorización).
 */
export function AvisoPaginaSinFotos({
  aviso,
  onReintentar,
  etiqueta = 'Abrir la página del hotel',
}: {
  aviso: AvisoPagina
  onReintentar?: () => void
  etiqueta?: string
}) {
  const pagina = (() => {
    if (!aviso.pagina) return null
    try {
      const u = new URL(aviso.pagina)
      return u.protocol === 'https:' ? u.toString() : null
    } catch {
      return null
    }
  })()
  return (
    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-900" role="status" data-aviso-pagina={aviso.motivo}>
      <p className="font-semibold">{TITULO_FALLA[aviso.motivo]}</p>
      <p className="inline-flex items-start gap-1">
        <ClipboardPaste className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{CONSEJO_FALLA[aviso.motivo]}</span>
      </p>
      <div className="flex flex-wrap gap-2">
        {pagina && (
          <a
            href={pagina}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-white px-3 py-1 font-medium text-amber-900 hover:bg-amber-100"
            data-abrir-pagina
          >
            <ExternalLink className="h-3.5 w-3.5" /> {etiqueta}
          </a>
        )}
        {aviso.motivo === 'red' && onReintentar && (
          <button type="button" onClick={onReintentar} className="rounded-md border border-amber-300 bg-white px-3 py-1 font-medium hover:bg-amber-100" data-reintentar>
            Intentar de nuevo
          </button>
        )}
      </div>
    </div>
  )
}
