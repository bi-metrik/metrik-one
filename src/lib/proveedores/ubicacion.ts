/**
 * «Cartagena, CO», «Cundinamarca,CO», «Panama, PY»: la ubicación como la escribía la agencia en
 * Airtable. PURO.
 *
 * El código de país NO siempre es ISO: en la base de Trappvel «PY» es Panamá (no Paraguay) y «RD»
 * es República Dominicana. Esos se traducen; un código que no se conoce se deja (si son dos letras)
 * y se marca para revisar.
 */

/** Códigos que la agencia usa distinto de ISO 3166-1. */
const CODIGO_AGENCIA: Record<string, string> = { PY: 'PA', RD: 'DO', USA: 'US', EEUU: 'US', UK: 'GB', ESP: 'ES', COL: 'CO', PAN: 'PA', MEX: 'MX' }

/** Nombres de país → ISO, para «Cartagena, Colombia». */
const NOMBRE_PAIS: Record<string, string> = {
  colombia: 'CO', panama: 'PA', mexico: 'MX', 'republica dominicana': 'DO', espana: 'ES', 'estados unidos': 'US',
  peru: 'PE', ecuador: 'EC', 'costa rica': 'CR', aruba: 'AW', curazao: 'CW', cuba: 'CU', italia: 'IT', francia: 'FR', portugal: 'PT',
}

/** Los que la agencia usa y se reconocen sin dudar. */
const ISO_CONOCIDOS = new Set(['CO', 'PA', 'MX', 'DO', 'US', 'ES', 'PE', 'EC', 'CR', 'AW', 'CW', 'CU', 'IT', 'FR', 'PT', 'GB', 'AR', 'CL', 'BR'])

export interface Ubicacion {
  ciudad: string | null
  /** ISO alfa-2 en mayúscula, o `null`. */
  pais: string | null
  /** Algo no se entendió (país desconocido, más de dos partes). */
  dudosa: string | null
}

function sinTildes(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
}

export function parsearUbicacion(raw: string | null | undefined): Ubicacion {
  const t = (raw ?? '').trim()
  if (!t) return { ciudad: null, pais: null, dudosa: null }
  const partes = t.split(',').map((p) => p.trim()).filter(Boolean)
  if (partes.length === 1) {
    const solo = partes[0]
    const comoPais = NOMBRE_PAIS[sinTildes(solo)]
    return comoPais ? { ciudad: null, pais: comoPais, dudosa: null } : { ciudad: solo, pais: null, dudosa: null }
  }
  const ultima = partes[partes.length - 1]
  const ciudad = partes.slice(0, -1).join(', ')
  const codigo = ultima.toUpperCase().replace(/\./g, '')
  const pais = CODIGO_AGENCIA[codigo] ?? NOMBRE_PAIS[sinTildes(ultima)] ?? (/^[A-Z]{2}$/.test(codigo) ? codigo : null)
  let dudosa: string | null = null
  if (!pais) dudosa = `País «${ultima}» sin reconocer`
  else if (!ISO_CONOCIDOS.has(pais)) dudosa = `País «${ultima}» tomado como ${pais}: revisar`
  else if (partes.length > 2) dudosa = `Ubicación con ${partes.length} partes: «${t}»`
  return { ciudad: ciudad || null, pais, dudosa }
}
