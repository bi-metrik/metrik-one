'use client'

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Image as ImageIcon } from 'lucide-react'

/**
 * La miniatura de un pantallazo y su vista ampliada (prototipo de la tarjeta, 2026-09-24):
 * la miniatura tiene la proporción de la captura (1920/735) y se amplía con un clic; la vista
 * ampliada se cierra tocando en cualquier parte o con Escape.
 *
 * ⚠️ La vista ampliada va por portal a `document.body`: montada dentro de un contenedor con
 * `backdrop-blur` (el encabezado fijo del negocio) un `fixed inset-0` queda atrapado en él.
 */

export function Miniatura({
  src,
  caption,
  ancho = 'w-[76px] max-sm:w-16',
  onAmpliar,
}: {
  /** URL de la imagen (data URL de la bandeja o el enlace firmado del archivo guardado). */
  src: string | null
  caption: string
  ancho?: string
  onAmpliar?: (src: string, caption: string) => void
}) {
  const base = `${ancho} aspect-[1920/735] shrink-0 rounded-[5px] border border-[#E2DED5] bg-[#EEEBE4] p-0`
  if (!src) {
    return (
      <span className={`${base} grid place-items-center text-[#6E6A62]`} aria-hidden>
        <ImageIcon className="h-5 w-5" strokeWidth={1.7} />
      </span>
    )
  }
  return (
    <button
      type="button"
      onClick={() => onAmpliar?.(src, caption)}
      aria-label="Ampliar pantallazo"
      className={`${base} block cursor-zoom-in overflow-hidden`}
      data-miniatura
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL o enlace firmado del pantallazo */}
      <img src={src} alt={caption} loading="lazy" className="block h-full w-full rounded-[4px] object-cover" />
    </button>
  )
}

export function VistaAmpliada({ src, caption, onCerrar }: { src: string; caption: string; onCerrar: () => void }) {
  useEffect(() => {
    function alTeclear(e: KeyboardEvent) { if (e.key === 'Escape') onCerrar() }
    window.addEventListener('keydown', alTeclear)
    return () => window.removeEventListener('keydown', alTeclear)
  }, [onCerrar])
  // Solo se monta tras un clic, en el navegador; en el servidor no hay a dónde llevarla.
  if (typeof document === 'undefined') return null
  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Pantallazo ampliado"
      onClick={onCerrar}
      className="fixed inset-0 z-[60] flex cursor-zoom-out flex-col items-center justify-center gap-2.5 bg-[rgba(18,17,15,.72)] p-4"
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL o enlace firmado del pantallazo */}
      <img src={src} alt={caption} className="max-h-[80vh] max-w-[min(1200px,100%)] rounded-md bg-white shadow-[0_12px_40px_rgba(0,0,0,.4)]" />
      <p className="m-0 text-[13px] text-white">{caption} · toca para cerrar</p>
    </div>,
    document.body,
  )
}

/** El estado de «qué pantallazo está ampliado», para montar una sola vista por pantalla. */
export function useVistaAmpliada() {
  const [abierta, setAbierta] = useState<{ src: string; caption: string } | null>(null)
  const vista = abierta ? <VistaAmpliada src={abierta.src} caption={abierta.caption} onCerrar={() => setAbierta(null)} /> : null
  return { ampliar: (src: string, caption: string) => setAbierta({ src, caption }), vista }
}
