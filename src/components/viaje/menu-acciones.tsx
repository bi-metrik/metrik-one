'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * El menú «⋯» de la tarjeta (prototipo del 2026-09-24): se abre con un clic y se cierra al
 * elegir, al tocar fuera o con Escape. `contenido` recibe con qué cerrarlo, para que una
 * confirmación dentro del menú («¿Eliminas…?») pueda cerrarlo al terminar.
 */
export function MenuAcciones({
  etiqueta = 'Más acciones',
  contenido,
}: {
  etiqueta?: string
  contenido: (cerrar: () => void) => ReactNode
}) {
  const [abierto, setAbierto] = useState(false)
  const ancla = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    if (!abierto) return
    function fuera(e: MouseEvent) {
      if (ancla.current && !ancla.current.contains(e.target as Node)) setAbierto(false)
    }
    function tecla(e: KeyboardEvent) { if (e.key === 'Escape') setAbierto(false) }
    document.addEventListener('mousedown', fuera)
    window.addEventListener('keydown', tecla)
    return () => {
      document.removeEventListener('mousedown', fuera)
      window.removeEventListener('keydown', tecla)
    }
  }, [abierto])

  return (
    <span ref={ancla} className="relative shrink-0" data-menu-acciones>
      <button
        type="button"
        onClick={e => { e.stopPropagation(); setAbierto(a => !a) }}
        aria-haspopup="true"
        aria-expanded={abierto}
        aria-label={etiqueta}
        className={`rounded-md border-0 p-1.5 leading-none ${abierto ? 'bg-[#EEEBE4] text-[#191713]' : 'bg-transparent text-[#6E6A62] hover:bg-[#EEEBE4] hover:text-[#191713]'}`}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
          <circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
      {abierto && (
        <span
          role="menu"
          onClick={e => e.stopPropagation()}
          className="absolute right-0 top-[calc(100%+4px)] z-30 flex min-w-[220px] flex-col rounded-[10px] border border-[#CFCAC0] bg-white p-1 text-left shadow-[0_10px_30px_rgba(0,0,0,.18)]"
        >
          {contenido(() => setAbierto(false))}
        </span>
      )}
    </span>
  )
}

/** Un renglón del menú. */
export function ItemMenu({ children, onClick, peligro = false }: { children: ReactNode; onClick: () => void; peligro?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={`flex items-center gap-2 rounded-[7px] border-0 bg-transparent px-2.5 py-2 text-left text-sm hover:bg-[#EEEBE4] ${peligro ? 'text-[#B3382C]' : 'text-[#191713]'}`}
    >
      {children}
    </button>
  )
}

export const SeparadorMenu = () => <hr className="mx-0.5 my-1 border-0 border-t border-[#E2DED5]" />
