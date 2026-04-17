// ── Constantes para cierre de negocios ────────────────────────────────────────

export const RAZONES_PERDIDA_NEGOCIO = [
  { value: 'precio', label: 'Precio muy alto' },
  { value: 'competencia', label: 'Eligieron a otro' },
  { value: 'timing', label: 'No es el momento' },
  { value: 'no_responde', label: 'No respondio' },
  { value: 'desistio', label: 'El cliente desistio' },
  { value: 'no_conversion_post_pausa', label: 'No hubo conversion tras 3 pausas' },
  { value: 'otro', label: 'Otro motivo' },
] as const

// Motivos de pausa — lista cerrada
export const MOTIVOS_PAUSA = [
  { value: 'silencio', label: 'Cliente no responde' },
  { value: 'decision_interna', label: 'Esperando decision interna del cliente' },
  { value: 'esperando_credito', label: 'Esperando aprobacion de credito' },
  { value: 'objecion_precio', label: 'Objecion de precio en evaluacion' },
  { value: 'timing', label: 'Cliente en otra prioridad / timing' },
  { value: 'otro', label: 'Otro (especificar)' },
] as const

export const MAX_PAUSAS = 3
export const MAX_DIAS_PAUSA = 14
export const SAFETY_NET_HORAS = 24 // Reactivar en <24h no consume pausa

export const MOTIVOS_CANCELACION = [
  { value: 'cliente_desiste', label: 'Decision del cliente' },
  { value: 'incumplimiento_cliente', label: 'Incumplimiento del cliente' },
  { value: 'incumplimiento_metrik', label: 'Incumplimiento de MeTRIK' },
  { value: 'problema_upme', label: 'Problema con UPME' },
  { value: 'doc_rechazado', label: 'Documento rechazado' },
] as const
