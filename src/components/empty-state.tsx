'use client'

import Image from 'next/image'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  /** Path a SVG en /public/empty-states/ (sin import). */
  illustration?: string
  /** Aria label cuando hay ilustracion. */
  illustrationAlt?: string
  title: string
  description?: string
  primaryCta?: {
    label: string
    onClick: () => void
  }
  secondaryCta?: {
    label: string
    onClick: () => void
  }
  className?: string
  /** Tamano ilustracion. Default 160. */
  illustrationSize?: number
}

/**
 * Empty state reusable con tokens MeTRIK. Voz: propone accion, nunca solo "Sin datos".
 *
 * Fuente: docs/specs/2026-05-20_ux-roles-areas-stages.md (Reglas transversales)
 * Fuente: docs/specs/2026-05-20_assets-empty-states.md (Ren — assets en /empty-states/)
 */
export default function EmptyState({
  illustration,
  illustrationAlt,
  title,
  description,
  primaryCta,
  secondaryCta,
  className,
  illustrationSize = 160,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center rounded-xl border border-[#E5E7EB] bg-white px-6 py-10 text-center',
        className,
      )}
    >
      {illustration && (
        <Image
          src={illustration}
          alt={illustrationAlt ?? ''}
          width={illustrationSize}
          height={illustrationSize}
          // Asset interno: no requiere optimization
          unoptimized
          aria-hidden={!illustrationAlt}
          className="mb-4"
        />
      )}
      <h3 className="text-base font-semibold text-[#1A1A1A]">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-[#6B7280]">{description}</p>
      )}
      {(primaryCta || secondaryCta) && (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row">
          {primaryCta && (
            <button
              type="button"
              onClick={primaryCta.onClick}
              className="inline-flex items-center justify-center rounded-lg bg-[#10B981] px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-[#059669] focus:outline-none focus:ring-2 focus:ring-[#10B981]/40"
            >
              {primaryCta.label}
            </button>
          )}
          {secondaryCta && (
            <button
              type="button"
              onClick={secondaryCta.onClick}
              className="inline-flex items-center justify-center rounded-lg border border-[#E5E7EB] bg-white px-4 py-2 text-sm font-medium text-[#1A1A1A] hover:bg-[#F5F4F2] focus:outline-none focus:ring-2 focus:ring-[#10B981]/40"
            >
              {secondaryCta.label}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
