'use client'

import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { Info } from 'lucide-react'

/**
 * InfoTooltip — ícono "i" reutilizable con tooltip de ayuda.
 *
 * Patrón de ayuda contextual para puntos donde el equipo se confunde.
 * Opt-in: solo se renderiza donde se coloca explícitamente. Tokens MeTRIK.
 *
 * Uso:
 *   <InfoTooltip text="Texto breve de ayuda" />
 *   <InfoTooltip text="..."><CustomTrigger /></InfoTooltip>
 *
 * Mantener los textos breves (1-2 frases). No usar para copy largo.
 */
export function InfoTooltip({
  text,
  children,
  side = 'top',
  className = '',
}: {
  text: string
  children?: React.ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
}) {
  return (
    <TooltipPrimitive.Provider delayDuration={150}>
      <TooltipPrimitive.Root>
        <TooltipPrimitive.Trigger asChild>
          {children ?? (
            <button
              type="button"
              aria-label="Ayuda"
              className={`inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[#6B7280] transition-colors hover:text-[#1A1A1A] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/30 ${className}`}
              // Evitar que el click propague a contenedores clickeables (cards/labels)
              onClick={(e) => e.preventDefault()}
            >
              <Info className="h-3.5 w-3.5" />
            </button>
          )}
        </TooltipPrimitive.Trigger>
        <TooltipPrimitive.Portal>
          <TooltipPrimitive.Content
            side={side}
            sideOffset={5}
            className="z-50 max-w-[260px] rounded-md border border-[#E5E7EB] bg-[#1A1A1A] px-2.5 py-1.5 text-[11px] leading-snug text-white shadow-md data-[state=delayed-open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=delayed-open]:fade-in-0"
          >
            {text}
            <TooltipPrimitive.Arrow className="fill-[#1A1A1A]" />
          </TooltipPrimitive.Content>
        </TooltipPrimitive.Portal>
      </TooltipPrimitive.Root>
    </TooltipPrimitive.Provider>
  )
}
