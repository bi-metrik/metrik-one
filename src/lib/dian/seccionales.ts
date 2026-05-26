/**
 * Catalogo de Direcciones Seccionales DIAN para devolucion IVA.
 *
 * Fuente: HTML de Guia de Devolucion v3 SOENA (39 seccionales agrupadas
 * por si requieren cita previa o no).
 *
 * Bogota tiene 2 buzones (Naturales / Juridicas) y debe discriminarse por
 * tipo_persona del solicitante.
 */

export type SeccionalDIAN = {
  slug: string
  label: string
  email: string
  cita: boolean
  /** Ciudad principal asociada (para auto-mapping desde factura.ciudad_venta) */
  ciudad: string
  /** Solo para Bogota: 'natural' o 'juridica'. Sin valor = general. */
  tipo_persona?: 'natural' | 'juridica'
}

export const SECCIONALES_DIAN: SeccionalDIAN[] = [
  { slug: 'bogota-naturales', label: 'Bogotá — Personas naturales',
    email: 'dsi_bogota_recaudo_naturales@dian.gov.co', cita: true, ciudad: 'bogota', tipo_persona: 'natural' },
  { slug: 'bogota-juridicas', label: 'Bogotá — Personas jurídicas',
    email: 'dsi_bogota_recaudo_juridicas@dian.gov.co', cita: true, ciudad: 'bogota', tipo_persona: 'juridica' },
  { slug: 'medellin', label: 'Medellín',
    email: 'dsi_medellin_devoluciones@dian.gov.co', cita: true, ciudad: 'medellin' },
  { slug: 'cali', label: 'Cali',
    email: 'dsi_cali_devoluciones@dian.gov.co', cita: true, ciudad: 'cali' },
  { slug: 'bucaramanga', label: 'Bucaramanga',
    email: 'dsia_bucaramanga_devoluciones@dian.gov.co', cita: true, ciudad: 'bucaramanga' },
  { slug: 'barranquilla', label: 'Barranquilla',
    email: 'dsi_barranquilla_devoluciones@dian.gov.co', cita: true, ciudad: 'barranquilla' },
  { slug: 'grandes', label: 'Grandes Contribuyentes',
    email: 'dsi_grandesc_devoluciones@dian.gov.co', cita: true, ciudad: '' },
  { slug: 'armenia', label: 'Armenia',
    email: 'dsia_armenia_devoluciones@dian.gov.co', cita: false, ciudad: 'armenia' },
  { slug: 'arauca', label: 'Arauca',
    email: 'dsia_arauca_devoluciones@dian.gov.co', cita: false, ciudad: 'arauca' },
  { slug: 'barrancabermeja', label: 'Barrancabermeja',
    email: 'dsia_barrancabermeja_devoluciones@dian.gov.co', cita: false, ciudad: 'barrancabermeja' },
  { slug: 'buenaventura', label: 'Buenaventura',
    email: 'dsia_buenaventura_devoluciones@dian.gov.co', cita: false, ciudad: 'buenaventura' },
  { slug: 'cartagena', label: 'Cartagena',
    email: 'dsi_cartagena_devoluciones@dian.gov.co', cita: false, ciudad: 'cartagena' },
  { slug: 'cucuta', label: 'Cúcuta',
    email: 'dsi_cucuta_devoluciones@dian.gov.co', cita: false, ciudad: 'cucuta' },
  { slug: 'florencia', label: 'Florencia',
    email: 'dsia_florencia_devoluciones@dian.gov.co', cita: false, ciudad: 'florencia' },
  { slug: 'girardot', label: 'Girardot',
    email: 'dsia_girardot_devoluciones@dian.gov.co', cita: false, ciudad: 'girardot' },
  { slug: 'ibague', label: 'Ibagué',
    email: 'dsia_ibague_devoluciones@dian.gov.co', cita: false, ciudad: 'ibague' },
  { slug: 'leticia', label: 'Leticia',
    email: 'dsia_leticia_devoluciones@dian.gov.co', cita: false, ciudad: 'leticia' },
  { slug: 'manizales', label: 'Manizales',
    email: 'dsia_manizales_devoluciones@dian.gov.co', cita: false, ciudad: 'manizales' },
  { slug: 'monteria', label: 'Montería',
    email: 'dsia_monteria_devoluciones@dian.gov.co', cita: false, ciudad: 'monteria' },
  { slug: 'neiva', label: 'Neiva',
    email: 'dsia_neiva_devoluciones@dian.gov.co', cita: false, ciudad: 'neiva' },
  { slug: 'palmira', label: 'Palmira',
    email: 'dsia_palmira_devoluciones@dian.gov.co', cita: false, ciudad: 'palmira' },
  { slug: 'pasto', label: 'Pasto',
    email: 'dsia_pasto_devoluciones@dian.gov.co', cita: false, ciudad: 'pasto' },
  { slug: 'pereira', label: 'Pereira',
    email: 'dsia_pereira_devoluciones@dian.gov.co', cita: false, ciudad: 'pereira' },
  { slug: 'popayan', label: 'Popayán',
    email: 'dsia_popayan_devoluciones@dian.gov.co', cita: false, ciudad: 'popayan' },
  { slug: 'quibdo', label: 'Quibdó',
    email: 'dsia_quibdo_devoluciones@dian.gov.co', cita: false, ciudad: 'quibdo' },
  { slug: 'riohacha', label: 'Riohacha',
    email: 'dsia_riohacha_devoluciones@dian.gov.co', cita: false, ciudad: 'riohacha' },
  { slug: 'sanandres', label: 'San Andrés',
    email: 'dsia_sanandres_devoluciones@dian.gov.co', cita: false, ciudad: 'san andres' },
  { slug: 'santamarta', label: 'Santa Marta',
    email: 'dsia_stamarta_devoluciones@dian.gov.co', cita: false, ciudad: 'santa marta' },
  { slug: 'sincelejo', label: 'Sincelejo',
    email: 'dsia_sincelejo_devoluciones@dian.gov.co', cita: false, ciudad: 'sincelejo' },
  { slug: 'sogamoso', label: 'Sogamoso',
    email: 'dsia_sogamoso_devoluciones@dian.gov.co', cita: false, ciudad: 'sogamoso' },
  { slug: 'tulua', label: 'Tuluá',
    email: 'dsia_tulua_devoluciones@dian.gov.co', cita: false, ciudad: 'tulua' },
  { slug: 'tunja', label: 'Tunja',
    email: 'dsia_tunja_devoluciones@dian.gov.co', cita: false, ciudad: 'tunja' },
  { slug: 'valledupar', label: 'Valledupar',
    email: 'dsia_valledupar_devoluciones@dian.gov.co', cita: false, ciudad: 'valledupar' },
  { slug: 'villavicencio', label: 'Villavicencio',
    email: 'dsia_villavicencio_devoluciones@dian.gov.co', cita: false, ciudad: 'villavicencio' },
  { slug: 'yopal', label: 'Yopal',
    email: 'dsia_yopal_devoluciones@dian.gov.co', cita: false, ciudad: 'yopal' },
]

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

/**
 * Mapea ciudad de factura (ej. "Bogotá", "Medellin", "BARRANQUILLA") al slug
 * de seccional DIAN correspondiente.
 *
 * Para Bogota: discrimina por tipo_persona ('natural' -> bogota-naturales,
 * 'juridica' -> bogota-juridicas).
 *
 * Si no encuentra match exacto, devuelve null. El operador deberá elegir
 * manualmente de la lista.
 */
export function mapCiudadASeccional(
  ciudad: string | null | undefined,
  tipo_persona: string | null | undefined,
): SeccionalDIAN | null {
  if (!ciudad) return null
  const c = normalize(ciudad)
  if (!c) return null

  if (c.includes('bogota')) {
    const tp = normalize(tipo_persona ?? '')
    if (tp.includes('juridic')) return SECCIONALES_DIAN.find(s => s.slug === 'bogota-juridicas') ?? null
    return SECCIONALES_DIAN.find(s => s.slug === 'bogota-naturales') ?? null
  }

  const match = SECCIONALES_DIAN.find(s => s.ciudad && normalize(s.ciudad) === c)
  if (match) return match

  // Match parcial: la ciudad contiene el slug de la seccional o viceversa
  const partial = SECCIONALES_DIAN.find(s => {
    if (!s.ciudad) return false
    const cs = normalize(s.ciudad)
    return c.includes(cs) || cs.includes(c)
  })
  return partial ?? null
}

export function getSeccionalBySlug(slug: string): SeccionalDIAN | null {
  return SECCIONALES_DIAN.find(s => s.slug === slug) ?? null
}
