/**
 * DIVIPOLA (DANE) — códigos de país / departamento / municipio para las casillas
 * 26 / 27 / 28 del Formato 010.
 *
 * Motivación: la extracción del RUT trae los códigos de ubicación de forma poco
 * fiable (se vio `codigo_municipio="76"` copiando el código del departamento). Los
 * códigos son DETERMINISTAS dado el NOMBRE (que sí se extrae bien), así que los
 * resolvemos por nombre y solo caemos a lo extraído cuando el municipio no está
 * en la tabla. Formato de los códigos = el mismo que usa el RUT: departamento a
 * 2 dígitos ("76"), municipio a 3 dígitos dentro del departamento ("001").
 *
 * País: Colombia = "169" (código de país DIAN, tal como aparece en el RUT).
 */

export const CODIGO_PAIS_COLOMBIA = '169'

function normalize(s: string | null | undefined): string {
  return (s ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\bd\.?\s*c\.?\b/g, '') // "Bogotá D.C." -> "bogota"
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// Departamentos DANE (33). Nombre normalizado -> código 2 dígitos.
const DEPARTAMENTOS: Record<string, string> = {
  'antioquia': '05', 'atlantico': '08', 'bogota': '11', 'bolivar': '13',
  'boyaca': '15', 'caldas': '17', 'caqueta': '18', 'cauca': '19',
  'cesar': '20', 'cordoba': '23', 'cundinamarca': '25', 'choco': '27',
  'huila': '41', 'la guajira': '44', 'guajira': '44', 'magdalena': '47',
  'meta': '50', 'narino': '52', 'norte de santander': '54', 'quindio': '63',
  'risaralda': '66', 'santander': '68', 'sucre': '70', 'tolima': '73',
  'valle del cauca': '76', 'valle': '76', 'arauca': '81', 'casanare': '85',
  'putumayo': '86', 'archipielago de san andres providencia y santa catalina': '88',
  'san andres y providencia': '88', 'san andres': '88', 'amazonas': '91',
  'guainia': '94', 'guaviare': '95', 'vaupes': '97', 'vichada': '99',
}

// Municipios principales (centros urbanos y de venta de vehículos + seccionales).
// Nombre normalizado -> { dep: código depto 2 díg, mun: código municipio 3 díg }.
// El DANE completo es de ~1.100 municipios; esta tabla cubre las ciudades donde
// SOENA opera. Un municipio fuera de tabla cae al valor extraído (editable).
const MUNICIPIOS: Record<string, { dep: string; mun: string }> = {
  'bogota': { dep: '11', mun: '001' },
  'santafe de bogota': { dep: '11', mun: '001' },
  'medellin': { dep: '05', mun: '001' },
  'envigado': { dep: '05', mun: '266' },
  'itagui': { dep: '05', mun: '360' },
  'bello': { dep: '05', mun: '088' },
  'sabaneta': { dep: '05', mun: '631' },
  'rionegro': { dep: '05', mun: '615' },
  'cali': { dep: '76', mun: '001' },
  'santiago de cali': { dep: '76', mun: '001' },
  'yumbo': { dep: '76', mun: '892' },
  'palmira': { dep: '76', mun: '520' },
  'tulua': { dep: '76', mun: '834' },
  'buenaventura': { dep: '76', mun: '109' },
  'jamundi': { dep: '76', mun: '364' },
  'barranquilla': { dep: '08', mun: '001' },
  'soledad': { dep: '08', mun: '758' },
  'cartagena': { dep: '13', mun: '001' },
  'bucaramanga': { dep: '68', mun: '001' },
  'floridablanca': { dep: '68', mun: '276' },
  'giron': { dep: '68', mun: '307' },
  'cucuta': { dep: '54', mun: '001' },
  'san jose de cucuta': { dep: '54', mun: '001' },
  'pereira': { dep: '66', mun: '001' },
  'dosquebradas': { dep: '66', mun: '170' },
  'manizales': { dep: '17', mun: '001' },
  'armenia': { dep: '63', mun: '001' },
  'ibague': { dep: '73', mun: '001' },
  'neiva': { dep: '41', mun: '001' },
  'villavicencio': { dep: '50', mun: '001' },
  'pasto': { dep: '52', mun: '001' },
  'popayan': { dep: '19', mun: '001' },
  'santa marta': { dep: '47', mun: '001' },
  'monteria': { dep: '23', mun: '001' },
  'sincelejo': { dep: '70', mun: '001' },
  'valledupar': { dep: '20', mun: '001' },
  'riohacha': { dep: '44', mun: '001' },
  'quibdo': { dep: '27', mun: '001' },
  'florencia': { dep: '18', mun: '001' },
  'tunja': { dep: '15', mun: '001' },
  'sogamoso': { dep: '15', mun: '759' },
  'yopal': { dep: '85', mun: '001' },
  'arauca': { dep: '81', mun: '001' },
  'leticia': { dep: '91', mun: '001' },
  'girardot': { dep: '25', mun: '307' },
  'soacha': { dep: '25', mun: '754' },
  'chia': { dep: '25', mun: '175' },
  'zipaquira': { dep: '25', mun: '899' },
  'mosquera': { dep: '25', mun: '473' },
  'funza': { dep: '25', mun: '286' },
  'madrid': { dep: '25', mun: '430' },
  'facatativa': { dep: '25', mun: '269' },
}

export interface CodigosUbicacion {
  codigo_pais: string | null
  codigo_departamento: string | null
  codigo_municipio: string | null
}

/**
 * Resuelve los códigos DANE a partir de los NOMBRES (país/departamento/municipio),
 * que se extraen con mayor fiabilidad que los códigos. Precedencia por campo:
 *   nombre-resuelto  >  código extraído (fallback)  >  null
 * Nunca inventa un municipio: si el municipio no está en tabla, deja el extraído.
 */
export function resolverCodigosUbicacion(
  pais: string | null | undefined,
  departamento: string | null | undefined,
  municipio: string | null | undefined,
  extraidos?: Partial<CodigosUbicacion>,
): CodigosUbicacion {
  const nPais = normalize(pais)
  const nDep = normalize(departamento)
  const nMun = normalize(municipio)

  const codigo_pais = nPais.includes('colombia') ? CODIGO_PAIS_COLOMBIA : (extraidos?.codigo_pais ?? null)

  const depByName = DEPARTAMENTOS[nDep] ?? null
  // La clave de municipio es global (mismo nombre en varios departamentos, ej.
  // Rionegro en Antioquia y Santander). Solo confiamos en el match de municipio si
  // su departamento coincide con el nombre de departamento extraído (o si no hay
  // nombre de departamento). Así un homónimo no sobrescribe el departamento correcto.
  const muni = MUNICIPIOS[nMun]
  const muniOk = muni && (!depByName || muni.dep === depByName)

  const codigo_departamento = depByName ?? (muniOk ? muni!.dep : null) ?? extraidos?.codigo_departamento ?? null
  const codigo_municipio = muniOk ? muni!.mun : (extraidos?.codigo_municipio ?? null)

  return { codigo_pais, codigo_departamento, codigo_municipio }
}
