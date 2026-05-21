'use client'

import type { AdminFlujoDetalle } from '../../actions'
import type { WorkflowEtapa, WorkflowRouting } from '@/components/workflow/types'
import { WorkflowDiagram } from '@/components/workflow/workflow-diagram'
import { WorkflowConventions } from '@/components/workflow/workflow-conventions'

export default function FlujoDetalleClient({ detalle }: { detalle: AdminFlujoDetalle }) {
  if (detalle.etapas.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[#E5E7EB] bg-[#F5F4F2] p-8 text-center">
        <p className="text-sm text-[#6B7280]">Esta línea aún no tiene etapas configuradas.</p>
      </div>
    )
  }

  // Mapear AdminEtapa → WorkflowEtapa (mode=detailed)
  const etapas: WorkflowEtapa[] = detalle.etapas.map(e => {
    const ce = (e.config_extra ?? {}) as Record<string, unknown>
    const routing = (ce.routing ?? null) as WorkflowRouting | null
    const gates = Array.isArray(ce.gates) ? (ce.gates as string[]) : []
    const slaHoras = typeof ce.sla_horas === 'number' ? ce.sla_horas : null
    return {
      id: e.id,
      nombre: e.nombre,
      stage: e.stage,
      orden: e.orden,
      sla_horas: slaHoras,
      bloques: e.bloques.map(b => {
        const ce = (b.config_extra ?? {}) as {
          readonly?: boolean
          source_etapa_orden?: number
          condition?: { field?: string; value?: string }
        }
        return {
          config_id: b.config_id,
          tipo: b.tipo,
          nombre: b.nombre,
          orden: b.orden,
          es_gate: b.es_gate,
          estado: b.estado,
          readonly: ce.readonly === true,
          source_etapa_orden:
            typeof ce.source_etapa_orden === 'number' ? ce.source_etapa_orden : null,
          condition_field: typeof ce.condition?.field === 'string' ? ce.condition.field : null,
          condition_value: typeof ce.condition?.value === 'string' ? ce.condition.value : null,
          config_extra: b.config_extra ?? {},
        }
      }),
      abiertos: e.abiertos,
      vencidos: e.vencidos,
      is_active: e.is_active,
      routing,
      gates,
    }
  })

  return (
    <>
      <WorkflowConventions />
      <WorkflowDiagram etapas={etapas} mode="detailed" />
    </>
  )
}
