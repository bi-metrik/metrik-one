// Tipos compartidos del bloque guia_devolucion.
// Separado de guia-devolucion-actions.ts porque archivos 'use server' solo
// pueden exportar funciones async, no types.

export type GuiaVersion = {
  n: number
  seccional_slug: string
  seccional_label: string
  fecha_cita: string | null
  pdf_drive_id: string | null
  pdf_url: string | null
  generated_at: string
  generated_by: string | null
}

export type GuiaData = {
  versiones: GuiaVersion[]
  version_activa: number | null
  aprobado_at: string | null
  aprobado_por: string | null
  aprobado_version: number | null
}

export type GenerarGuiaInput = {
  bloqueId: string
  seccional_slug_override?: string
}
