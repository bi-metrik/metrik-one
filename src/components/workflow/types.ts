// Tipos compartidos del diagrama de workflow.
// Usado por la vista cliente (/flujo) y la vista admin (/admin/workflows).

export type WorkflowStage = 'venta' | 'ejecucion' | 'cobro'

export interface WorkflowBloque {
  config_id: string
  tipo: string
  nombre: string
  orden: number
  es_gate: boolean
  // Flags visuales (ambos modos). En 'simplified' se usa para distinguir
  // visualmente bloques readonly heredados y condicionales. En 'detailed' se
  // muestra como badge.
  estado?: 'editable' | 'visible'
  readonly?: boolean
  source_etapa_orden?: number | null
  condition_field?: string | null
  condition_value?: string | null
  // ID corto unico dentro de la linea (ej: DC1, DA2, CB1)
  block_id?: string
  // Solo en modo 'detailed': config completa para expandir
  config_extra?: Record<string, unknown>
}

export interface WorkflowRoutingConditional {
  condition: { field: string; value: string }
  etapa_orden: number
}

export interface WorkflowRouting {
  default_etapa_orden: number
  // Opcional: un routing puede ser solo-default (avance lineal forzado, sin rombo).
  conditional?: WorkflowRoutingConditional[]
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

// Paleta canonica de stages (orden cronologico del workflow):
//   venta     → verde   (oportunidad)
//   ejecucion → naranja (work-in-progress)
//   cobro     → azul    (cierre financiero)
// Aplica en /flujo, /admin/workflows, listados de negocios y detalle de negocio.

export const STAGE_COLORS: Record<WorkflowStage, { bg: string; text: string; border: string }> = {
  venta:     { bg: '#ECFDF5', text: '#059669', border: '#A7F3D0' },
  ejecucion: { bg: '#FFF7ED', text: '#C2410C', border: '#FED7AA' },
  cobro:     { bg: '#EFF6FF', text: '#2563EB', border: '#BFDBFE' },
}

// Clases Tailwind reutilizables para badges/pills que usan tokens de stage.
// Incluyen variante dark para no perder contraste en modo oscuro.
export const STAGE_BADGE_CLASSES: Record<WorkflowStage, string> = {
  venta:     'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
  ejecucion: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  cobro:     'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
}

// ── ID corto por bloque ────────────────────────────────────────────────────
// Cada tipo tiene un codigo de 2 letras. El ID completo de un bloque dentro
// de una linea es CODIGO + numero secuencial (DA1, DA2, DC1, DC2, COB1, ...).
// Se calcula ordenando bloques por (etapa.orden, bloque.orden) y contando
// apariciones por tipo. Incluye bloques ocultos para que el ID sea estable
// aunque un bloque cambie de visible a invisible.

export const BLOQUE_TIPO_CODE: Record<string, string> = {
  aprobacion: 'AP',
  checklist: 'CK',
  checklist_soporte: 'CS',
  cobros: 'CB',
  cotizacion: 'CT',
  cronograma: 'CR',
  datos: 'DA',
  documento: 'DC',
  documentos: 'DS',
  ejecucion: 'EJ',
  equipo: 'EQ',
  formulario: 'FO',
  guia_devolucion: 'GD',
  historial: 'HI',
  historial_valida: 'HV',
  plan_recurrente: 'PR',
  propuesta_economica: 'PE',
  resumen_financiero: 'RF',
}

export function bloqueTipoCode(tipo: string): string {
  return BLOQUE_TIPO_CODE[tipo] ?? tipo.slice(0, 2).toUpperCase()
}
