'use client'

import { useState } from 'react'
import Image from 'next/image'
import { RotateCcw } from 'lucide-react'
import ReabrirNegocioModal from './reabrir-negocio-modal'

interface Props {
  negocioId: string
  cierreMotivo: 'exitoso' | 'perdido' | 'cancelado'
  closedAt: string | null
  razonCierre: string | null
  /** Rol actual del user para gatear boton reabrir. */
  role: string | null
  /** Areas efectivas del staff (si supervisor) para gatear perdido. */
  hasAreaComercial: boolean
}

const MOTIVO_LABEL: Record<'exitoso' | 'perdido' | 'cancelado', string> = {
  exitoso: 'Exitoso',
  perdido: 'Perdido',
  cancelado: 'Cancelado',
}

function formatDateLong(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('es-CO', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })
}

/**
 * Header banner que se muestra cuando el negocio esta cerrado.
 * - SVG sello segun motivo (Ren — /empty-states/header-cerrado-*.svg)
 * - Boton "Reabrir negocio" condicional segun rol + motivo
 */
export default function CerradoHeaderBanner({
  negocioId,
  cierreMotivo,
  closedAt,
  razonCierre,
  role,
  hasAreaComercial,
}: Props) {
  const [showReabrir, setShowReabrir] = useState(false)

  // Logica de gateo
  const isOwnerAdmin = role === 'owner' || role === 'admin'
  let canReabrir = false
  if (cierreMotivo === 'exitoso') {
    canReabrir = false // exitoso no se reabre
  } else if (cierreMotivo === 'cancelado') {
    canReabrir = isOwnerAdmin
  } else if (cierreMotivo === 'perdido') {
    canReabrir = isOwnerAdmin || (role === 'supervisor' && hasAreaComercial)
  }

  return (
    <>
      <div className="mb-4 flex items-center gap-3 rounded-xl border border-[#E5E7EB] bg-[#F5F4F2] p-4">
        <Image
          src={`/empty-states/header-cerrado-${cierreMotivo}.svg`}
          alt={`Negocio cerrado como ${MOTIVO_LABEL[cierreMotivo].toLowerCase()}`}
          width={64}
          height={64}
          unoptimized
          className="shrink-0"
        />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[#1A1A1A]">
            Cerrado como {MOTIVO_LABEL[cierreMotivo]}
          </p>
          {closedAt && (
            <p className="text-xs text-[#6B7280]">
              {formatDateLong(closedAt)}
            </p>
          )}
          {razonCierre && (
            <p className="mt-1 truncate text-[11px] italic text-[#6B7280]">
              {razonCierre}
            </p>
          )}
        </div>
        {canReabrir && (
          <button
            type="button"
            onClick={() => setShowReabrir(true)}
            className="shrink-0 inline-flex items-center gap-1.5 rounded-md border border-[#10B981]/40 px-3 py-1.5 text-xs font-medium text-[#10B981] hover:bg-[#10B981]/10"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reabrir
          </button>
        )}
      </div>

      {showReabrir && cierreMotivo !== 'exitoso' && (
        <ReabrirNegocioModal
          negocioId={negocioId}
          cierreMotivo={cierreMotivo}
          closedAt={closedAt}
          onClose={() => setShowReabrir(false)}
        />
      )}
    </>
  )
}
