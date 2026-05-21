'use client'

import { useState, useRef, useEffect } from 'react'
import { Plus, Compass } from 'lucide-react'
import type { Area } from '@/lib/permissions/can-edit'
import { ALL_AREAS, AREA_LABELS, AREA_DESCRIPTIONS } from '@/lib/permissions/areas'
import { AreaBadge } from './area-badge'

interface AreaMultiSelectProps {
  value: Area[]
  onChange: (next: Area[]) => void
  disabled?: boolean
  /** Texto opcional cuando no hay areas. */
  emptyHint?: string
}

/**
 * Selector multi-area sin limite cardinal.
 * - Chips eliminables (con X).
 * - Dropdown para agregar mas. Las ya seleccionadas se ocultan.
 * - `direccion` con icono Compass + descripcion clara.
 *
 * Fuente: spec UX Noor (componente AreaMultiSelect).
 */
export function AreaMultiSelect({
  value,
  onChange,
  disabled,
  emptyHint,
}: AreaMultiSelectProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  function addArea(area: Area) {
    if (value.includes(area)) return
    onChange([...value, area])
    setOpen(false)
  }

  function removeArea(area: Area) {
    onChange(value.filter((a) => a !== area))
  }

  const availableAreas = ALL_AREAS.filter((a) => !value.includes(a))

  return (
    <div ref={containerRef} className="relative">
      <div className="flex flex-wrap items-center gap-1.5">
        {value.length === 0 && emptyHint && (
          <span className="text-xs text-[#6B7280]">{emptyHint}</span>
        )}
        {value.map((area) => (
          <AreaBadge
            key={area}
            area={area}
            onRemove={disabled ? undefined : () => removeArea(area)}
          />
        ))}
        {!disabled && availableAreas.length > 0 && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="inline-flex h-7 items-center gap-1 rounded-full border border-dashed border-[#E5E7EB] px-2 text-xs text-[#6B7280] hover:border-[#10B981] hover:text-[#10B981]"
            aria-haspopup="listbox"
            aria-expanded={open}
          >
            <Plus className="h-3 w-3" />
            Agregar area
          </button>
        )}
      </div>

      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-20 mt-1 w-72 max-w-[calc(100vw-2rem)] rounded-lg border border-[#E5E7EB] bg-white p-1 shadow-lg"
        >
          {availableAreas.map((area) => {
            const isDireccion = area === 'direccion'
            return (
              <button
                key={area}
                type="button"
                role="option"
                aria-selected={false}
                onClick={() => addArea(area)}
                className="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left text-sm hover:bg-[#F5F4F2]"
              >
                {isDireccion && (
                  <Compass className="mt-0.5 h-4 w-4 shrink-0 text-[#10B981]" />
                )}
                <span className="flex-1">
                  <span className="block font-medium text-[#1A1A1A]">
                    {AREA_LABELS[area]}
                  </span>
                  <span className="block text-[11px] text-[#6B7280]">
                    {AREA_DESCRIPTIONS[area]}
                  </span>
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
