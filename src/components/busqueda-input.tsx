'use client'
import { Search, X } from 'lucide-react'

/**
 * Barra de búsqueda libre de las listas.
 *
 * Nació en `/negocios` y se extrajo aquí al pedirla también en la cola de
 * facturación de Tesorería. Se comparte en vez de copiarse por la razón de
 * siempre en este repo: dos copias divergen sin que nadie lo note, y aquí la
 * divergencia se vería como "en una pantalla encuentra y en la otra no".
 *
 * Solo dibuja el campo. Qué se busca lo decide cada lista, porque cada una tiene
 * sus propios datos.
 */
export default function BusquedaInput({
  value,
  onChange,
  placeholder,
  ariaLabel = 'Buscar',
}: {
  value: string
  onChange: (v: string) => void
  /** Qué se puede teclear aquí. Nombrar los campos reales, no "Buscar…". */
  placeholder: string
  ariaLabel?: string
}) {
  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#6B7280]" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={ariaLabel}
        className="w-full rounded-lg border border-[#E5E7EB] bg-white py-2 pl-9 pr-9 text-sm text-[#1A1A1A] placeholder:text-[#6B7280] focus:border-[#1A1A1A]/30 focus:outline-none"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          aria-label="Limpiar búsqueda"
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-[#6B7280] transition-colors hover:bg-[#F5F4F2] hover:text-[#1A1A1A]"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  )
}
