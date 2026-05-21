'use client'

import { Compass, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Area } from '@/lib/permissions/can-edit'
import { AREA_CLASSES, AREA_LABELS } from '@/lib/permissions/areas'

interface AreaBadgeProps {
  area: Area
  /** Si true, muestra boton X para eliminar. */
  onRemove?: () => void
  /** Tamano del chip. */
  size?: 'sm' | 'md'
  className?: string
}

/**
 * Render visual de un area con tokens MeTRIK puros.
 * `direccion` lleva borde dashed + tooltip explicito (transversal, no es un area mas).
 */
export function AreaBadge({ area, onRemove, size = 'md', className }: AreaBadgeProps) {
  const classes = AREA_CLASSES[area]
  const isDireccion = area === 'direccion'

  const sizeClasses =
    size === 'sm'
      ? 'text-[10px] px-1.5 py-0.5 gap-1'
      : 'text-xs px-2 py-0.5 gap-1.5'

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        classes.bg,
        classes.text,
        classes.border,
        sizeClasses,
        className,
      )}
      title={isDireccion ? 'Acceso a las 3 areas operativas' : undefined}
    >
      {isDireccion && <Compass className="h-3 w-3 shrink-0" aria-hidden />}
      <span>{AREA_LABELS[area]}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            e.stopPropagation()
            onRemove()
          }}
          // Hit area 32x32 invisible alrededor del X visible 12x12 (gotcha Noor)
          className="relative -mr-1 ml-0.5 flex h-5 w-5 items-center justify-center rounded-full hover:bg-black/10"
          aria-label={`Quitar area ${AREA_LABELS[area]}`}
        >
          <X className="h-2.5 w-2.5" />
        </button>
      )}
    </span>
  )
}
