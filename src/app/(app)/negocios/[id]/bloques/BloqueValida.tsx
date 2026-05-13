'use client'

import { useState } from 'react'
import Link from 'next/link'
import { ShieldCheck, ChevronRight, ExternalLink, LayoutGrid } from 'lucide-react'
import type { ConsultaHistorialItem } from '@/lib/actions/valida-consultas'
import { HistorialTable } from '../../../valida/valida-client'

interface Props {
  negocioId: string
  consultas: ConsultaHistorialItem[]
  error: string | null
}

/**
 * BloqueValida — bloque de visualizacion read-only.
 *
 * Renderiza el historial de consultas Valida atadas al negocio.
 * Free-standing: NO se persiste como negocio_bloques, se renderiza
 * desde el page server al final del detalle cuando el workspace
 * tiene modules.valida_consulta = true.
 *
 * Patron visual: mismo header colapsable + chip "Visualización" que
 * los demas bloques (BloqueCard wrapper en negocio-detail-client).
 * Default colapsado. Sin acciones — solo consulta + link a /valida.
 */
export default function BloqueValida({ negocioId, consultas, error }: Props) {
  const [expanded, setExpanded] = useState(false)
  const count = consultas.length

  return (
    <div className="rounded-xl border border-border bg-card transition-colors">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex w-full items-start gap-3 p-3 text-left"
      >
        <div className="shrink-0 mt-0.5">
          <LayoutGrid className="h-4 w-4 text-muted-foreground/40" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium leading-tight text-foreground">
            <ShieldCheck className="h-3.5 w-3.5 text-[#10B981]" />
            Consultas Valida
            <span className="text-xs font-normal text-[#6B7280]">({count})</span>
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wide">
              historial_valida
            </span>
            <span className="inline-flex items-center rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500 dark:bg-slate-800">
              Visualización
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ChevronRight
            className={`h-3.5 w-3.5 text-muted-foreground/40 transition-transform ${expanded ? 'rotate-90' : ''}`}
          />
        </div>
      </button>

      {expanded && (
        <div className="border-t border-border/50 px-3 py-3 space-y-3">
          <HistorialTable consultas={consultas} error={error} />
          <div className="flex justify-end">
            <Link
              href={`/valida?negocio_id=${negocioId}`}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#10B981] hover:text-[#059669] transition-colors"
            >
              Ver historial completo en Valida
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
