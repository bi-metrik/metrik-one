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
  /** Código oficial de la seccional (Resolución 000064 del 9-ago-2021). */
  codigo: string
  /** Nombre oficial completo — el que exige la DIAN en la casilla 12 del Formato 010. */
  nombre_oficial: string
  /** Solo para Bogota: 'natural' o 'juridica'. Sin valor = general. */
  tipo_persona?: 'natural' | 'juridica'
}

export const SECCIONALES_DIAN: SeccionalDIAN[] = [
  { slug: 'bogota-naturales', label: 'Bogotá — Personas naturales', codigo: '32',
    nombre_oficial: 'Dirección Seccional de Impuestos de Bogotá',
    email: 'dsi_bogota_recaudo_naturales@dian.gov.co', cita: true, ciudad: 'bogota', tipo_persona: 'natural' },
  { slug: 'bogota-juridicas', label: 'Bogotá — Personas jurídicas', codigo: '32',
    nombre_oficial: 'Dirección Seccional de Impuestos de Bogotá',
    email: 'dsi_bogota_recaudo_juridicas@dian.gov.co', cita: true, ciudad: 'bogota', tipo_persona: 'juridica' },
  { slug: 'medellin', label: 'Medellín', codigo: '11',
    nombre_oficial: 'Dirección Seccional de Impuestos de Medellín',
    email: 'dsi_medellin_devoluciones@dian.gov.co', cita: true, ciudad: 'medellin' },
  { slug: 'cali', label: 'Cali', codigo: '05',
    nombre_oficial: 'Dirección Seccional de Impuestos de Cali',
    email: 'dsi_cali_devoluciones@dian.gov.co', cita: true, ciudad: 'cali' },
  { slug: 'bucaramanga', label: 'Bucaramanga', codigo: '04',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Bucaramanga',
    email: 'dsia_bucaramanga_devoluciones@dian.gov.co', cita: true, ciudad: 'bucaramanga' },
  { slug: 'barranquilla', label: 'Barranquilla', codigo: '02',
    nombre_oficial: 'Dirección Seccional de Impuestos de Barranquilla',
    email: 'dsi_barranquilla_devoluciones@dian.gov.co', cita: true, ciudad: 'barranquilla' },
  { slug: 'grandes', label: 'Grandes Contribuyentes', codigo: '31',
    nombre_oficial: 'Dirección Operativa de Grandes Contribuyentes',
    email: 'dsi_grandesc_devoluciones@dian.gov.co', cita: true, ciudad: '' },
  { slug: 'armenia', label: 'Armenia', codigo: '01',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Armenia',
    email: 'dsia_armenia_devoluciones@dian.gov.co', cita: false, ciudad: 'armenia' },
  { slug: 'arauca', label: 'Arauca', codigo: '34',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Arauca',
    email: 'dsia_arauca_devoluciones@dian.gov.co', cita: false, ciudad: 'arauca' },
  { slug: 'barrancabermeja', label: 'Barrancabermeja', codigo: '29',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Barrancabermeja',
    email: 'dsia_barrancabermeja_devoluciones@dian.gov.co', cita: false, ciudad: 'barrancabermeja' },
  { slug: 'buenaventura', label: 'Buenaventura', codigo: '35',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Buenaventura',
    email: 'dsia_buenaventura_devoluciones@dian.gov.co', cita: false, ciudad: 'buenaventura' },
  { slug: 'cartagena', label: 'Cartagena', codigo: '06',
    nombre_oficial: 'Dirección Seccional de Impuestos de Cartagena',
    email: 'dsi_cartagena_devoluciones@dian.gov.co', cita: false, ciudad: 'cartagena' },
  { slug: 'cucuta', label: 'Cúcuta', codigo: '07',
    nombre_oficial: 'Dirección Seccional de Impuestos de Cúcuta',
    email: 'dsi_cucuta_devoluciones@dian.gov.co', cita: false, ciudad: 'cucuta' },
  { slug: 'florencia', label: 'Florencia', codigo: '28',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Florencia',
    email: 'dsia_florencia_devoluciones@dian.gov.co', cita: false, ciudad: 'florencia' },
  { slug: 'girardot', label: 'Girardot', codigo: '08',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Girardot',
    email: 'dsia_girardot_devoluciones@dian.gov.co', cita: false, ciudad: 'girardot' },
  { slug: 'ibague', label: 'Ibagué', codigo: '09',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Ibagué',
    email: 'dsia_ibague_devoluciones@dian.gov.co', cita: false, ciudad: 'ibague' },
  { slug: 'leticia', label: 'Leticia', codigo: '38',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Leticia',
    email: 'dsia_leticia_devoluciones@dian.gov.co', cita: false, ciudad: 'leticia' },
  { slug: 'manizales', label: 'Manizales', codigo: '10',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Manizales',
    email: 'dsia_manizales_devoluciones@dian.gov.co', cita: false, ciudad: 'manizales' },
  { slug: 'monteria', label: 'Montería', codigo: '12',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Montería',
    email: 'dsia_monteria_devoluciones@dian.gov.co', cita: false, ciudad: 'monteria' },
  { slug: 'neiva', label: 'Neiva', codigo: '13',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Neiva',
    email: 'dsia_neiva_devoluciones@dian.gov.co', cita: false, ciudad: 'neiva' },
  { slug: 'palmira', label: 'Palmira', codigo: '15',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Palmira',
    email: 'dsia_palmira_devoluciones@dian.gov.co', cita: false, ciudad: 'palmira' },
  { slug: 'pasto', label: 'Pasto', codigo: '14',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Pasto',
    email: 'dsia_pasto_devoluciones@dian.gov.co', cita: false, ciudad: 'pasto' },
  { slug: 'pereira', label: 'Pereira', codigo: '16',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Pereira',
    email: 'dsia_pereira_devoluciones@dian.gov.co', cita: false, ciudad: 'pereira' },
  { slug: 'popayan', label: 'Popayán', codigo: '17',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Popayán',
    email: 'dsia_popayan_devoluciones@dian.gov.co', cita: false, ciudad: 'popayan' },
  { slug: 'quibdo', label: 'Quibdó', codigo: '18',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Quibdó',
    email: 'dsia_quibdo_devoluciones@dian.gov.co', cita: false, ciudad: 'quibdo' },
  { slug: 'riohacha', label: 'Riohacha', codigo: '25',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Riohacha',
    email: 'dsia_riohacha_devoluciones@dian.gov.co', cita: false, ciudad: 'riohacha' },
  { slug: 'sanandres', label: 'San Andrés', codigo: '27',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de San Andrés',
    email: 'dsia_sanandres_devoluciones@dian.gov.co', cita: false, ciudad: 'san andres' },
  { slug: 'santamarta', label: 'Santa Marta', codigo: '19',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Santa Marta',
    email: 'dsia_stamarta_devoluciones@dian.gov.co', cita: false, ciudad: 'santa marta' },
  { slug: 'sincelejo', label: 'Sincelejo', codigo: '23',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Sincelejo',
    email: 'dsia_sincelejo_devoluciones@dian.gov.co', cita: false, ciudad: 'sincelejo' },
  { slug: 'sogamoso', label: 'Sogamoso', codigo: '26',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Sogamoso',
    email: 'dsia_sogamoso_devoluciones@dian.gov.co', cita: false, ciudad: 'sogamoso' },
  { slug: 'tulua', label: 'Tuluá', codigo: '21',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Tuluá',
    email: 'dsia_tulua_devoluciones@dian.gov.co', cita: false, ciudad: 'tulua' },
  { slug: 'tunja', label: 'Tunja', codigo: '20',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Tunja',
    email: 'dsia_tunja_devoluciones@dian.gov.co', cita: false, ciudad: 'tunja' },
  { slug: 'valledupar', label: 'Valledupar', codigo: '24',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Valledupar',
    email: 'dsia_valledupar_devoluciones@dian.gov.co', cita: false, ciudad: 'valledupar' },
  { slug: 'villavicencio', label: 'Villavicencio', codigo: '22',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Villavicencio',
    email: 'dsia_villavicencio_devoluciones@dian.gov.co', cita: false, ciudad: 'villavicencio' },
  { slug: 'yopal', label: 'Yopal', codigo: '44',
    nombre_oficial: 'Dirección Seccional de Impuestos y Aduanas de Yopal',
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

/**
 * Resuelve una entrada de seccional (nombre de ciudad, nombre oficial parcial, o
 * el key de un preset como "Cali"/"Tuluá") al par CANÓNICO { nombre_oficial, codigo }
 * que exige la DIAN en la casilla 12 del Formato 010.
 *
 * Es la fuente que hace que el operador NO teclee el código: elige la seccional en
 * el desplegable y el código oficial (Resolución 000064/2021) se autocompleta.
 *
 * Para Bogotá (2 buzones con el mismo código '32') `tipo_persona` desambigua el
 * email/buzón; el código y el nombre oficial son idénticos, así que no afecta la 12.
 *
 * Si no logra mapear (ej. "Otras seccionales"), devuelve null → el operador puede
 * teclear el código a mano en esa casilla (queda editable en la plataforma).
 */
export function resolverSeccionalOficial(
  input: string | null | undefined,
  tipo_persona?: string | null,
): { nombre_oficial: string; codigo: string } | null {
  if (!input) return null
  const n = normalize(input)
  if (!n) return null

  // Bogotá: elegir el buzón por tipo_persona (código/nombre son iguales igual).
  if (n.includes('bogota')) {
    const tp = normalize(tipo_persona ?? '')
    const slug = tp.includes('juridic') ? 'bogota-juridicas' : 'bogota-naturales'
    const s = SECCIONALES_DIAN.find(x => x.slug === slug)
    return s ? { nombre_oficial: s.nombre_oficial, codigo: s.codigo } : null
  }

  // 1) match por nombre oficial (contenido en cualquier dirección)
  const porNombre = SECCIONALES_DIAN.find(s => {
    const no = normalize(s.nombre_oficial)
    return no === n || no.includes(n) || n.includes(no)
  })
  if (porNombre) return { nombre_oficial: porNombre.nombre_oficial, codigo: porNombre.codigo }

  // 2) match por ciudad (el preset SOENA guarda la ciudad: "Cali", "Tuluá"…)
  const porCiudad = SECCIONALES_DIAN.find(
    s => s.ciudad && (normalize(s.ciudad) === n || n.includes(normalize(s.ciudad))),
  )
  if (porCiudad) return { nombre_oficial: porCiudad.nombre_oficial, codigo: porCiudad.codigo }

  // 3) match por label (ej. "Bucaramanga")
  const porLabel = SECCIONALES_DIAN.find(s => normalize(s.label) === n)
  if (porLabel) return { nombre_oficial: porLabel.nombre_oficial, codigo: porLabel.codigo }

  return null
}

/**
 * Normaliza un texto (ej. la "Dirección seccional" extraída del RUT, que puede
 * venir como "Tuluá", "Impuestos y Aduanas de Tuluá" o el nombre completo) al
 * NOMBRE OFICIAL canónico que exige la DIAN en la casilla 12 del Formato 010.
 * Si no logra mapearlo, devuelve el texto original (no rompe el render).
 */
export function nombreOficialSeccional(input: string | null | undefined): string | null {
  if (!input) return null
  const n = normalize(input)
  if (!n) return null
  // 1) match por nombre oficial contenido (o que contenga al input)
  const porNombre = SECCIONALES_DIAN.find(s => {
    const no = normalize(s.nombre_oficial)
    return no === n || no.includes(n) || n.includes(no)
  })
  if (porNombre) return porNombre.nombre_oficial
  // 2) match por ciudad (el RUT suele traer solo la ciudad de la seccional)
  const porCiudad = SECCIONALES_DIAN.find(s => s.ciudad && (normalize(s.ciudad) === n || n.includes(normalize(s.ciudad))))
  if (porCiudad) return porCiudad.nombre_oficial
  // 3) sin match: devolver el original tal cual (operador puede corregir)
  return input
}
