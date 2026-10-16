/**
 * Fotos de la página OFICIAL de un hotel o de un tour, para el selector de la biblioteca
 * (decisión de Mauricio del 2026-10-16, fuente (a)).
 *
 * ⚠️ Detrás de un interruptor por workspace (`usaFotosDeSitioOficial`), apagado por defecto:
 * Emilio no ha validado su uso comercial. Mientras esté apagado, nada de esto se llama.
 *
 * Cómo se encuentran las fotos, sin buscador de Google (Custom Search cerrada a clientes nuevos y
 * apagada el 2027-01-01; Places prohíbe guardar fotos):
 *   1. la persona pega la URL de la página (la galería del hotel, la ficha del tour); o
 *   2. ONE la propone desde Wikidata (`paginaOficialDesdeWikidata`): la entidad del hotel o del
 *      lugar con el MISMO nombre y en la MISMA ciudad trae su «sitio web oficial» (P856). Solo
 *      si hay exactamente una así: si no, se le pide la URL a la persona. La persona ve el
 *      dominio antes de elegir.
 * De la página se toman: `og:image`/`twitter:image`, las imágenes del JSON-LD (schema.org
 * `Hotel.image`, `photo`) y las `<img>` grandes (la galería), en ese orden.
 *
 * El servidor baja páginas e imágenes que dice el navegador: TODA descarga pasa por
 * `traerSeguro` (solo https al puerto 443, nada que resuelva a una IP privada, redirecciones
 * revisadas una por una, tope de bytes y de tiempo). Queda el riesgo residual de un DNS que
 * cambie entre la revisión y la conexión (rebinding); el tope de bytes y de tiempo lo acota.
 */
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import sharp from 'sharp'

import { claveDeFoto, nombreLlano, OPCIONES_POR_PAGINA, type TipoFoto } from './clave'
import { AGENTE_COMMONS } from './wikimedia'

export const AGENTE = AGENTE_COMMONS
export const BYTES_MAXIMOS_PAGINA = 3_000_000
export const BYTES_MAXIMOS_IMAGEN = 15_000_000
/** Más chica que esto no sirve para una tarjeta de la propuesta (iconos, logos, miniaturas). */
export const ANCHO_MINIMO_SITIO = 600
export const ALTO_MINIMO_SITIO = 300
const MAX_REDIRECCIONES = 3
const MAX_IMAGENES_EN_PAGINA = 120

export type Resolver = (host: string) => Promise<string[]>

const resolverPorDefecto: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address)

// ── Red: solo lo público ─────────────────────────────────────────────────────

function ipv4Privada(ip: string): boolean {
  const p = ip.split('.').map(Number)
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true
  const [a, b] = p
  return (
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19))
  )
}

/** ¿La IP es privada, local, de enlace, multicast o reservada? (lo que el servidor no debe tocar). */
export function ipPrivada(ip: string): boolean {
  const v = isIP(ip)
  if (v === 4) return ipv4Privada(ip)
  if (v !== 6) return true
  const x = ip.toLowerCase()
  const mapeada = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x)
  if (mapeada) return ipv4Privada(mapeada[1])
  return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || /^ff/.test(x) || x.startsWith('::ffff:') || x.startsWith('64:ff9b:') || x.startsWith('2001:db8')
}

/** La URL, si es https al puerto por defecto y su host resuelve SOLO a IPs públicas. */
export async function urlPublica(url: string, resolver: Resolver = resolverPorDefecto): Promise<URL | null> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || (u.port !== '' && u.port !== '443') || u.username || u.password) return null
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return null
  if (isIP(host)) return ipPrivada(host) ? null : u
  try {
    const ips = await resolver(host)
    if (ips.length === 0 || ips.some(ipPrivada)) return null
  } catch {
    return null
  }
  return u
}

/**
 * Baja una URL pública con tope de bytes y de tiempo. Las redirecciones se siguen a mano y cada
 * destino se revisa otra vez. `null` si algo no cuadra (nunca lanza).
 */
export async function traerSeguro(
  url: string,
  opts: { fetch?: typeof fetch; resolver?: Resolver; maxBytes: number; timeoutMs?: number; tipo: RegExp },
): Promise<{ url: string; bytes: Buffer; tipo: string } | null> {
  const f = opts.fetch ?? fetch
  let actual = url
  try {
    for (let salto = 0; salto <= MAX_REDIRECCIONES; salto++) {
      const u = await urlPublica(actual, opts.resolver)
      if (!u) return null
      const r = await f(u.toString(), {
        redirect: 'manual',
        headers: { 'User-Agent': AGENTE, Accept: 'text/html,image/avif,image/webp,image/jpeg,image/png,*/*;q=0.5' },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      })
      if (r.status >= 300 && r.status < 400) {
        const destino = r.headers.get('location')
        if (!destino) return null
        actual = new URL(destino, u).toString()
        continue
      }
      if (!r.ok) return null
      const tipo = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      if (!opts.tipo.test(tipo)) return null
      const largo = Number(r.headers.get('content-length') ?? 0)
      if (largo > opts.maxBytes) return null
      const bytes = await leerConTope(r, opts.maxBytes)
      return bytes ? { url: u.toString(), bytes, tipo } : null
    }
    return null
  } catch {
    return null
  }
}

async function leerConTope(r: Response, max: number): Promise<Buffer | null> {
  if (!r.body) {
    const b = Buffer.from(await r.arrayBuffer())
    return b.length > max ? null : b
  }
  const lector = r.body.getReader()
  const partes: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await lector.read()
    if (done) break
    total += value.byteLength
    if (total > max) {
      await lector.cancel().catch(() => {})
      return null
    }
    partes.push(value)
  }
  return Buffer.concat(partes)
}

// ── La página: qué imágenes trae (PURO) ───────────────────────────────────────

function desescapar(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&#x2F;/gi, '/')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

/** Los atributos de una etiqueta HTML («<meta property="og:image" content="…">»). */
function atributos(etiqueta: string): Record<string, string> {
  const salida: Record<string, string> = {}
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>"']+))/g
  let m: RegExpExecArray | null
  while ((m = re.exec(etiqueta))) salida[m[1].toLowerCase()] = desescapar(m[3] ?? m[4] ?? m[5] ?? '')
  return salida
}

/** La URL más ancha de un `srcset` («a.jpg 400w, b.jpg 1600w» → b.jpg). */
export function mayorDeSrcset(srcset: string): string | null {
  let mejor: { url: string; peso: number } | null = null
  for (const parte of srcset.split(/,\s+(?=\S)/)) {
    const [url, medida] = parte.trim().split(/\s+/)
    if (!url) continue
    const n = Number.parseFloat(medida ?? '1')
    const peso = /w$/i.test(medida ?? '') ? n : (Number.isFinite(n) ? n : 1) * 1000
    if (!mejor || peso > mejor.peso) mejor = { url, peso }
  }
  return mejor?.url ?? null
}

/** Lo que no es una foto del lugar: logos, iconos, sellos, pixeles de seguimiento. */
const NO_ES_FOTO = /(^|[\/_.-])(logo|logos|icon|icons|favicon|sprite|avatar|placeholder|blank|pixel|spacer|badge|flag|flags|payment|tripadvisor|booking-logo|loader|loading)([\/_.-]|$)/i

/** Las imágenes JSON-LD (`image`, `photo`, `contentUrl`), en el orden en que aparecen. */
function imagenesDeJsonLd(nodo: unknown, salida: string[], hondura = 0): void {
  if (hondura > 8 || nodo === null || nodo === undefined) return
  if (Array.isArray(nodo)) {
    for (const x of nodo) imagenesDeJsonLd(x, salida, hondura + 1)
    return
  }
  if (typeof nodo !== 'object') return
  for (const [k, v] of Object.entries(nodo as Record<string, unknown>)) {
    if (k === 'image' || k === 'photo' || k === 'contentUrl' || k === 'thumbnailUrl') {
      if (typeof v === 'string') salida.push(v)
      else if (Array.isArray(v)) {
        for (const x of v) {
          if (typeof x === 'string') salida.push(x)
          else imagenesDeJsonLd(x, salida, hondura + 1)
        }
      }
      else imagenesDeJsonLd(v, salida, hondura + 1)
    } else if (k === 'url' && typeof v === 'string' && /\.(jpe?g|png|webp)(\?|$)/i.test(v)) {
      salida.push(v)
    } else if (typeof v === 'object') {
      imagenesDeJsonLd(v, salida, hondura + 1)
    }
  }
}

/**
 * Las imágenes de una página, absolutas y sin repetir: primero las que la página declara como
 * suyas (`og:image`, `twitter:image`, `image_src`, JSON-LD) y luego las `<img>`/`<source>` en
 * orden (la galería). Solo https, sin SVG/GIF ni lo que parece logo o icono. PURO.
 */
export function imagenesDePagina(html: string, base: string): string[] {
  const crudas: string[] = []
  for (const m of html.matchAll(/<meta\b[^>]*>/gi)) {
    const a = atributos(m[0])
    const nombre = (a.property ?? a.name ?? a.itemprop ?? '').toLowerCase()
    if (/^(og:image(:url|:secure_url)?|twitter:image(:src)?|image)$/.test(nombre) && a.content) crudas.push(a.content)
  }
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const a = atributos(m[0])
    if ((a.rel ?? '').toLowerCase() === 'image_src' && a.href) crudas.push(a.href)
  }
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      imagenesDeJsonLd(JSON.parse(m[1]), crudas)
    } catch {
      // JSON-LD roto: se ignora.
    }
  }
  for (const m of html.matchAll(/<(img|source)\b[^>]*>/gi)) {
    const a = atributos(m[0])
    const srcset = a['data-srcset'] ?? a.srcset ?? a['data-lazy-srcset']
    const deSet = srcset ? mayorDeSrcset(srcset) : null
    const src = deSet ?? a['data-src'] ?? a['data-lazy-src'] ?? a['data-original'] ?? a.src
    if (src) crudas.push(src)
  }
  const vistas = new Set<string>()
  const salida: string[] = []
  for (const c of crudas) {
    let u: URL
    try {
      u = new URL(c.trim(), base)
    } catch {
      continue
    }
    if (u.protocol !== 'https:') continue
    u.hash = ''
    if (/\.(svg|gif|ico|bmp)$/i.test(u.pathname) || NO_ES_FOTO.test(u.pathname)) continue
    const s = u.toString()
    if (vistas.has(s)) continue
    vistas.add(s)
    salida.push(s)
    if (salida.length >= MAX_IMAGENES_EN_PAGINA) break
  }
  return salida
}

// ── Las opciones del selector ─────────────────────────────────────────────────

export interface CandidataSitio {
  /** La URL de la imagen (se guarda en `imagen_url` si se elige). */
  imagen: string
  /** La página donde está (se guarda en `fuente_url`). */
  pagina: string
  /** Miniatura para verla en el selector, como data URL. NO se guarda. */
  miniatura: string
  ancho: number
  alto: number
}

type Red = { fetch?: typeof fetch; resolver?: Resolver }

/** La página y sus imágenes. `null` si no se pudo leer. */
export async function leerPagina(paginaUrl: string, red: Red = {}): Promise<{ pagina: string; imagenes: string[] } | null> {
  const r = await traerSeguro(paginaUrl, { ...red, maxBytes: BYTES_MAXIMOS_PAGINA, tipo: /^(text\/html|application\/xhtml\+xml)$/ })
  if (!r) return null
  return { pagina: r.url, imagenes: imagenesDePagina(r.bytes.toString('utf8'), r.url) }
}

/** Una imagen de la página, si es una foto de verdad (tamaño mínimo). */
async function probarImagen(imagen: string, pagina: string, red: Red): Promise<CandidataSitio | null> {
  const r = await traerSeguro(imagen, { ...red, maxBytes: BYTES_MAXIMOS_IMAGEN, timeoutMs: 6000, tipo: /^image\/(jpeg|jpg|png|webp|avif)$/ })
  if (!r) return null
  try {
    const meta = await sharp(r.bytes).metadata()
    if (!meta.width || !meta.height || meta.width < ANCHO_MINIMO_SITIO || meta.height < ALTO_MINIMO_SITIO) return null
    const mini = await sharp(r.bytes).rotate().resize({ width: 400, withoutEnlargement: true }).jpeg({ quality: 70 }).toBuffer()
    return { imagen, pagina, miniatura: `data:image/jpeg;base64,${mini.toString('base64')}`, ancho: meta.width, alto: meta.height }
  } catch {
    return null
  }
}

/**
 * Las opciones de la página oficial, de a `OPCIONES_POR_PAGINA`. `desde` es el índice de la
 * siguiente imagen sin revisar (el «Ver más» lo devuelve como `siguiente`). Las imágenes se bajan
 * de a 4 para no tardar; ninguna se guarda.
 */
export async function opcionesDeSitioOficial(
  paginaUrl: string,
  opts: Red & { desde?: number } = {},
): Promise<{ ok: true; pagina: string; candidatas: CandidataSitio[]; siguiente: number | null } | { ok: false; error: string }> {
  const leida = await leerPagina(paginaUrl, opts)
  if (!leida) return { ok: false, error: 'No se pudo abrir esa página. Revisa que sea https y pública.' }
  const candidatas: CandidataSitio[] = []
  let i = Math.max(0, Math.floor(opts.desde ?? 0))
  while (i < leida.imagenes.length && candidatas.length < OPCIONES_POR_PAGINA) {
    const tanda = leida.imagenes.slice(i, i + 4)
    i += tanda.length
    const probadas = await Promise.all(tanda.map((im) => probarImagen(im, leida.pagina, opts)))
    for (const c of probadas) if (c && candidatas.length < OPCIONES_POR_PAGINA) candidatas.push(c)
  }
  return { ok: true, pagina: leida.pagina, candidatas, siguiente: i < leida.imagenes.length ? i : null }
}

/**
 * La foto elegida, bajada OTRA VEZ en el servidor: la página se vuelve a leer y la imagen tiene que
 * estar en ella (el navegador no puede colar otra URL como «del sitio oficial»).
 */
export async function bajarFotoDeSitio(
  paginaUrl: string,
  imagenUrl: string,
  red: Red = {},
): Promise<{ ok: true; bytes: Buffer; pagina: string; imagen: string } | { ok: false; error: string }> {
  const leida = await leerPagina(paginaUrl, red)
  if (!leida) return { ok: false, error: 'No se pudo abrir la página oficial. Vuelve a intentarlo.' }
  if (!leida.imagenes.includes(imagenUrl)) return { ok: false, error: 'Esa foto ya no está en la página oficial. Vuelve a buscar.' }
  const r = await traerSeguro(imagenUrl, { ...red, maxBytes: BYTES_MAXIMOS_IMAGEN, tipo: /^image\/(jpeg|jpg|png|webp|avif)$/ })
  if (!r) return { ok: false, error: 'No se pudo bajar la foto de la página oficial.' }
  return { ok: true, bytes: r.bytes, pagina: leida.pagina, imagen: imagenUrl }
}

// ── Wikidata: la página oficial de un lugar con nombre y ciudad ───────────────

export const API_WIKIDATA = 'https://www.wikidata.org/w/api.php'

interface EntidadWikidata {
  id: string
  labels?: Record<string, { value?: string }>
  aliases?: Record<string, { value?: string }[]>
  descriptions?: Record<string, { value?: string }>
  claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]>
}

const valoresDe = (e: EntidadWikidata, prop: string): unknown[] =>
  (e.claims?.[prop] ?? []).map((c) => c.mainsnak?.datavalue?.value).filter((v) => v !== undefined)

/** Sin «hotel» suelto ni artículos: «Hotel Catalonia Puerta del Sol» ≈ «Catalonia Puerta del Sol». */
function nombreComparable(s: string): string {
  return nombreLlano(s).split(' ').filter((w) => !['hotel', 'the', 'el', 'la', 'le', 'les', 'los'].includes(w)).join(' ')
}

/** Los lugares (P131) que la entidad nombra; se piden aparte para saber su nombre. */
export function lugaresDe(e: EntidadWikidata): string[] {
  return valoresDe(e, 'P131').map((v) => (v as { id?: string })?.id).filter((x): x is string => typeof x === 'string')
}

/**
 * La página oficial, si UNA sola entidad tiene el mismo nombre (etiqueta o alias), está en la
 * ciudad (su descripción la nombra o su P131 se llama así) y declara sitio web oficial (P856,
 * https). Más de una página distinta, o ninguna: `null` (la persona pega la URL). PURO.
 */
export function paginaConfiable(
  o: { nombre: string; ciudad: string | null },
  entidades: EntidadWikidata[],
  nombreDeLugar: Record<string, string[]>,
): { url: string; entidad: string } | null {
  const buscado = nombreComparable(o.nombre)
  const ciudad = o.ciudad ? nombreLlano(claveDeFoto('ciudad', o.ciudad)) : null
  if (!buscado) return null
  const paginas = new Map<string, string>()
  for (const e of entidades) {
    const nombres = [
      ...Object.values(e.labels ?? {}).map((l) => l.value ?? ''),
      ...Object.values(e.aliases ?? {}).flat().map((a) => a.value ?? ''),
    ].map(nombreComparable)
    if (!nombres.includes(buscado)) continue
    if (ciudad) {
      const descripciones = Object.values(e.descriptions ?? {}).map((d) => nombreLlano(d.value ?? ''))
      const enDescripcion = descripciones.some((d) => ` ${d} `.includes(` ${ciudad} `))
      const enLugar = lugaresDe(e).some((id) => (nombreDeLugar[id] ?? []).map((n) => nombreLlano(n)).includes(ciudad))
      if (!enDescripcion && !enLugar) continue
    }
    const web = valoresDe(e, 'P856').find((v): v is string => typeof v === 'string' && v.startsWith('https://'))
    if (web) paginas.set(web, e.id)
  }
  if (paginas.size !== 1) return null
  const [[url, entidad]] = [...paginas]
  return { url, entidad }
}

async function wikidata(params: Record<string, string>, f: typeof fetch): Promise<unknown> {
  const u = `${API_WIKIDATA}?${new URLSearchParams({ format: 'json', ...params }).toString()}`
  const r = await f(u, { headers: { 'User-Agent': AGENTE, 'Api-User-Agent': AGENTE }, signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`wikidata ${r.status}`)
  return r.json()
}

/** Propone la página oficial desde Wikidata. Nunca lanza; `null` = no hay una confiable. */
export async function paginaOficialDesdeWikidata(
  o: { tipo: TipoFoto; nombre: string; ciudad: string | null },
  opts: { fetch?: typeof fetch } = {},
): Promise<{ url: string; entidad: string } | null> {
  if (o.tipo === 'ciudad') return null
  const f = opts.fetch ?? fetch
  try {
    const busqueda = (await wikidata({ action: 'wbsearchentities', search: o.nombre, language: 'es', uselang: 'es', type: 'item', limit: '7' }, f)) as { search?: { id?: string }[] }
    const ids = (busqueda.search ?? []).map((s) => s.id).filter((x): x is string => typeof x === 'string' && /^Q\d+$/.test(x))
    if (ids.length === 0) return null
    const datos = (await wikidata({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|aliases|descriptions|claims', languages: 'es|en' }, f)) as { entities?: Record<string, EntidadWikidata> }
    const entidades = Object.values(datos.entities ?? {})
    const lugares = [...new Set(entidades.flatMap(lugaresDe))].slice(0, 40)
    const nombreDeLugar: Record<string, string[]> = {}
    if (lugares.length > 0 && o.ciudad) {
      const l = (await wikidata({ action: 'wbgetentities', ids: lugares.join('|'), props: 'labels', languages: 'es|en' }, f)) as { entities?: Record<string, EntidadWikidata> }
      for (const e of Object.values(l.entities ?? {})) nombreDeLugar[e.id] = Object.values(e.labels ?? {}).map((x) => x.value ?? '')
    }
    return paginaConfiable(o, entidades, nombreDeLugar)
  } catch {
    return null
  }
}
