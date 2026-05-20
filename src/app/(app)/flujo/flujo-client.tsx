'use client'

import { useRouter } from 'next/navigation'
import { GitFork } from 'lucide-react'
import type { FlujoData } from './actions'
import { updateEtapaSla } from './actions'
import { WorkflowDiagram } from '@/components/workflow/workflow-diagram'
import { WorkflowConventions } from '@/components/workflow/workflow-conventions'
import type { WorkflowEtapa } from '@/components/workflow/types'
import { SlaChangeLogSection } from './sla-change-log-section'

export default function FlujoClient({ data }: { data: FlujoData }) {
  const router = useRouter()
  const { lineas, selectedLineaId, etapas, canConfigSla, canViewSlaLog } = data

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

  // Barra resumen del flujo (solo cliente / simplified)
  const totalAbiertos = workflowEtapas.reduce((acc, e) => acc + (e.abiertos || 0), 0)
  const totalVencidos = workflowEtapas.reduce((acc, e) => acc + (e.vencidos || 0), 0)
  const slasValidos = workflowEtapas
    .map(e => e.sla_horas)
    .filter((v): v is number => v !== null && v > 0)
  const slaPromedio = slasValidos.length > 0
    ? Math.round(slasValidos.reduce((a, b) => a + b, 0) / slasValidos.length)
    : null
  const lineaActual = lineas.find(l => l.id === selectedLineaId)

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

      {/* Barra resumen del flujo */}
      {workflowEtapas.length > 0 && (
        <div
          className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg px-3 py-2 text-[13px]"
          style={{ backgroundColor: '#F5F4F2', color: '#1A1A1A' }}
        >
          <span className="font-semibold">
            {lineaActual?.nombre ?? 'Flujo'}
          </span>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
            <span>
              <span className="font-semibold">{totalAbiertos}</span>{' '}
              <span className="text-[#6B7280]">abierto{totalAbiertos === 1 ? '' : 's'}</span>
            </span>
            <span>
              <span
                className="font-semibold"
                style={{ color: totalVencidos > 0 ? '#B91C1C' : '#1A1A1A' }}
              >
                {totalVencidos}
              </span>{' '}
              <span className="text-[#6B7280]">vencido{totalVencidos === 1 ? '' : 's'}</span>
            </span>
            {slaPromedio !== null && (
              <span className="text-[#6B7280]">
                SLA promedio{' '}
                <span className="font-semibold text-[#1A1A1A]">{slaPromedio}h</span>
              </span>
            )}
          </div>
        </div>
      )}

      {workflowEtapas.length > 0 && <WorkflowConventions />}

      <WorkflowDiagram
        etapas={workflowEtapas}
        mode="simplified"
        canConfigSla={canConfigSla}
        onUpdateSla={updateEtapaSla}
      />

      {canViewSlaLog && selectedLineaId && (
        <SlaChangeLogSection key={selectedLineaId} lineaId={selectedLineaId} />
      )}
    </div>
  )
}
