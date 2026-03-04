// ============================================================
// RUT OCR Types — [98B] D69-D77
// ============================================================

/** A single extracted field with confidence score */
export interface RutField<T> {
  value: T | null
  confidence: number // 0-1
}

/** Confidence tier per D70 */
export type ConfidenceTier = 'auto' | 'review' | 'manual'

export function getConfidenceTier(confidence: number): ConfidenceTier {
  if (confidence >= 0.9) return 'auto'
  if (confidence >= 0.7) return 'review'
  return 'manual'
}

/** Full result from Gemini RUT OCR parse */
export interface RutParseResult {
  // Identidad (RUT form fields)
  nit: RutField<string>                    // Casilla 5 — NIT sin DV
  digito_verificacion: RutField<string>    // Casilla 6 — DV
  razon_social: RutField<string>           // Casilla 5 — nombre/razon social
  tipo_documento: RutField<string>         // Casilla 24 — CC, NIT, CE, etc.
  tipo_persona: RutField<string>           // Casilla 25 — natural/juridica
  direccion_fiscal: RutField<string>       // Casillas 38-42
  municipio: RutField<string>              // Casilla 44
  departamento: RutField<string>
  telefono: RutField<string>               // Casilla 46
  email_fiscal: RutField<string>           // Casilla 48

  // Fiscal
  regimen_tributario: RutField<string>     // responsable/no_responsable/simple
  responsable_iva: RutField<boolean>       // Casilla 53 — responsabilidades
  gran_contribuyente: RutField<boolean>    // Casilla 53
  agente_retenedor: RutField<boolean>      // Casilla 53
  autorretenedor: RutField<boolean>        // Casilla 53
  actividad_ciiu: RutField<string>         // Casilla 46 — actividad economica
  actividad_secundaria: RutField<string>
  fecha_inicio_actividades: RutField<string> // Casilla 25 — YYYY-MM-DD

  // Metadata
  overall_confidence: number               // Promedio de campos no-null
  nit_valid: boolean                       // Modulo-11 check
}

/** Fields that map directly to empresas table update */
export interface RutEmpresaUpdate {
  numero_documento?: string
  tipo_documento?: string
  tipo_persona?: string
  regimen_tributario?: string
  gran_contribuyente?: boolean
  agente_retenedor?: boolean
  autorretenedor?: boolean
  responsable_iva?: boolean
  razon_social?: string
  direccion_fiscal?: string
  municipio?: string
  departamento?: string
  telefono?: string
  email_fiscal?: string
  actividad_ciiu?: string
  actividad_secundaria?: string
  fecha_inicio_actividades?: string
  rut_documento_url?: string
  rut_fecha_carga?: string
  rut_confianza_ocr?: number
  rut_verificado?: boolean
}
