/**
 * El catálogo de aerolíneas: una sola lista de la que salen la SIGLA y el COLOR de la pastilla,
 * en el PDF de la cotización de Trappvel y en ONE (la hoja del cliente y la tarjeta de la opción).
 *
 * Brief del 2026-10-08 (Mauricio, «adelante»), a partir de la guía visual de aerolíneas de Edgar:
 *
 * - La sigla es el código IATA de 2 letras y se muestra TAL COMO VIENE (J6 se ve J6), pero el
 *   color sale de la aerolínea a la que pertenece: los códigos por país apuntan a la misma.
 * - El color es el de la marca ACTUAL, aunque la guía diga otra cosa (Clic, Arajet y SKY
 *   cambiaron de marca; Delta, Air France y LATAM llevan el azul oscuro de primario). No hay un
 *   estándar internacional de colores de aerolíneas.
 * - Con secundario, el secundario va como franja inferior de la pastilla.
 * - Texto blanco, salvo Spirit (negro sobre amarillo).
 * - Sin identificar: gris con la sigla si la hay; sin sigla no se pinta pastilla.
 * - Los colores de tarifa (`colorDeTarifa`) quedan SOLO para tarifas: ninguna aerolínea los usa.
 *
 * Hasta ese día la pastilla del PDF rotaba magenta/verde/púrpura por hash (`colorDeSigla`): dos
 * aerolíneas salían del mismo color, y del color de una tarifa.
 *
 * Puro: sin red y sin base. Lo importa un client component.
 */

export interface Aerolinea {
  nombre: string
  /** Claves de nombre: sin tildes, minúscula, se comparan como palabra entera. */
  claves: readonly string[]
  /** Todos sus códigos IATA. El primero es la sigla que se pone cuando solo se conoce el nombre. */
  iata: readonly string[]
  fondo: string
  franja: string | null
  texto: string
}

export interface ColorDeAerolinea {
  fondo: string
  franja: string | null
  texto: string
}

const BLANCO = '#FFFFFF'

/** La pastilla de una sigla que el catálogo no reconoce. */
export const COLOR_SIN_IDENTIFICAR: ColorDeAerolinea = { fondo: '#6B7280', franja: null, texto: BLANCO }

const a = (nombre: string, claves: string[], iata: string[], fondo: string, franja: string | null = null, texto = BLANCO): Aerolinea =>
  ({ nombre, claves, iata, fondo, franja, texto })

export const AEROLINEAS: readonly Aerolinea[] = [
  a('Avianca', ['avianca'], ['AV'], '#FF0000'),
  a('LATAM', ['latam'], ['LA', '4C', 'JJ', 'LP', 'XL'], '#2A0088', '#ED1651'),
  a('Wingo', ['wingo'], ['P5'], '#6633CC'),
  a('JetSMART', ['jetsmart'], ['JA', 'J6', 'WJ', 'JZ'], '#0A396D', '#9E202D'),
  a('Clic', ['clic', 'easyfly'], ['VE'], '#E40046'),
  a('SATENA', ['satena'], ['9R'], '#EB2724', '#246AA8'),
  a('Copa', ['copa'], ['CM'], '#0060A9'),
  a('American', ['american'], ['AA'], '#0078D2', '#C30019'),
  a('Delta', ['delta'], ['DL'], '#003366', '#C01933'),
  a('United', ['united'], ['UA'], '#0033A0'),
  a('Air Canada', ['air canada'], ['AC'], '#F01428'),
  a('Aeroméxico', ['aeromexico'], ['AM'], '#040C3E'),
  a('Arajet', ['arajet'], ['DM'], '#510C76'),
  a('Iberia', ['iberia'], ['IB'], '#B11C25', '#FACD08'),
  a('Air Europa', ['air europa'], ['UX'], '#0970CB'),
  a('Air France', ['air france'], ['AF'], '#051040', '#FF0000'),
  a('KLM', ['klm'], ['KL'], '#00A1DE'),
  a('Lufthansa', ['lufthansa'], ['LH'], '#05164D', '#FFAD00'),
  a('Turkish', ['turkish'], ['TK'], '#C70A0C'),
  a('Emirates', ['emirates'], ['EK'], '#D71A21'),
  // «sky» suelto atraparía cualquier cosa: solo «sky airline».
  a('SKY Airline', ['sky airline'], ['H2', 'H8'], '#59237F', '#5DBC5E'),
  a('Aerolíneas Argentinas', ['aerolineas argentinas'], ['AR'], '#0081C6'),
  a('Volaris', ['volaris'], ['Y4', 'Q6', 'N3'], '#91268F'),
  a('Viva Aerobus', ['viva aerobus', 'vivaaerobus'], ['VB'], '#00AE44'),
  a('Spirit', ['spirit'], ['NK'], '#FFEC00', '#000000', '#000000'),
  a('JetBlue', ['jetblue'], ['B6'], '#00205B'),
  a('British Airways', ['british airways'], ['BA'], '#0035AD', '#CC3333'),
  a('ITA Airways', ['ita airways'], ['AZ'], '#0171CF', '#BE210C'),
  a('TAP', ['tap'], ['TP'], '#ED1C24', '#46A41A'),
  a('Qatar', ['qatar'], ['QR'], '#660033'),
]

const sinTildes = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** La aerolínea dueña de un código IATA (`J6` → JetSMART). `null` si no está en el catálogo. */
export function aerolineaDeSigla(sigla: string | null | undefined): Aerolinea | null {
  const s = (sigla ?? '').trim().toUpperCase()
  if (!s) return null
  return AEROLINEAS.find(x => x.iata.includes(s)) ?? null
}

/** La aerolínea que nombra un texto leído. La clave tiene que ser palabra entera: «tap» no atrapa «Tapachula». */
export function aerolineaDeNombre(nombre: string | null | undefined): Aerolinea | null {
  if (!nombre) return null
  const n = sinTildes(nombre)
  for (const x of AEROLINEAS) {
    for (const clave of x.claves) {
      if (new RegExp(`(^|[^a-z])${clave}([^a-z]|$)`).test(n)) return x
    }
  }
  return null
}

/**
 * La sigla de la pastilla. Primero la que trae el número de vuelo (`AV8520` → `AV`, `J6 1234` →
 * `J6`), que es un dato leído; si no, la del nombre. Sin ninguna de las dos devuelve `null` y la
 * pastilla no se pinta: dos letras inventadas se leerían como un código real.
 */
export function siglaAerolinea(aerolinea: string | null, numeroVuelo?: string | null): string | null {
  const delNumero = /^([A-Z0-9]{2})\s?\d{1,4}\b/.exec((numeroVuelo ?? '').trim().toUpperCase())
  if (delNumero && /[A-Z]/.test(delNumero[1])) return delNumero[1]
  return aerolineaDeNombre(aerolinea)?.iata[0] ?? null
}

/** El color de la pastilla de una sigla: el de su aerolínea, o gris si el catálogo no la conoce. */
export function colorDeAerolinea(sigla: string | null | undefined): ColorDeAerolinea {
  const x = aerolineaDeSigla(sigla)
  return x ? { fondo: x.fondo, franja: x.franja, texto: x.texto } : COLOR_SIN_IDENTIFICAR
}
