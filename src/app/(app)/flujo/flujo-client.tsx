'use client'

import { useRouter } from 'next/navigation'
import { GitFork } from 'lucide-react'
import type { FlujoData } from './actions'
import { updateEtapaSla } from './actions'
import { WorkflowDiagram } from '@/components/workflow/workflow-diagram'
import type { WorkflowEtapa } from '@/components/workflow/types'

export default function FlujoClient({ data }: { data: FlujoData }) {
  const router = useRouter()
  const { lineas, selectedLineaId, etapas, canConfigSla } = data

  const handleLineaChange = (id: string) => {
    const params = new URLSearchParams()
    params.set('linea', id)
    router.push(`/flujo?${params.toString()}`)
  }

  if (lineas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-[#F5F4F2] p-8 text-center">
        <GitFork className="mx-auto h-8 w-8 text-[#6B7280]" />
        <p className="mt-3 text-sm font-semibold text-[#1A1A1A]">Aún no hay flujo configurado</p>
        <p className="mt-1 text-xs text-[#6B7280]">
          Tu workspace todavía no tiene líneas de negocio activas. Contacta a tu administrador MéTRIK.
        </p>
      </div>
    )
  }

  // El server action ya pobla routing/gates en cada etapa (forma WorkflowEtapa)
  const workflowEtapas = etapas as WorkflowEtapa[]

  return (
    <div>
      <header className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-[#1A1A1A]">Workflows</h1>
            <p className="mt-1 text-sm text-[#6B7280]">
              Diagrama del proceso de tu negocio.
            </p>
          </div>
          {/* Selector de línea siempre visible — incluso con 1 sola */}
          <div className="flex items-center gap-2">
            <label htmlFor="linea-select" className="text-xs text-[#6B7280]">Línea:</label>
            <select
              id="linea-select"
              value={selectedLineaId ?? ''}
              onChange={(e) => handleLineaChange(e.target.value)}
              disabled={lineas.length === 1}
              className="rounded-md border border-[#E5E7EB] bg-white px-3 py-1.5 text-sm text-[#1A1A1A] focus:border-[#10B981] focus:outline-none focus:ring-2 focus:ring-[#10B981]/15 disabled:opacity-70"
            >
              {lineas.map(l => (
                <option key={l.id} value={l.id}>{l.nombre}</option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <WorkflowDiagram
        etapas={workflowEtapas}
        mode="simplified"
        canConfigSla={canConfigSla}
        onUpdateSla={updateEtapaSla}
      />
    </div>
  )
}
