/**
 * ¿Este archivo (o esta categoría) de Wikimedia Commons es del hotel que se busca? Puro.
 *
 * La búsqueda de texto libre de Commons es laxa (Mauricio, 2026-10-16): para «Ibis Barcelona
 * Centro» devolvía «Parc Can Dragó 001.jpg»; para «Pullman Paris Tour Eiffel», «The Eiffel Tower»;
 * para «Gran Hotel Inglés», un homenaje al «Hotel Florida». Precisión antes que cantidad: es mejor
 * cero opciones que una foto de otro lugar.
 *
 * La regla: el título tiene que nombrar TODAS las palabras distintivas del hotel, que son las del
 * nombre menos
 *   · las genéricas («hotel», «suites», «spa», «resort», «boutique»…) y los artículos;
 *   · las de la ciudad («Barcelona» en «Ibis Barcelona Centro»: la tiene cualquier foto de allá).
 * Una palabra cuenta en otro idioma («tour» = «tower» = «torre») y en plural. Si lo único
 * distintivo es la cadena («Ibis Barcelona», «Four Seasons Madrid»), el título también tiene que
 * nombrar la ciudad: hay un Ibis en cada ciudad. Sin nada distintivo («Hotel París»), nada pasa.
 */
import { claveDeFoto, nombreLlano } from './clave'

/** Palabras que no distinguen un hotel de otro. */
const GENERICAS = new Set([
  'hotel', 'hoteles', 'hotels', 'hotell', 'hotelito', 'hostal', 'hostel', 'hosteria', 'posada', 'resort', 'resorts',
  'suites', 'suite', 'spa', 'boutique', 'inn', 'apartamentos', 'apartments', 'apartment', 'aparthotel',
  'apartahotel', 'apart', 'collection', 'rooms', 'residence', 'lodge', 'albergo', 'pension',
  // artículos y enlaces, en los idiomas de los destinos
  'a', 'al', 'and', 'at', 'by', 'de', 'del', 'des', 'di', 'du', 'el', 'en', 'et', 'la', 'las', 'le', 'les', 'lo',
  'los', 'of', 'the', 'y', 'e', 'da', 'do', 'dos', 'das', 'am', 'an', 'im', 'und', 'het', 'il', 'by',
])

/**
 * Marcas y cadenas (y las palabras de las de dos palabras): solas no dicen CUÁL hotel. No
 * tienen que estar todas: la lista solo decide cuándo hace falta la ciudad en el título.
 */
const CADENAS = new Set([
  'ibis', 'styles', 'pullman', 'novotel', 'mercure', 'sofitel', 'mgallery', 'adagio', 'accor', 'hilton', 'doubletree',
  'hampton', 'marriott', 'courtyard', 'sheraton', 'westin', 'renaissance', 'hyatt', 'radisson', 'blu', 'nh',
  'melia', 'barcelo', 'riu', 'iberostar', 'h10', 'catalonia', 'intercontinental', 'crowne', 'holiday', 'express',
  'wyndham', 'ramada', 'best', 'western', 'kempinski', 'fairmont', 'four', 'seasons', 'ritz', 'carlton', 'sercotel',
  'eurostars', 'ilunion', 'vincci', 'ac', 'meininger', 'motel', 'one', 'citizenm', 'premier', 'leonardo',
  'occidental', 'room', 'mate', 'petit', 'palace', 'park', 'plaza', 'hesperia', 'senator', 'abba', 'hipotels',
  'tryp', 'sol', 'innside', 'gran', 'grand', 'moxy', 'aloft', 'hotusa', 'exe', 'zenit', 'axor', 'sb', 'rafaelhoteles',
  'kimpton', 'jumeirah', 'mandarin', 'oriental', 'shangri', 'peninsula', 'waldorf', 'astoria', 'conrad', 'hard',
  'rock', 'decameron', 'estelar', 'dann', 'movich', 'gha', 'selina', 'generator', 'premier', 'travelodge', 'scandic',
  'golden', 'tulip', 'louvre', 'campanile', 'kyriad', 'b&b',
])

/**
 * Marcas sin otro significado: si el título nombra una que el hotel NO lleva, es de otro hotel
 * («RIU hotel, Playa del Inglés, Gran Canaria» no es el «Gran Hotel Inglés» de Madrid).
 */
const MARCAS = new Set([
  'ibis', 'pullman', 'novotel', 'mercure', 'sofitel', 'mgallery', 'adagio', 'hilton', 'doubletree', 'hampton',
  'marriott', 'courtyard', 'sheraton', 'westin', 'hyatt', 'radisson', 'nh', 'melia', 'barcelo', 'riu', 'iberostar',
  'h10', 'catalonia', 'intercontinental', 'crowne', 'wyndham', 'ramada', 'kempinski', 'fairmont', 'ritz', 'sercotel',
  'eurostars', 'ilunion', 'vincci', 'meininger', 'citizenm', 'hesperia', 'tryp', 'innside', 'moxy', 'aloft',
  'kimpton', 'jumeirah', 'conrad', 'decameron', 'estelar', 'selina', 'scandic', 'kyriad', 'campanile', 'occidental',
  'hipotels', 'travelodge', 'novotel',
])

/** La misma palabra en los idiomas de los destinos (todo en `nombreLlano`). */
const SINONIMOS: string[][] = [
  ['tour', 'tower', 'torre', 'turm', 'toren', 'tours'],
  ['centro', 'centre', 'center', 'zentrum', 'centrum', 'centrale'],
  ['plaza', 'place', 'platz', 'piazza', 'praca', 'plein', 'placa'],
  ['puerta', 'gate', 'porta', 'porte'],
  ['palacio', 'palace', 'palais', 'palazzo', 'palau', 'palast'],
  ['gran', 'grand', 'grande'],
  ['mar', 'sea', 'mer', 'mare'],
  ['playa', 'beach', 'plage', 'spiaggia', 'praia', 'strand'],
  ['rio', 'river', 'riviere', 'fiume'],
  ['jardin', 'jardines', 'garden', 'gardens', 'jardins', 'giardino', 'garten'],
  ['catedral', 'cathedral', 'cathedrale', 'duomo', 'kathedrale', 'catedrale'],
  ['puerto', 'port', 'porto', 'harbour', 'harbor', 'hafen', 'haven'],
  ['ingles', 'english', 'anglais', 'inglese'],
  ['estacion', 'station', 'gare', 'bahnhof', 'stazione'],
  ['opera', 'oper'],
  ['nuevo', 'nueva', 'new', 'nouveau', 'nouvelle', 'nuovo', 'neu'],
  ['real', 'royal', 'royale', 'reale'],
  ['ciudad', 'city', 'ville', 'citta', 'stadt'],
  ['parque', 'park', 'parc', 'parco'],
  ['castillo', 'castle', 'chateau', 'castello', 'schloss'],
]
const SINONIMO = new Map<string, Set<string>>()
for (const g of SINONIMOS) for (const w of g) SINONIMO.set(w, new Set([...(SINONIMO.get(w) ?? []), ...g]))

/** Las palabras de un texto, en `nombreLlano`. «File:Hotel Ibis (Barcelona) 01.jpg» → hotel, ibis, barcelona, 01. */
export function palabras(texto: string): string[] {
  const sinPrefijo = texto.replace(/^(file|archivo|category|categoria|categoría):/i, '').replace(/\.(jpe?g|png|tiff?|webp|gif)$/i, '')
  return nombreLlano(sinPrefijo).split(' ').filter(Boolean)
}

/** Las palabras de la ciudad («Madrid MAD», «París, Francia» → paris). */
function palabrasDeCiudad(ciudad: string | null | undefined): Set<string> {
  if (!ciudad) return new Set()
  const salida = new Set<string>()
  for (const w of palabras(claveDeFoto('ciudad', ciudad))) salida.add(w)
  for (const w of palabras(ciudad.split(',')[0] ?? '')) if (w.length > 3 || !/^[a-z]{3}$/.test(w)) salida.add(w)
  return salida
}

/** Lo que un título necesita nombrar para ser de este hotel. */
export interface FirmaHotel {
  /** Cada palabra distintiva con sus equivalentes; el título tiene que tener una de cada grupo. */
  requeridas: string[][]
  /** El título también tiene que nombrar la ciudad (lo único distintivo era la cadena). */
  exigeCiudad: boolean
  ciudad: string[]
  /** Las marcas que el nombre sí lleva (otra marca en el título = otro hotel). */
  marcas: string[]
  /** Sin palabras distintivas: nada es de este hotel. */
  vacia: boolean
}

export function firmaDelHotel(nombre: string, ciudad: string | null | undefined): FirmaHotel {
  const deCiudad = palabrasDeCiudad(ciudad)
  const vistas = new Set<string>()
  const distintivas: string[] = []
  for (const w of palabras(nombre)) {
    if (GENERICAS.has(w) || deCiudad.has(w) || vistas.has(w)) continue
    // Números sueltos («4», «5») no distinguen; «h10» o «1898» sí.
    if (/^\d{1,2}$/.test(w)) continue
    vistas.add(w)
    distintivas.push(w)
  }
  const soloCadena = distintivas.length > 0 && distintivas.every((w) => CADENAS.has(w))
  return {
    marcas: palabras(nombre).filter((w) => MARCAS.has(w)),
    requeridas: distintivas.map((w) => [...(SINONIMO.get(w) ?? new Set([w]))]),
    exigeCiudad: soloCadena,
    ciudad: [...deCiudad],
    vacia: distintivas.length === 0 || (soloCadena && deCiudad.size === 0),
  }
}

/** ¿El título tiene la palabra? (o su plural / singular). */
function tiene(titulo: Set<string>, w: string): boolean {
  if (titulo.has(w)) return true
  if (titulo.has(`${w}s`)) return true
  return w.length > 4 && w.endsWith('s') && titulo.has(w.slice(0, -1))
}

/** ¿El título (de un archivo o de una categoría de Commons) es de este hotel? */
export function tituloEsDelHotel(titulo: string, firma: FirmaHotel): boolean {
  if (firma.vacia) return false
  const ws = new Set(palabras(titulo))
  if (!firma.requeridas.every((grupo) => grupo.some((w) => tiene(ws, w)))) return false
  if (firma.exigeCiudad && !firma.ciudad.some((w) => tiene(ws, w))) return false
  for (const w of ws) if (MARCAS.has(w) && !firma.marcas.includes(w)) return false
  return true
}

/** Atajo: ¿este título es del hotel `nombre` en `ciudad`? */
export function esDelHotel(titulo: string, nombre: string, ciudad: string | null | undefined): boolean {
  return tituloEsDelHotel(titulo, firmaDelHotel(nombre, ciudad))
}
