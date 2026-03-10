// ============================================================
// Normalize RUT OCR values to DB formats — [98B] D77
// ============================================================

import type { RutParseResult, RutEmpresaUpdate } from './types'

/** Map OCR tipo_persona to empresas.tipo_persona */
function normalizeTipoPersona(raw: string | null): string | undefined {
  if (!raw) return undefined
  const lower = raw.toLowerCase().trim()
  if (lower.includes('natural')) return 'natural'
  if (lower.includes('juridica') || lower.includes('jurídica')) return 'juridica'
  return undefined
}

/** Map OCR regimen to empresas.regimen_tributario */
function normalizeRegimen(raw: string | null): string | undefined {
  if (!raw) return undefined
  const lower = raw.toLowerCase().trim()
  if (lower.includes('simple')) return 'simple'
  if (lower.includes('no responsable') || lower.includes('no_responsable')) return 'no_responsable'
  if (lower.includes('responsable') || lower.includes('comun') || lower.includes('común') || lower.includes('ordinario')) return 'comun'
  return undefined
}

/** Map OCR tipo_documento to empresas.tipo_documento */
function normalizeTipoDocumento(raw: string | null): string | undefined {
  if (!raw) return undefined
  const upper = raw.toUpperCase().trim()
  if (upper.includes('NIT')) return 'NIT'
  if (upper.includes('CC') || upper.includes('CEDULA') || upper.includes('CÉDULA')) return 'CC'
  if (upper.includes('CE') || upper.includes('EXTRANJERIA') || upper.includes('EXTRANJERÍA')) return 'CE'
  if (upper.includes('PAS') || upper.includes('PASAPORTE')) return 'PASAPORTE'
  return upper
}

/**
 * Convert full RutParseResult to RutEmpresaUpdate for empresas table.
 * Only includes fields where OCR extracted a non-null value.
 */
export function normalizeRutToEmpresa(
  parsed: RutParseResult,
  rutUrl?: string,
): RutEmpresaUpdate {
  const update: RutEmpresaUpdate = {}

  if (parsed.nit.value) update.numero_documento = parsed.nit.value.replace(/\D/g, '')
  if (parsed.tipo_documento.value) update.tipo_documento = normalizeTipoDocumento(parsed.tipo_documento.value)
  if (parsed.tipo_persona.value) update.tipo_persona = normalizeTipoPersona(parsed.tipo_persona.value)
  if (parsed.regimen_tributario.value) update.regimen_tributario = normalizeRegimen(parsed.regimen_tributario.value)
  if (parsed.gran_contribuyente.value !== null) update.gran_contribuyente = parsed.gran_contribuyente.value
  if (parsed.agente_retenedor.value !== null) update.agente_retenedor = parsed.agente_retenedor.value
  if (parsed.autorretenedor.value !== null) update.autorretenedor = parsed.autorretenedor.value
  if (parsed.responsable_iva.value !== null) update.responsable_iva = parsed.responsable_iva.value
  if (parsed.razon_social.value) update.razon_social = parsed.razon_social.value.trim()
  if (parsed.direccion_fiscal.value) update.direccion_fiscal = parsed.direccion_fiscal.value.trim()
  if (parsed.municipio.value) update.municipio = parsed.municipio.value.trim()
  if (parsed.departamento.value) update.departamento = parsed.departamento.value.trim()
  if (parsed.telefono.value) update.telefono = parsed.telefono.value.trim()
  if (parsed.email_fiscal.value) update.email_fiscal = parsed.email_fiscal.value.trim().toLowerCase()
  if (parsed.actividad_ciiu.value) update.actividad_ciiu = parsed.actividad_ciiu.value.trim()
  if (parsed.actividad_secundaria.value) update.actividad_secundaria = parsed.actividad_secundaria.value.trim()
  if (parsed.fecha_inicio_actividades.value) update.fecha_inicio_actividades = parsed.fecha_inicio_actividades.value

  if (rutUrl) update.rut_documento_url = rutUrl
  update.rut_confianza_ocr = parsed.overall_confidence

  return update
}

/** Map OCR tipo_persona to fiscal_profiles format */
export function normalizeTipoPersonaFiscal(raw: string | null): string | undefined {
  if (!raw) return undefined
  const lower = raw.toLowerCase().trim()
  if (lower.includes('natural')) return 'persona_natural'
  if (lower.includes('juridica') || lower.includes('jurídica')) return 'persona_juridica'
  return undefined
}

/** Map OCR regimen to fiscal_profiles format */
export function normalizeRegimenFiscal(raw: string | null): string | undefined {
  if (!raw) return undefined
  const lower = raw.toLowerCase().trim()
  if (lower.includes('simple')) return 'simple'
  if (lower.includes('ordinario') || lower.includes('comun') || lower.includes('común') || lower.includes('responsable')) return 'ordinario'
  return undefined
}
