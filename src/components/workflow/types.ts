// Tipos compartidos del diagrama de workflow.
// Usado por la vista cliente (/flujo) y la vista admin (/admin/workflows).

export type WorkflowStage = 'venta' | 'ejecucion' | 'cobro'

export interface WorkflowBloque {
  config_id: string
  tipo: string
  nombre: string
  orden: number
  es_gate: boolean
  // Propagado en ambos modos. En 'simplified' se usa para distinguir
  // visualmente bloques readonly heredados. En 'detailed' se muestra como badge.
  estado?: 'editable' | 'visible'
  // Solo en modo 'detailed': config completa
  config_extra?: Record<string, unknown>
}

export interface WorkflowRoutingConditional {
  condition: { field: string; value: string }
  etapa_orden: number
}

export interface WorkflowRouting {
  default_etapa_orden: number
  conditional: WorkflowRoutingConditional[]
  source_etapa_orden?: number
}

export interface WorkflowEtapa {
  id: string
  nombre: string
  stage: WorkflowStage
  orden: number
  sla_horas: number | null
  bloques: WorkflowBloque[]
  abiertos: number
  vencidos: number
  // Solo en modo 'detailed':
  is_active?: boolean
  routing?: WorkflowRouting | null
  gates?: string[]
}

export const STAGE_LABELS: Record<WorkflowStage, string> = {
  venta: 'Venta',
  ejecucion: 'Ejecución',
  cobro: 'Cobro',
}

export const STAGE_COLORS: Record<WorkflowStage, { bg: string; text: string; border: string }> = {
  venta:     { bg: '#ECFDF5', text: '#059669', border: '#A7F3D0' },
  ejecucion: { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' },
  cobro:     { bg: '#FFFBEB', text: '#B45309', border: '#FDE68A' },
}
