'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { Loader2 } from 'lucide-react'

/**
 * «Nueva cotización»: un enlace a `/cotizacion/nueva`, que CREA el borrador al renderizarse. Se apaga
 * al primer clic (QA del 2026-10-29: un doble clic dejó COT-2026-0005 y 0006 en el mismo negocio).
 * Sin precarga: precargar esa ruta sería crear. El servidor además reusa el borrador recién creado
 * (`crear-sin-duplicar.ts`).
 */
export function EnlaceNuevaCotizacion({ negocioId, className, children }: { negocioId: string; className: string; children: ReactNode }) {
  const [creando, setCreando] = useState(false)
  return (
    <Link
      href={`/negocios/${negocioId}/cotizacion/nueva`}
      prefetch={false}
      aria-disabled={creando}
      data-nueva-cotizacion
      onClick={e => {
        if (creando) { e.preventDefault(); return }
        setCreando(true)
      }}
      className={`${className}${creando ? ' pointer-events-none opacity-60' : ''}`}
    >
      {creando ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : null}
      {children}
    </Link>
  )
}
