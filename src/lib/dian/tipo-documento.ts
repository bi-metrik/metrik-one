/**
 * Tipos de documento de identidad DIAN — codigo numerico oficial + label legible.
 *
 * Motivacion: en el RUT, la casilla 25 declara el TIPO de documento del titular
 * (Cedula de Ciudadania, Cedula de Extranjeria, Pasaporte, NIT, etc.) y la
 * casilla 26 su NUMERO. Para persona natural con Cedula de Ciudadania el numero
 * coincide con el NIT (casilla 5), pero para Cedula de Extranjeria y otros el
 * documento (casilla 26) DIFIERE del NIT. Los formularios 010/1668 piden el
 * CODIGO numerico DIAN del tipo de documento en su casilla "Tipo de documento".
 *
 * Fuente de los codigos: instructivo DIAN del Formulario 010 / Formato 1668
 * (casilla "Tipo de documento" / RUT casilla 25), confirmado con Mauricio
 * (2026-07-24) para el caso Cedula de Extranjeria = 22.
 *
 * Uso: `codigoTipoDocumento(label)` normaliza la etiqueta extraida del RUT y
 * devuelve el codigo DIAN; `labelTipoDocumento(label)` devuelve el label
 * canonico (consistente con `TIPOS_DOCUMENTO` de catalogos). Ambos toleran
 * ruido de OCR (acentos, mayusculas, abreviaturas).
 */

/** Codigo DIAN canonico por tipo de documento. */
export const TIPO_DOCUMENTO_DIAN = {
  registro_civil: '11',
  tarjeta_identidad: '12',
  cedula_ciudadania: '13',
  nuip: '14',
  tarjeta_extranjeria: '21',
  cedula_extranjeria: '22',
  nit: '31',
  pasaporte: '41',
  documento_extranjero: '42',
  pep: '47',
  ppt: '48',
} as const

export type TipoDocumentoKey = keyof typeof TIPO_DOCUMENTO_DIAN

/** Label legible canonico por tipo (alineado con catalogos `TIPOS_DOCUMENTO`). */
export const TIPO_DOCUMENTO_LABEL: Record<TipoDocumentoKey, string> = {
  registro_civil: 'Registro Civil',
  tarjeta_identidad: 'Tarjeta de Identidad',
  cedula_ciudadania: 'Cédula de Ciudadanía',
  nuip: 'NUIP',
  tarjeta_extranjeria: 'Tarjeta de Extranjería',
  cedula_extranjeria: 'Cédula de Extranjería',
  nit: 'NIT',
  pasaporte: 'Pasaporte',
  documento_extranjero: 'Documento de identificación extranjero',
  pep: 'PEP',
  ppt: 'PPT',
}

function normalizar(raw: string | null | undefined): string {
  return (raw ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Resuelve la etiqueta de tipo de documento (o su codigo numerico crudo) a la
 * clave canonica. Devuelve null si no reconoce el tipo.
 *
 * Orden importa: "cedula de extranjeria" contiene "cedula", asi que se evalua
 * extranjeria ANTES que ciudadania para no confundirlas.
 */
export function resolverTipoDocumento(raw: string | null | undefined): TipoDocumentoKey | null {
  const n = normalizar(raw)
  if (!n) return null

  // Si viene ya como codigo numerico DIAN, mapear directo.
  const porCodigo = (Object.entries(TIPO_DOCUMENTO_DIAN) as [TipoDocumentoKey, string][])
    .find(([, cod]) => cod === n)
  if (porCodigo) return porCodigo[0]

  // Extranjeria / extranjero primero (contienen "cedula"/"tarjeta" tambien).
  if (n.includes('cedula de extranjeria') || (n.includes('cedula') && n.includes('extranjeria')) || n === 'ce') {
    return 'cedula_extranjeria'
  }
  if (n.includes('tarjeta de extranjeria') || (n.includes('tarjeta') && n.includes('extranjeria'))) {
    return 'tarjeta_extranjeria'
  }
  if (n.includes('documento') && n.includes('extranjero')) return 'documento_extranjero'
  if (n.includes('pasaporte') || n === 'pas' || n === 'pa') return 'pasaporte'
  if (n === 'ppt' || n.includes('proteccion temporal')) return 'ppt'
  if (n === 'pep' || n.includes('permiso especial')) return 'pep'
  if (n.includes('registro civil')) return 'registro_civil'
  if (n.includes('tarjeta de identidad') || n === 'ti') return 'tarjeta_identidad'
  if (n === 'nuip') return 'nuip'
  if (n.includes('nit')) return 'nit'
  // Cedula de ciudadania al final (el mas generico de "cedula").
  if (n.includes('cedula de ciudadania') || n.includes('ciudadania') || n === 'cc' || n === 'cedula') {
    return 'cedula_ciudadania'
  }
  return null
}

/** Codigo DIAN (ej. "22") del tipo de documento; null si no se reconoce. */
export function codigoTipoDocumento(raw: string | null | undefined): string | null {
  const key = resolverTipoDocumento(raw)
  return key ? TIPO_DOCUMENTO_DIAN[key] : null
}

/** Label canonico (ej. "Cédula de Extranjería") del tipo; null si no se reconoce. */
export function labelTipoDocumento(raw: string | null | undefined): string | null {
  const key = resolverTipoDocumento(raw)
  return key ? TIPO_DOCUMENTO_LABEL[key] : null
}

/** True si el tipo es Cedula de Ciudadania (o no se reconoce → se asume CC/NIT). */
export function esCedulaCiudadania(raw: string | null | undefined): boolean {
  const key = resolverTipoDocumento(raw)
  return key === null || key === 'cedula_ciudadania'
}
