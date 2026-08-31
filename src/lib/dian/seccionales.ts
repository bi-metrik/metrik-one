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
  // Barranquilla y Grandes Contribuyentes pasaron a `cita: false` el 2026-07-26.
  // La v3 de la Guia de Devolucion los traia con cita, pero en la reunion de cierre
  // VE (2026-07-24, posterior y con capacitacion DIAN de por medio) Deisy acoto la
  // exigencia de cita a cuatro seccionales: Bogota, Medellin, Cali y Bucaramanga.
  // Juan David lo reforzo en la misma sesion: los clientes de la costa no requieren cita.
  { slug: 'barranquilla', label: 'Barranquilla', codigo: '02',
    nombre_oficial: 'Dirección Seccional de Impuestos de Barranquilla',
    email: 'dsi_barranquilla_devoluciones@dian.gov.co', cita: false, ciudad: 'barranquilla' },
  { slug: 'grandes', label: 'Grandes Contribuyentes', codigo: '31',
    nombre_oficial: 'Dirección Operativa de Grandes Contribuyentes',
    email: 'dsi_grandesc_devoluciones@dian.gov.co', cita: false, ciudad: '' },
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
 * Prefijos con los que la DIAN nombra una seccional. El RUT escribe la casilla 12 como
 * "<prefijo> <Ciudad>" y el prefijo varía ("Impuestos de Cali", "Impuestos y Aduanas de
 * Bucaramanga", el nombre oficial completo, o la ciudad sola).
 *
 * Están normalizados y ordenados del más largo al más corto: "impuestos y aduanas de"
 * tiene que intentarse ANTES que "impuestos", o el primero nunca se alcanzaría.
 */
const PREFIJOS_DIAN = [
  'direccion seccional de impuestos y aduanas de',
  'direccion seccional de impuestos y aduanas',
  'direccion seccional de impuestos de',
  'direccion seccional de aduanas de',
  'direccion seccional de',
  'direccion operativa de',
  'seccional de impuestos y aduanas de',
  'seccional de impuestos de',
  'seccional de',
  'impuestos y aduanas de',
  'impuestos y aduanas',
  'impuestos de',
  'aduanas de',
  'seccional',
].sort((a, b) => b.length - a.length)

/**
 * Reduce un texto de seccional a su NÚCLEO: le quita el prefijo con que la DIAN la
 * nombra y el sufijo "D.C." de Bogotá, para poder comparar por IGUALDAD en vez de por
 * subcadena.
 *
 * ⚠️ Por qué no basta `includes`: la comparación por subcadena aceptaba cualquier texto
 * que CONTUVIERA el nombre de una ciudad. Medido en SOENA el 2026-08-25,
 * "Cámara de Comercio de Medellín para Antioquia" —que es una cámara de comercio, no una
 * seccional— entraba como Medellín, y de ese dato cuelgan la casilla 12 del Formato 010,
 * el buzón de la Guía de Devolución y el corte con/sin cita del tablero. Quitar el
 * prefijo y exigir igualdad conserva TODAS las formas reales del RUT y deja fuera las
 * que solo mencionan una ciudad de paso.
 */
function nucleoSeccional(texto: string): string {
  let n = normalize(texto).replace(/[.,;:]+$/g, '').trim()
  for (const pref of PREFIJOS_DIAN) {
    if (n === pref) return ''
    if (n.startsWith(pref + ' ')) { n = n.slice(pref.length).trim(); break }
  }
  // "Bogotá D.C." y sus variantes de puntuación.
  n = n.replace(/[,\s]+d\.?\s?c\.?$/i, '').trim()
  return n
}

/** Las formas por las que una seccional se deja reconocer, ya normalizadas. */
function clavesDe(s: SeccionalDIAN): string[] {
  const claves = [
    normalize(s.label),
    nucleoSeccional(s.nombre_oficial),
    normalize(labelCanonicoSeccional(s)),
    // El slug es la identidad del catálogo y hay superficies que lo guardan tal cual
    // (el bloque "Preparar correo al cliente" escribe `data.seccional = 'bogota-naturales'`).
    // Aceptarlo es una igualdad exacta, no una coincidencia difusa.
    normalize(s.slug),
  ]
  if (s.ciudad) claves.push(normalize(s.ciudad))
  return claves.filter(Boolean)
}

/**
 * Resuelve un texto de seccional a la entrada del catálogo, por IGUALDAD del núcleo.
 * Es el único punto donde se decide si un texto ES una seccional; `seccionalDesdeRut`,
 * `resolverSeccionalOficial` y `nombreOficialSeccional` cuelgan de aquí para que no
 * puedan dar veredictos distintos sobre el mismo texto.
 */
function buscarSeccionalExacta(input: string | null | undefined): SeccionalDIAN | null {
  if (!input) return null
  const nucleo = nucleoSeccional(input)
  if (!nucleo) return null
  return SECCIONALES_DIAN.find(s => clavesDe(s).includes(nucleo)) ?? null
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
 * NOMBRE CANÓNICO de una seccional: el único texto con el que se la nombra al
 * guardarla en datos (`negocios.metadata.seccional`) y al agruparla en tableros.
 *
 * Bogotá colapsa sus dos buzones en "Bogotá". El buzón (naturales / jurídicas) NO
 * se pierde: se vuelve a derivar de `tipo_persona` cada vez que se necesita, que es
 * lo correcto — el buzón depende de quién es el solicitante, no de cómo se tecleó la
 * ciudad. Guardarlo dentro del nombre creaba una tercera variante ("Bogotá — Personas
 * naturales") que ninguna otra capa reconocía.
 */
export function labelCanonicoSeccional(s: SeccionalDIAN): string {
  return s.tipo_persona ? 'Bogotá' : s.label
}

/**
 * Lleva CUALQUIER forma de escribir una seccional a su nombre canónico: la ciudad
 * suelta ("Bogota"), el nombre oficial del RUT ("Impuestos y Aduanas de Tuluá"), el
 * label con buzón ("Bogotá — Personas naturales") o el propio canónico.
 *
 * Devuelve null si no se reconoce. Quien llama decide: nunca se inventa una seccional
 * ni se degrada a un genérico, porque de este texto cuelgan la casilla 12 del 010, el
 * buzón de la Guía y el corte con/sin cita del tablero.
 */
export function canonizarSeccional(input: string | null | undefined): string | null {
  const s = seccionalDesdeRut(input)
  return s ? labelCanonicoSeccional(s) : null
}

/**
 * Traduce una seccional a la clave del preset del Formato 010
 * (`bloque_configs.config_extra.seccionales`), que es un vocabulario MÁS CORTO que el
 * catálogo: solo las seccionales con particularidades propias tienen entrada, y el
 * resto comparte "Otras seccionales".
 *
 * Existe porque son dos vocabularios distintos sobre la misma realidad y confundirlos
 * fue el defecto de origen: el 010 buscaba su preset con `seccionales[valor]`, match
 * EXACTO, así que "Bogota" sin tilde no encontraba el preset de "Bogotá" y el caso se
 * quedaba sin la casilla 12 resuelta, en silencio.
 */
export function presetKeySeccional(
  input: string | null | undefined,
  keys: string[],
): string | null {
  if (keys.length === 0) return null
  return presetKeySeccionalExacta(input, keys) ?? keys.find(k => normalize(k) === 'otras seccionales') ?? null
}

/**
 * Igual que `presetKeySeccional` pero SIN caer a "Otras seccionales": devuelve null
 * cuando la seccional no tiene preset propio.
 *
 * La distinción importa y costó documentos mal emitidos: "Otras seccionales" es el
 * cajón de las particularidades compartidas, NO una seccional. Quien necesite el
 * nombre de la seccional del solicitante (la casilla 12 del 010) tiene que saber si
 * el preset que le respondieron es el suyo o el genérico — si no, imprime el texto
 * "Otras seccionales" donde va "Dirección Seccional de Impuestos de Manizales".
 */
export function presetKeySeccionalExacta(
  input: string | null | undefined,
  keys: string[],
): string | null {
  if (keys.length === 0) return null
  const canonico = canonizarSeccional(input)
  // Se busca por el canónico y también por el texto crudo: una clave del preset puede
  // no existir en el catálogo (configuración libre del workspace) y aun así ser válida.
  for (const candidato of [canonico, input]) {
    if (!candidato) continue
    const n = normalize(candidato)
    const hit = keys.find(k => normalize(k) === n)
    if (hit) return hit
  }
  return null
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
  const s = seccionalDesdeRut(input, tipo_persona)
  return s ? { nombre_oficial: s.nombre_oficial, codigo: s.codigo } : null
}

/**
 * Normaliza un texto (ej. la "Dirección seccional" extraída del RUT, que puede
 * venir como "Tuluá", "Impuestos y Aduanas de Tuluá" o el nombre completo) al
 * NOMBRE OFICIAL canónico que exige la DIAN en la casilla 12 del Formato 010.
 * Si no logra mapearlo, devuelve el texto original (no rompe el render).
 */
export function nombreOficialSeccional(input: string | null | undefined): string | null {
  if (!input) return null
  if (!normalize(input)) return null
  // Sin match se devuelve el texto original, no un genérico: el operador lo corrige en
  // la casilla, y suponer una seccional sería inventar un dato que viaja a la DIAN.
  return buscarSeccionalExacta(input)?.nombre_oficial ?? input
}

/**
 * Resuelve el texto de la "Dirección seccional" del RUT (casilla 12) a la entrada
 * COMPLETA del catálogo. El RUT la trae con prefijo variable — "Impuestos de Cali",
 * "Impuestos y Aduanas de Bucaramanga", a veces solo la ciudad — por eso el match
 * nunca es literal.
 *
 * Devuelve null si no logra mapearla; quien llama decide qué hacer con esa duda.
 */
export function seccionalDesdeRut(
  input: string | null | undefined,
  tipo_persona?: string | null,
): SeccionalDIAN | null {
  const s = buscarSeccionalExacta(input)
  if (!s) return null
  // Bogotá: dos buzones con el mismo código; tipo_persona elige cuál.
  if (s.ciudad === 'bogota') {
    const tp = normalize(tipo_persona ?? '')
    const slug = tp.includes('juridic') ? 'bogota-juridicas' : 'bogota-naturales'
    return SECCIONALES_DIAN.find(x => x.slug === slug) ?? s
  }
  return s
}

export type ResolucionCitaDian = {
  /** Entrada del catálogo, o null si el texto del RUT no se pudo mapear. */
  seccional: SeccionalDIAN | null
  /**
   * `true`/`false` cuando el catálogo lo determina.
   * `null` cuando NO se pudo resolver la seccional: el sistema no adivina y el
   * comercial debe confirmarlo. Asumir `false` ante la duda haría que un caso que
   * sí necesita cita se salte la etapa y llegue a la DIAN sin ella.
   */
  requiere_cita: boolean | null
}

/**
 * Determina si un caso requiere cita previa en la DIAN, a partir de la dirección
 * seccional del RUT.
 *
 * La verdad vive en el flag `cita` del catálogo, que es también el que gobierna la
 * Guía de Devolución que recibe el cliente. Derivar de ahí (y no de una lista
 * paralela) garantiza que el flujo de trabajo y el documento del cliente nunca se
 * contradigan.
 *
 * Vigente desde 2026-07-26: solo Bogotá, Medellín, Cali y Bucaramanga exigen cita.
 */
export function requiereCitaDian(
  direccionSeccionalRut: string | null | undefined,
  tipo_persona?: string | null,
): ResolucionCitaDian {
  const seccional = seccionalDesdeRut(direccionSeccionalRut, tipo_persona)
  return { seccional, requiere_cita: seccional ? seccional.cita : null }
}

/**
 * Las ciudades cuyas seccionales exigen cita previa, derivadas del catalogo.
 *
 * Existe porque esa lista estaba TRANSCRITA A MANO en el texto de ayuda del bloque
 * de Cita DIAN ("Solo Bogota, Medellin, Cali y Bucaramanga exigen cita previa").
 * Una transcripcion no se entera de que el catalogo cambio: el dia que la DIAN
 * mueva una seccional, el motor decide con el flag `cita` y la pantalla sigue
 * diciendo lo viejo — y el operador, que es quien confirma la respuesta, le cree a
 * la pantalla. Medido el 2026-08-31: hoy coinciden (5 entradas con `cita: true`
 * sobre 39 seccionales), asi que esto no corrige una mentira vigente, cierra la
 * puerta a una futura.
 *
 * Bogota aparece dos veces en el catalogo (naturales y juridicas, con correos
 * distintos) y aqui vale UNA: lo que se lista son ciudades, no entradas.
 *
 * Puro: no toca DB, red ni reloj.
 */
export function ciudadesConCitaDian(): string[] {
  const vistas = new Set<string>()
  const out: string[] = []
  for (const s of SECCIONALES_DIAN) {
    if (!s.cita) continue
    // El label trae el desglose ("Bogota — Personas naturales"); la ciudad es lo
    // que va antes del guion largo.
    const ciudad = s.label.split('—')[0].trim()
    const clave = ciudad.toLowerCase()
    if (vistas.has(clave)) continue
    vistas.add(clave)
    out.push(ciudad)
  }
  return out
}

/**
 * La misma lista, redactada para leerse dentro de una frase:
 * "Bogota, Medellin, Cali y Bucaramanga".
 */
export function textoCiudadesConCitaDian(): string {
  const c = ciudadesConCitaDian()
  if (c.length === 0) return 'ninguna seccional'
  if (c.length === 1) return c[0]
  return `${c.slice(0, -1).join(', ')} y ${c[c.length - 1]}`
}
