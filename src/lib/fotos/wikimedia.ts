/**
 * Sugerencia de fotos desde Wikimedia Commons para el catálogo de la propuesta (PR 4).
 *
 * Se busca por nombre + ciudad (`consultaDeFoto`) y se queda solo lo que se puede imprimir en
 * una propuesta comercial con su crédito:
 *   · licencia CC0, CC BY o CC BY-SA (sin NC ni ND, sin dominio público sin marca: la regla de
 *     Mauricio del 2026-10-14), con autor conocido;
 *   · foto (JPEG, PNG, TIFF o WebP), de al menos 800 px de ancho;
 *   · sin restricción de derechos de imagen de personas (`personality`).
 *
 * `candidatasDeRespuesta` es PURA (se prueba con una respuesta de ejemplo); `buscarEnCommons`
 * hace la llamada, con `fetch` inyectable. Commons pide identificarse con un User-Agent propio.
 */
import { OPCIONES_POR_PAGINA, seSugiereDeCommons, type TipoFoto } from './clave'
import { firmaDelHotel, tituloEsDelHotel } from './nombre-hotel'

export const API_COMMONS = 'https://commons.wikimedia.org/w/api.php'
export const AGENTE_COMMONS = 'MetrikONE/1.0 (https://metrikone.co; mauricio.moreno@metrik.com.co)'
/** Ancho de la miniatura que se baja y se guarda. */
export const ANCHO_DESCARGA = 1600
export const ANCHO_MINIMO = 800
/** Ancho de la miniatura que ve la persona en el selector (no se guarda). */
export const ANCHO_MINIATURA = 400

export interface CandidataFoto {
  /** «File:Sagrada Familia 01.jpg» */
  titulo: string
  /** La página del archivo en Commons (la fuente del crédito). */
  pagina: string
  /** La miniatura a `ANCHO_DESCARGA` px (o el original si es más chico). */
  descarga: string
  ancho: number
  alto: number
  autor: string
  /** Normalizada: «CC0», «CC BY 4.0», «CC BY-SA 3.0», «CC BY 2.0 de». */
  licencia: string
}

/** Lo que se le pregunta a Commons. La ciudad no se repite si el nombre ya la dice. */
export function consultaDeFoto(tipo: TipoFoto, nombre: string, ciudad: string | null): string {
  const n = nombre.replace(/\s+/g, ' ').trim()
  if (tipo === 'ciudad' || !ciudad) return n
  const c = ciudad.split(',')[0].replace(/\s*\(?\b[A-Z]{3}\b\)?\s*$/, '').trim()
  const yaLaDice = c !== '' && n.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').includes(c.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''))
  return yaLaDice || !c ? n : `${n} ${c}`
}

export function urlDeBusqueda(consulta: string, limite = 8, ancho = ANCHO_DESCARGA): string {
  const p = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'search',
    gsrsearch: `${consulta} filetype:bitmap`,
    gsrnamespace: '6',
    gsrlimit: String(limite),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime',
    iiurlwidth: String(ancho),
  })
  return `${API_COMMONS}?${p.toString()}`
}

/** Un archivo por su título, con la miniatura a `ancho` px: para revalidarlo al elegirlo. */
export function urlDeArchivo(titulo: string, ancho = ANCHO_DESCARGA): string {
  const p = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    titles: titulo,
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime',
    iiurlwidth: String(ancho),
  })
  return `${API_COMMONS}?${p.toString()}`
}

const MIMES = new Set(['image/jpeg', 'image/png', 'image/tiff', 'image/webp'])
const HOSTS_DESCARGA = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org'])

/** ¿La URL de descarga es de los servidores de archivos de Wikimedia (y por https)? */
export function esDeWikimedia(url: string | null | undefined): boolean {
  try {
    const u = new URL(url ?? '')
    return u.protocol === 'https:' && HOSTS_DESCARGA.has(u.hostname)
  } catch {
    return false
  }
}

/** Palabras que en Commons no ayudan a encontrar el lugar («con guía», «en familia», «tour»). */
const RELLENO = new Set([
  'a', 'al', 'con', 'de', 'del', 'el', 'en', 'la', 'las', 'los', 'para', 'por', 'sin', 'y', 'e', 'o', 'u',
  'guia', 'guiada', 'guiado', 'visita', 'visitas', 'tour', 'tours', 'entrada', 'entradas', 'ticket', 'tickets',
  'familia', 'ninos', 'privado', 'privada', 'compartido', 'compartida', 'filas', 'espanol', 'excursion',
  'dia', 'medio', 'completo', 'noche', 'cena', 'almuerzo', 'recorrido', 'corto', 'hotel', 'hoteles',
])

const sinTilde = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

/** Tope de consultas por objetivo: cada una es una ida a Commons. */
export const MAX_CONSULTAS = 8

/**
 * Las consultas a Commons, de la más precisa a la más amplia: Commons exige TODAS las palabras,
 * y «Park Güell con guía Barcelona» no encuentra nada que «Park Güell Barcelona» sí. Solo las
 * actividades se aflojan: primero el nombre con la ciudad, luego sin las palabras de relleno, y al
 * final sin ciudad. Una ciudad, solo con su nombre completo. Un hotel, ninguna: no se busca.
 *
 * Con los nombres reales de los proveedores (COT-2026-0026, 2026-10-14) eso no alcanzaba: «Torre
 * Eiffel: acceso a la cumbre en ascensor», «Disneyland Paris: entrada de 1 día a los 2 parques» y
 * «Paseo en barco por los canales de Ámsterdam» daban 0 y el panel decía «no tienen foto». Después
 * de lo anterior van: lo que está antes de «:» (el lugar: «Torre Eiffel París»), pares de palabras
 * útiles con la ciudad y, al final, cada palabra útil con la ciudad, la más larga primero
 * («canales Ámsterdam»). Nunca más de `MAX_CONSULTAS`.
 */
export function consultasDeFoto(tipo: TipoFoto, nombre: string, ciudad: string | null): string[] {
  // Un hotel no se busca en Commons: su foto la sube la asesora (`seSugiereDeCommons`).
  if (!seSugiereDeCommons(tipo)) return []
  const completa = consultaDeFoto(tipo, nombre, ciudad)
  if (tipo !== 'actividad') return [completa]
  const util = nombre.replace(/\s+/g, ' ').trim().split(' ').filter((w) => !RELLENO.has(sinTilde(w).replace(/[^a-z0-9]/g, '')) && !/^\d+$/.test(w))
  const corto = util.join(' ')
  const salida = [completa]
  if (corto && corto !== nombre.trim()) salida.push(consultaDeFoto(tipo, corto, ciudad))
  if (tipo === 'actividad' && util.length >= 2) salida.push(corto)
  // El lugar: lo que va antes de «:», « - » o «(».
  const cabeza = nombre.split(/:|\s[-–]\s|\(/)[0].replace(/\s+/g, ' ').trim()
  if (cabeza && cabeza !== nombre.trim() && cabeza.split(' ').length <= 4) {
    salida.push(consultaDeFoto(tipo, cabeza, ciudad), cabeza)
  }
  // Pares y palabras sueltas, sin números ni la ciudad (que va al final de cada consulta).
  const deLaCiudad = new Set((ciudad ?? '').split(/[\s,]+/).map((w) => sinTilde(w)).filter(Boolean))
  const palabras = util
    .map((w) => w.replace(/[^\p{L}\p{N}'’-]/gu, ''))
    .filter((w) => w.length >= 3 && !/\d/.test(w) && !deLaCiudad.has(sinTilde(w)))
  for (let i = 0; i + 1 < palabras.length; i++) salida.push(consultaDeFoto(tipo, `${palabras[i]} ${palabras[i + 1]}`, ciudad))
  for (const w of [...palabras].sort((a, b) => b.length - a.length)) if (w.length >= 5) salida.push(consultaDeFoto(tipo, w, ciudad))
  return [...new Set(salida)].slice(0, MAX_CONSULTAS)
}

/**
 * Las consultas del SELECTOR (una persona elige): como `consultasDeFoto`, y para un hotel también,
 * por su nombre con la ciudad y luego solo. Elegir no es sugerir: un hotel nunca se busca solo,
 * pero la persona sí puede ver sus fotos de Commons y escoger una (Mauricio, 2026-10-16).
 */
export function consultasParaElegir(tipo: TipoFoto, nombre: string, ciudad: string | null): string[] {
  if (tipo !== 'hotel') return consultasDeFoto(tipo, nombre, ciudad)
  const n = nombre.replace(/\s+/g, ' ').trim()
  if (!n) return []
  return [...new Set([consultaDeFoto(tipo, n, ciudad), n])]
}

/**
 * La licencia corta de Commons, normalizada, si se puede imprimir; `null` si no.
 * «CC BY-SA 4.0» → igual; «CC-BY-SA-3.0» → «CC BY-SA 3.0»; «CC0 1.0» → «CC0 1.0»;
 * «CC BY-NC 2.0», «CC BY-ND», «Public domain», «GFDL» → null.
 */
export function licenciaImprimible(corta: string | null | undefined): string | null {
  const t = (corta ?? '').trim().replace(/^cc[- ]/i, 'CC ').replace(/\s+/g, ' ')
  if (/^CC ?0( 1\.0)?$/i.test(t)) return t.toUpperCase().replace(/^CC ?0/, 'CC0')
  const m = /^CC (BY(?:[- ]SA)?)(?:[- ]([0-9.]+))?(?: ([a-z]{2,3}))?$/i.exec(t)
  if (!m) return null
  const tipo = m[1].toUpperCase().replace(' ', '-')
  return ['CC', tipo, m[2], m[3]?.toLowerCase()].filter(Boolean).join(' ')
}

/** El autor sin HTML ni espacios de más. «<a href=…>Enric</a>» → «Enric». */
export function autorLimpio(html: string | null | undefined): string | null {
  const t = (html ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (!t || /^unknown|^desconocido/i.test(t)) return null
  return t.length > 120 ? `${t.slice(0, 117)}…` : t
}

type Valor = { value?: unknown } | undefined
const valor = (v: Valor): string | null => (typeof v?.value === 'string' ? v.value : null)

interface PaginaCommons {
  title?: string
  index?: number
  imageinfo?: {
    url?: string
    descriptionurl?: string
    thumburl?: string
    thumbwidth?: number
    thumbheight?: number
    width?: number
    height?: number
    mime?: string
    extmetadata?: Record<string, Valor>
  }[]
}

/** Las candidatas imprimibles de una respuesta de la API, en el orden de relevancia de Commons. */
export function candidatasDeRespuesta(json: unknown): CandidataFoto[] {
  const q = (json as { query?: { pages?: PaginaCommons[] | Record<string, PaginaCommons> } } | null)?.query
  const paginas = Array.isArray(q?.pages) ? q!.pages as PaginaCommons[] : Object.values(q?.pages ?? {})
  return paginas
    .slice()
    .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
    .flatMap((p): CandidataFoto[] => {
      const ii = p.imageinfo?.[0]
      if (!p.title || !ii) return []
      if (!ii.mime || !MIMES.has(ii.mime)) return []
      if (!ii.width || ii.width < ANCHO_MINIMO || !ii.height) return []
      const meta = ii.extmetadata ?? {}
      const licencia = licenciaImprimible(valor(meta.LicenseShortName))
      if (!licencia) return []
      if (/personality/i.test(valor(meta.Restrictions) ?? '')) return []
      const autor = autorLimpio(valor(meta.Artist))
      if (!autor) return []
      const pagina = ii.descriptionurl ?? null
      const descarga = ii.thumburl ?? ii.url ?? null
      // Solo de los servidores de Wikimedia: la URL de descarga la baja el servidor de ONE.
      if (!pagina || !pagina.startsWith('https://commons.wikimedia.org/') || !descarga || !esDeWikimedia(descarga)) return []
      return [{
        titulo: p.title,
        pagina,
        descarga,
        ancho: ii.thumbwidth ?? ii.width,
        alto: ii.thumbheight ?? ii.height,
        autor,
        licencia,
      }]
    })
}

/**
 * La que se sugiere: la primera que nadie descartó, prefiriendo las horizontales (las tarjetas
 * del documento son apaisadas). `null` si no queda ninguna.
 */
export function elegirCandidata(candidatas: CandidataFoto[], descartadas: readonly string[] = []): CandidataFoto | null {
  const libres = candidatas.filter((c) => !descartadas.includes(c.titulo))
  return libres.find((c) => c.ancho / c.alto >= 1.2) ?? libres[0] ?? null
}

/**
 * Busca en Commons y devuelve las candidatas imprimibles. Nunca lanza: sin red o con una
 * respuesta rara, lista vacía (la propuesta sale con el degradado).
 */
export async function buscarEnCommons(
  consulta: string,
  opts: { fetch?: typeof fetch; timeoutMs?: number; limite?: number; ancho?: number } = {},
): Promise<CandidataFoto[]> {
  const f = opts.fetch ?? fetch
  try {
    const r = await f(urlDeBusqueda(consulta, opts.limite, opts.ancho), {
      headers: { 'User-Agent': AGENTE_COMMONS, 'Api-User-Agent': AGENTE_COMMONS },
      signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
    })
    if (!r.ok) return []
    return candidatasDeRespuesta(await r.json())
  } catch {
    return []
  }
}

/**
 * La línea de crédito, como el pie de créditos del documento: «Sagrada Familia, Enric
 * (Wikimedia Commons, CC BY 4.0)». Sin autor o sin licencia no hay crédito (foto propia).
 */
export function creditoDeCatalogo(f: { nombre: string; autor: string | null; licencia: string | null }): string | null {
  if (!f.autor || !f.licencia) return null
  return `${f.nombre}, ${f.autor} (Wikimedia Commons, ${f.licencia})`
}

/**
 * Las opciones de Commons para el selector: hasta `OPCIONES_POR_PAGINA` por tanda, de la consulta
 * más precisa a la más amplia, sin repetir archivo ni mostrar los descartados. `pagina` 0 es la
 * primera tanda; «Ver más» pide la 1, la 2… Nada se guarda: la miniatura (`descarga`, a
 * `ANCHO_MINIATURA` px) es solo para verla. Nunca lanza.
 */
export async function opcionesDeCommons(
  o: { tipo: TipoFoto; nombre: string; ciudad: string | null },
  opts: { pagina?: number; descartadas?: readonly string[]; fetch?: typeof fetch } = {},
): Promise<{ candidatas: CandidataFoto[]; hayMas: boolean }> {
  const pagina = Math.max(0, Math.floor(opts.pagina ?? 0))
  const hasta = (pagina + 1) * OPCIONES_POR_PAGINA
  const vistas = new Map<string, CandidataFoto>()
  // Una consulta a la vez (Commons pide no lanzarlas en paralelo), hasta tener una de más.
  for (const q of consultasParaElegir(o.tipo, o.nombre, o.ciudad)) {
    if (vistas.size > hasta) break
    const lista = await buscarEnCommons(q, { fetch: opts.fetch, limite: 50, ancho: ANCHO_MINIATURA })
    for (const c of lista) if (!vistas.has(c.titulo) && !(opts.descartadas ?? []).includes(c.titulo)) vistas.set(c.titulo, c)
  }
  const todas = [...vistas.values()]
  return { candidatas: todas.slice(pagina * OPCIONES_POR_PAGINA, hasta), hayMas: todas.length > hasta }
}

/**
 * Un archivo de Commons por su título, revalidado al elegirlo (licencia, autor, tamaño): el
 * navegador solo manda el título, nunca la licencia ni la URL. `null` si ya no se puede imprimir.
 */
export async function archivoDeCommons(titulo: string, opts: { fetch?: typeof fetch } = {}): Promise<CandidataFoto | null> {
  if (typeof titulo !== 'string' || !/^File:.{1,240}$/.test(titulo)) return null
  const f = opts.fetch ?? fetch
  try {
    const r = await f(urlDeArchivo(titulo), {
      headers: { 'User-Agent': AGENTE_COMMONS, 'Api-User-Agent': AGENTE_COMMONS },
      signal: AbortSignal.timeout(8000),
    })
    if (!r.ok) return null
    return candidatasDeRespuesta(await r.json()).find((c) => c.titulo === titulo) ?? null
  } catch {
    return null
  }
}

// ── Hoteles: precisión antes que cantidad (Mauricio, 2026-10-16) ─────────────

/** Los archivos de una categoría de Commons («Category:Hotel Arts Barcelona»), con su imageinfo. */
export function urlDeCategoria(categoria: string, limite = 50, ancho = ANCHO_MINIATURA): string {
  const titulo = categoria.startsWith('Category:') ? categoria : `Category:${categoria}`
  const p = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    generator: 'categorymembers',
    gcmtitle: titulo,
    gcmtype: 'file',
    gcmlimit: String(limite),
    prop: 'imageinfo',
    iiprop: 'url|extmetadata|size|mime',
    iiurlwidth: String(ancho),
  })
  return `${API_COMMONS}?${p.toString()}`
}

/** Búsqueda de CATEGORÍAS de Commons (espacio 14). */
export function urlDeBusquedaDeCategorias(consulta: string, limite = 10): string {
  const p = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    list: 'search',
    srsearch: consulta,
    srnamespace: '14',
    srlimit: String(limite),
  })
  return `${API_COMMONS}?${p.toString()}`
}

/** Los títulos de categoría de una respuesta de `urlDeBusquedaDeCategorias`. PURO. */
export function categoriasDeRespuesta(json: unknown): string[] {
  const s = (json as { query?: { search?: { title?: unknown }[] } } | null)?.query?.search
  return (Array.isArray(s) ? s : []).map((x) => x.title).filter((t): t is string => typeof t === 'string' && t.startsWith('Category:'))
}

/** Tope de candidatas de Commons para un hotel (cada una se clasifica con el modelo). */
export const MAX_CANDIDATAS_HOTEL = 36

async function pedirCommons(url: string, f: typeof fetch): Promise<unknown> {
  try {
    const r = await f(url, {
      headers: { 'User-Agent': AGENTE_COMMONS, 'Api-User-Agent': AGENTE_COMMONS },
      signal: AbortSignal.timeout(8000),
    })
    return r.ok ? await r.json() : null
  } catch {
    return null
  }
}

/** De dónde salió una candidata de un hotel: su categoría exacta en Commons o un título que lo nombra. */
export type ViaCommons = 'categoria' | 'titulo'

/** Una candidata de un hotel: por dónde llegó y si su título nombra el hotel. */
export type CandidataHotel = CandidataFoto & { via: ViaCommons; nombraElHotel: boolean }

/**
 * Las candidatas de Commons para un HOTEL, solo las que pueden ser de ese hotel:
 *   1. los archivos de su categoría exacta: la de Wikidata (P373, `categoriaWikidata`) o una
 *      categoría cuyo título nombra el hotel (`tituloEsDelHotel`);
 *   2. los archivos de la búsqueda cuyo título nombra el hotel.
 * Lo demás se descarta: «Parc Can Dragó» no sale para «Ibis Barcelona Centro».
 *
 * ⚠️ La categoría exacta NO basta sola: medido el 2026-10-16, «Category:Pullman Paris Tour Eiffel»
 * trae «The Eiffel Tower» y «Summit @ Eiffel Tower» (vistas DESDE el hotel). Un archivo de la
 * categoría cuyo título no nombra el hotel sale con `nombraElHotel = false`, y solo se ofrece si el
 * modelo dice que es una foto de hotel (`opciones-hotel.ts`). Las miniaturas son de
 * `ANCHO_MINIATURA` px (para verlas y clasificarlas). Nunca lanza.
 */
export async function candidatasDeHotelEnCommons(
  o: { nombre: string; ciudad: string | null },
  opts: { fetch?: typeof fetch; categoriaWikidata?: string | null; descartadas?: readonly string[] } = {},
): Promise<{ candidatas: CandidataHotel[]; categoria: string | null }> {
  const f = opts.fetch ?? fetch
  const firma = firmaDelHotel(o.nombre, o.ciudad)
  if (firma.vacia) return { candidatas: [], categoria: null }
  const vistas = new Map<string, CandidataHotel>()
  const fuera = new Set(opts.descartadas ?? [])
  const poner = (lista: CandidataFoto[], via: ViaCommons) => {
    for (const c of lista) {
      if (vistas.size >= MAX_CANDIDATAS_HOTEL) return
      if (!vistas.has(c.titulo) && !fuera.has(c.titulo)) vistas.set(c.titulo, { ...c, via, nombraElHotel: tituloEsDelHotel(c.titulo, firma) })
    }
  }

  // 1. La categoría exacta del hotel.
  let categoria = opts.categoriaWikidata ? `Category:${opts.categoriaWikidata.replace(/^Category:/, '')}` : null
  if (!categoria) {
    const consulta = consultaDeFoto('hotel', o.nombre, o.ciudad)
    categoria = categoriasDeRespuesta(await pedirCommons(urlDeBusquedaDeCategorias(consulta), f)).find((t) => tituloEsDelHotel(t, firma)) ?? null
  }
  if (categoria) poner(candidatasDeRespuesta(await pedirCommons(urlDeCategoria(categoria), f)), 'categoria')

  // 2. Los archivos cuyo título nombra el hotel.
  for (const q of consultasParaElegir('hotel', o.nombre, o.ciudad)) {
    if (vistas.size >= MAX_CANDIDATAS_HOTEL) break
    const lista = await buscarEnCommons(q, { fetch: f, limite: 50, ancho: ANCHO_MINIATURA })
    poner(lista.filter((c) => tituloEsDelHotel(c.titulo, firma)), 'titulo')
  }
  return { candidatas: [...vistas.values()], categoria }
}
