// ── Constantes para cierre de negocios ────────────────────────────────────────

export const RAZONES_PERDIDA_NEGOCIO = [
  { value: 'precio', label: 'Precio muy alto' },
  { value: 'competencia', label: 'Eligieron a otro' },
  { value: 'timing', label: 'No es el momento' },
  { value: 'no_responde', label: 'No respondio' },
  { value: 'desistio', label: 'El cliente desistio' },
  { value: 'otro', label: 'Otro motivo' },
] as const

export const MOTIVOS_CANCELACION = [
  { value: 'cliente_desiste', label: 'Decision del cliente' },
  { value: 'incumplimiento_cliente', label: 'Incumplimiento del cliente' },
  { value: 'incumplimiento_metrik', label: 'Incumplimiento de MeTRIK' },
  { value: 'problema_upme', label: 'Problema con UPME' },
  { value: 'doc_rechazado', label: 'Documento rechazado' },
] as const
