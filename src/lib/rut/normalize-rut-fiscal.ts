// ============================================================
// Normalize RUT OCR values → fiscal DB formats
//
// Resuelve los desajustes entre los valores que produce Gemini
// y los formatos que espera el motor fiscal (calculos-fiscales.ts).
//
// Validado por: Felipe [55A] — 2026-03-06
// ============================================================

/**
 * Normaliza tipo_persona del RUT para fiscal_profiles.
 *
 * RUT OCR produce:   "natural" | "juridica"
 * Motor fiscal espera: "persona_natural" | "persona_juridica"
 *   → adaptPerfilUsuario() L167: fp.person_type
 *   → clasificarPerfilFiscal() L59: === 'persona_juridica'
 *   → calcularRetenciones() L296: === 'persona_natural'
 */
export function normalizePersonTypeFiscalProfile(
  rutValue: string | null | undefined,
): string | null {
  if (!rutValue) return null
  const v = rutValue.trim().toLowerCase()
  if (v === 'natural' || v === 'persona_natural') return 'persona_natural'
  if (v === 'juridica' || v === 'persona_juridica') return 'persona_juridica'
  return null
}

/**
 * Normaliza tipo_persona del RUT para empresas (directorio).
 *
 * RUT OCR produce:   "natural" | "juridica"
 * Empresas espera:   "natural" | "juridica" (formato corto, pipeline constants)
 */
export function normalizePersonTypeEmpresa(
  rutValue: string | null | undefined,
): string | null {
  if (!rutValue) return null
  const v = rutValue.trim().toLowerCase()
  if (v === 'natural' || v === 'persona_natural') return 'natural'
  if (v === 'juridica' || v === 'persona_juridica') return 'juridica'
  return null
}

/**
 * Normaliza regimen_tributario del RUT para fiscal_profiles (tax_regime).
 *
 * RUT OCR produce:   "responsable" | "no_responsable" | "simple"
 * Motor fiscal espera: "ordinario" | "simple"
 *   → adaptPerfilUsuario() L168: fp.tax_regime || 'ordinario'
 *   → clasificarPerfilFiscal() L53: === 'simple'
 *   → calcularRetenciones() L274: === 'simple'
 *
 * Base normativa:
 * - Art. 437 ET: Responsables de IVA = regimen comun/ordinario + responsabilidad IVA
 * - Art. 506 ET: No responsables = regimen ordinario, pero sin IVA
 * - Art. 903 ET: Regimen Simple — no responsables de IVA ni agentes de retencion
 */
export function normalizeTaxRegimeFiscalProfile(
  rutValue: string | null | undefined,
): string | null {
  if (!rutValue) return null
  const v = rutValue.trim().toLowerCase()
  if (v === 'responsable' || v === 'comun' || v === 'ordinario') return 'ordinario'
  if (v === 'no_responsable') return 'ordinario' // No responsable es ordinario sin IVA
  if (v === 'simple') return 'simple'
  return null
}

/**
 * Normaliza regimen_tributario del RUT para empresas (directorio).
 *
 * RUT OCR produce:   "responsable" | "no_responsable" | "simple"
 * Empresas espera:   "comun" | "simple" | "no_responsable" (pipeline constants)
 */
export function normalizeTaxRegimeEmpresa(
  rutValue: string | null | undefined,
): string | null {
  if (!rutValue) return null
  const v = rutValue.trim().toLowerCase()
  if (v === 'responsable' || v === 'comun' || v === 'ordinario') return 'comun'
  if (v === 'no_responsable') return 'no_responsable'
  if (v === 'simple') return 'simple'
  return null
}

/**
 * Deriva iva_responsible a partir del regimen tributario del RUT.
 *
 * El regimen manda sobre el booleano directo del OCR.
 * Razon: Gemini puede leer mal casilla 53 pero el regimen es mas fiable.
 *
 * - "responsable" → true (regimen comun con responsabilidad IVA)
 * - "no_responsable" → false (Art. 506 ET: por debajo de 3.500 UVT)
 * - "simple" → false (Art. 903 ET: RST no son responsables de IVA)
 *
 * Si el regimen es desconocido, usa el valor directo del OCR como fallback.
 */
export function deriveIvaResponsible(
  rutRegimen: string | null | undefined,
  ocrIvaResponsible: boolean | null | undefined,
): boolean {
  if (!rutRegimen) return ocrIvaResponsible ?? false
  const v = rutRegimen.trim().toLowerCase()
  if (v === 'responsable' || v === 'comun') return true
  if (v === 'no_responsable') return false
  if (v === 'simple') return false
  return ocrIvaResponsible ?? false
}
