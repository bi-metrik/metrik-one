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

import { esDeAgenciaDeViajes, MENSAJE_AGENCIA, urlEsDeAgencia } from './agencias'
import { claveDeFoto, nombreLlano, OPCIONES_POR_PAGINA, type TipoFoto } from './clave'
import { esPaginaDeDesafio, fallaPorEstado, MENSAJE_URL_INVALIDA, mensajeDeFalla, motivoVisible, type FallaLectura, type MotivoFallaPagina } from './falla-pagina'
import { AGENTE_COMMONS } from './wikimedia'

export const AGENTE = AGENTE_COMMONS
export const BYTES_MAXIMOS_PAGINA = 3_000_000
export const BYTES_MAXIMOS_IMAGEN = 15_000_000
/** Más chica que esto no sirve para una tarjeta de la propuesta (iconos, logos, miniaturas). */
export const ANCHO_MINIMO_SITIO = 600
export const ALTO_MINIMO_SITIO = 300
/** Una `<img>` que declara menos de esto de ancho es un ícono o una miniatura. */
export const ANCHO_MINIMO_DECLARADO = 400
const MAX_REDIRECCIONES = 3
const MAX_IMAGENES_EN_PAGINA = 120
/** Si la portada trae menos de estas, se prueba la galería (/galeria, /gallery, /fotos). */
export const POCAS_IMAGENES = 6
/** Peticiones extra, como mucho, para buscar la galería; con un tiempo corto cada una. */
export const MAX_SUBPAGINAS = 2
const TIMEOUT_SUBPAGINA_MS = 4000

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

/**
 * La URL revisada: https al puerto por defecto y un host que resuelve SOLO a IPs públicas.
 * `invalida` = no cumple (o resuelve a la red interna); `red` = el DNS no respondió.
 */
async function revisarUrl(url: string, resolver: Resolver = resolverPorDefecto): Promise<{ ok: true; u: URL } | { ok: false; falla: 'invalida' | 'red' }> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { ok: false, falla: 'invalida' }
  }
  if (u.protocol !== 'https:' || (u.port !== '' && u.port !== '443') || u.username || u.password) return { ok: false, falla: 'invalida' }
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (!host || host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) return { ok: false, falla: 'invalida' }
  if (isIP(host)) return ipPrivada(host) ? { ok: false, falla: 'invalida' } : { ok: true, u }
  let ips: string[]
  try {
    ips = await resolver(host)
  } catch {
    return { ok: false, falla: 'red' }
  }
  if (ips.length === 0) return { ok: false, falla: 'red' }
  if (ips.some(ipPrivada)) return { ok: false, falla: 'invalida' }
  return { ok: true, u }
}

/** La URL, si es https al puerto por defecto y su host resuelve SOLO a IPs públicas. */
export async function urlPublica(url: string, resolver: Resolver = resolverPorDefecto): Promise<URL | null> {
  const r = await revisarUrl(url, resolver)
  return r.ok ? r.u : null
}

type OpcionesTraer = { fetch?: typeof fetch; resolver?: Resolver; maxBytes: number; timeoutMs?: number; tipo: RegExp }
export type Traida = { url: string; bytes: Buffer; tipo: string }

/**
 * Baja una URL pública con tope de bytes y de tiempo. Las redirecciones se siguen a mano y cada
 * destino se revisa otra vez. Si algo no cuadra dice POR QUÉ (`FallaLectura`): la página bloquea
 * (401/403/429, muro anti-bots), la red falló (timeout, DNS, 404/5xx), la URL no es pública o lo
 * que llegó no es del tipo pedido. Nunca lanza.
 */
export async function traerConMotivo(url: string, opts: OpcionesTraer): Promise<({ ok: true } & Traida) | { ok: false; falla: FallaLectura }> {
  const f = opts.fetch ?? fetch
  let actual = url
  try {
    for (let salto = 0; salto <= MAX_REDIRECCIONES; salto++) {
      const revisada = await revisarUrl(actual, opts.resolver)
      if (!revisada.ok) return revisada
      const u = revisada.u
      const r = await f(u.toString(), {
        redirect: 'manual',
        headers: { 'User-Agent': AGENTE, Accept: 'text/html,image/avif,image/webp,image/jpeg,image/png,*/*;q=0.5' },
        signal: AbortSignal.timeout(opts.timeoutMs ?? 8000),
      })
      if (r.status >= 300 && r.status < 400) {
        const destino = r.headers.get('location')
        if (!destino) return { ok: false, falla: 'red' }
        actual = new URL(destino, u).toString()
        continue
      }
      if (!r.ok) {
        await r.body?.cancel().catch(() => {})
        return { ok: false, falla: fallaPorEstado(r.status, r.headers) }
      }
      const tipo = (r.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase()
      if (!opts.tipo.test(tipo)) return { ok: false, falla: 'no_es_pagina' }
      const largo = Number(r.headers.get('content-length') ?? 0)
      if (largo > opts.maxBytes) return { ok: false, falla: 'no_es_pagina' }
      const bytes = await leerConTope(r, opts.maxBytes)
      return bytes ? { ok: true, url: u.toString(), bytes, tipo } : { ok: false, falla: 'no_es_pagina' }
    }
    return { ok: false, falla: 'red' }
  } catch {
    // Timeout (AbortSignal), conexión cortada, TLS: la red.
    return { ok: false, falla: 'red' }
  }
}

/** Como `traerConMotivo`, sin el motivo: `null` si algo no cuadra (nunca lanza). */
export async function traerSeguro(url: string, opts: OpcionesTraer): Promise<Traida | null> {
  const r = await traerConMotivo(url, opts)
  return r.ok ? { url: r.url, bytes: r.bytes, tipo: r.tipo } : null
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
  return mayorDeSrcsetConAncho(srcset)?.url ?? null
}

/** La más ancha de un `srcset` y su ancho declarado (`null` si usa densidades «2x»). */
function mayorDeSrcsetConAncho(srcset: string): { url: string; ancho: number | null } | null {
  let mejor: { url: string; peso: number; ancho: number | null } | null = null
  for (const parte of srcset.split(/,\s+(?=\S)/)) {
    const [url, medida] = parte.trim().split(/\s+/)
    if (!url) continue
    const n = Number.parseFloat(medida ?? '1')
    const enW = /w$/i.test(medida ?? '')
    const peso = enW ? n : (Number.isFinite(n) ? n : 1) * 1_000_000
    if (!mejor || peso > mejor.peso) mejor = { url, peso, ancho: enW && Number.isFinite(n) ? n : null }
  }
  return mejor ? { url: mejor.url, ancho: mejor.ancho } : null
}

/** Un ancho o alto declarado en el HTML («600», «600px»); `null` si no se sabe (o es «100%»). */
function medidaDeclarada(v: string | undefined): number | null {
  if (!v) return null
  const m = /^\s*(\d+(?:\.\d+)?)\s*(px)?\s*$/i.exec(v)
  return m ? Number(m[1]) : null
}

/** Las URLs de `background-image: url(…)` de un estilo en línea. */
function fondosDeEstilo(estilo: string): string[] {
  const salida: string[] = []
  for (const m of estilo.matchAll(/background(?:-image)?\s*:[^;]*?url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) salida.push(m[2])
  return salida
}

/** Lo que no es una foto del lugar: logos, iconos, sellos, pixeles de seguimiento. */
const NO_ES_FOTO = /(^|[\/_.-])(logo|logos|logotipo|icon|icons|iconos|favicon|sprite|sprites|avatar|placeholder|blank|pixel|spacer|badge|flag|flags|payment|tripadvisor|booking-logo|loader|loading|apple-touch-icon)([\/_.-]|$)/i
/** Un texto alternativo que dice que la imagen es un logo o un ícono. */
const ALT_NO_FOTO = /\b(logo|logotipo|icon|ícono|icono|sprite)\b/i

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
  // La galería: <img>/<source> (con lazy-load: data-src, data-lazy-src, data-srcset…) y los
  // fondos en línea (style="background-image:url(…)", data-bg) de cualquier etiqueta, en orden.
  for (const m of html.matchAll(/<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g)) {
    const etiqueta = m[1].toLowerCase()
    const cruda = m[0]
    const esImagen = etiqueta === 'img' || etiqueta === 'source'
    if (!esImagen && !/background|data-bg/i.test(cruda)) continue
    const a = atributos(cruda)
    if (esImagen) {
      if (ALT_NO_FOTO.test(a.alt ?? '')) continue
      const srcset = a['data-srcset'] ?? a['data-lazy-srcset'] ?? a.srcset
      const deSet = srcset ? mayorDeSrcsetConAncho(srcset) : null
      // Ancho conocido: el mayor del srcset en «w» o el atributo width. Menos de 400 = ícono.
      const ancho = deSet?.ancho ?? (deSet ? null : medidaDeclarada(a.width))
      const alto = deSet?.ancho ? null : medidaDeclarada(a.height)
      if ((ancho !== null && ancho < ANCHO_MINIMO_DECLARADO) || (alto !== null && alto < ANCHO_MINIMO_DECLARADO / 2)) continue
      const src = deSet?.url ?? a['data-src'] ?? a['data-lazy-src'] ?? a['data-original'] ?? a['data-lazy'] ?? a.src
      if (src && !src.startsWith('data:')) crudas.push(src)
    }
    for (const fondo of [a['data-bg'], a['data-background'], a['data-background-image'], ...fondosDeEstilo(a.style ?? '')]) {
      if (fondo) crudas.push(fondo.replace(/^url\(\s*['"]?|['"]?\s*\)$/g, ''))
    }
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

/**
 * Una búsqueda en la página que no dio opciones. `motivo` (si viene) dice cuál de los tres avisos
 * mostrar (bloqueada, sin fotos, red) y `pagina` es la que la persona puede abrir para copiar la foto.
 */
export type FallaSitio = { ok: false; error: string; motivo?: MotivoFallaPagina; pagina?: string }

const TIPO_PAGINA = /^(text\/html|application\/xhtml\+xml)$/
const SEGMENTO_GALERIA = /^(galeria|galerias|gallery|galleries|photo-gallery|fotos|photos|imagenes|images|media)$/i

/** El último segmento de la ruta, sin barra ni extensión («/es/galeria/» → «galeria»). */
function ultimoSegmento(u: URL): string {
  return (u.pathname.split('/').filter(Boolean).pop() ?? '').replace(/\.[a-z0-9]+$/i, '')
}

/**
 * Las páginas de galería que vale la pena probar cuando la portada trae pocas fotos, hasta
 * `MAX_SUBPAGINAS`, del MISMO host: primero los enlaces de la propia página que apuntan a una
 * galería («/gallery», «/es/galeria/», «/fotos»), y si no alcanzan, las adivinadas colgando de la
 * ruta pegada (`…/galeria`, `…/gallery`, `…/fotos`, por el idioma de la página). PURO.
 */
export function paginasDeGaleria(html: string, base: string): string[] {
  let b: URL
  try {
    b = new URL(base)
  } catch {
    return []
  }
  const propia = (x: URL) => `${x.origin}${x.pathname.replace(/\/+$/, '')}`
  const vistas = new Set<string>([propia(b)])
  const salida: string[] = []
  const sumar = (x: URL) => {
    x.hash = ''
    x.search = ''
    const k = propia(x)
    if (x.protocol !== 'https:' || x.host !== b.host || vistas.has(k) || salida.length >= MAX_SUBPAGINAS) return
    vistas.add(k)
    salida.push(x.toString())
  }
  for (const m of html.matchAll(/<a\b[^>]*>/gi)) {
    const href = atributos(m[0]).href
    if (!href) continue
    try {
      const x = new URL(href, b)
      if (SEGMENTO_GALERIA.test(ultimoSegmento(x))) sumar(x)
    } catch {
      // href roto: se ignora.
    }
  }
  if (SEGMENTO_GALERIA.test(ultimoSegmento(b))) return salida
  const lang = (/<html\b[^>]*\blang\s*=\s*["']?([a-z]{2})/i.exec(html)?.[1] ?? '').toLowerCase()
  const enEspanol = lang === 'es' || /(^|\/)es(-[a-z]{2})?(\/|$)/i.test(b.pathname)
  const adivinadas = enEspanol ? ['galeria', 'fotos', 'gallery'] : ['gallery', 'galeria', 'fotos']
  // Cuelgan de la ruta pegada: «/en/hotels/ctghihh/» → «/en/hotels/ctghihh/gallery».
  const carpeta = /\.[a-z0-9]+$/i.test(b.pathname) ? b.pathname.replace(/[^/]*$/, '') : b.pathname.replace(/\/?$/, '/')
  for (const seg of adivinadas) sumar(new URL(`${carpeta}${seg}`, b))
  return salida
}

/** Lo que salió de leer una página y su galería. */
export type PaginaLeida = { ok: true; pagina: string; imagenes: string[] } | { ok: false; falla: FallaLectura }

/**
 * La página y sus imágenes, o por qué no se pudo (`bloqueada`, `red`, `invalida`…). Una página que
 * llega con 200 pero es un desafío anti-bots (Cloudflare, DataDome) cuenta como `bloqueada`. Si la
 * portada trae menos de `POCAS_IMAGENES`, se prueban hasta `MAX_SUBPAGINAS` páginas de galería con
 * un tiempo corto (lo que fallen se ignora). Las imágenes servidas desde una agencia en línea (el
 * widget de Booking en la página del hotel sirve desde bstatic.com) no se ofrecen nunca.
 */
export async function leerPagina(paginaUrl: string, red: Red = {}): Promise<PaginaLeida> {
  const r = await traerConMotivo(paginaUrl, { ...red, maxBytes: BYTES_MAXIMOS_PAGINA, tipo: TIPO_PAGINA })
  if (!r.ok) return r
  const html = r.bytes.toString('utf8')
  const imagenes = imagenesDePagina(html, r.url).filter((im) => !urlEsDeAgencia(im))
  if (imagenes.length === 0 && esPaginaDeDesafio(html)) return { ok: false, falla: 'bloqueada' }
  if (imagenes.length < POCAS_IMAGENES && !urlEsDeAgencia(r.url)) {
    for (const sub of paginasDeGaleria(html, r.url)) {
      const s = await traerConMotivo(sub, { ...red, maxBytes: BYTES_MAXIMOS_PAGINA, timeoutMs: TIMEOUT_SUBPAGINA_MS, tipo: TIPO_PAGINA })
      if (!s.ok || urlEsDeAgencia(s.url)) continue
      const deSub = s.bytes.toString('utf8')
      for (const im of imagenesDePagina(deSub, s.url)) {
        if (!urlEsDeAgencia(im) && !imagenes.includes(im) && imagenes.length < MAX_IMAGENES_EN_PAGINA) imagenes.push(im)
      }
      if (imagenes.length >= POCAS_IMAGENES) break
    }
  }
  return { ok: true, pagina: r.url, imagenes }
}

/** La respuesta de error de una lectura, con el motivo que ve la persona (`null` = URL inválida). */
function errorDeLectura(f: FallaLectura, pagina: string): { ok: false; error: string; motivo?: MotivoFallaPagina; pagina?: string } {
  const motivo = motivoVisible(f)
  return motivo ? { ok: false, error: mensajeDeFalla(motivo), motivo, pagina } : { ok: false, error: MENSAJE_URL_INVALIDA }
}

/** Una imagen de la página, si es una foto de verdad (tamaño mínimo); `bloqueada` si el sitio la niega. */
async function probarImagen(imagen: string, pagina: string, red: Red): Promise<CandidataSitio | 'bloqueada' | null> {
  const r = await traerConMotivo(imagen, { ...red, maxBytes: BYTES_MAXIMOS_IMAGEN, timeoutMs: 6000, tipo: /^image\/(jpeg|jpg|png|webp|avif)$/ })
  if (!r.ok) return r.falla === 'bloqueada' ? 'bloqueada' : null
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
): Promise<{ ok: true; pagina: string; candidatas: CandidataSitio[]; siguiente: number | null } | FallaSitio> {
  // Booking, Expedia, Despegar y las demás agencias en línea nunca son fuente (Emilio, 2026-10-16),
  // tampoco si la página pegada redirige a una de ellas.
  if (esDeAgenciaDeViajes(paginaUrl)) return { ok: false, error: MENSAJE_AGENCIA }
  const leida = await leerPagina(paginaUrl, opts)
  if (!leida.ok) return errorDeLectura(leida.falla, paginaUrl)
  if (urlEsDeAgencia(leida.pagina)) return { ok: false, error: MENSAJE_AGENCIA }
  const candidatas: CandidataSitio[] = []
  const desde = Math.max(0, Math.floor(opts.desde ?? 0))
  let i = desde
  let negadas = 0
  while (i < leida.imagenes.length && candidatas.length < OPCIONES_POR_PAGINA) {
    const tanda = leida.imagenes.slice(i, i + 4)
    i += tanda.length
    const probadas = await Promise.all(tanda.map((im) => probarImagen(im, leida.pagina, opts)))
    for (const c of probadas) {
      if (c === 'bloqueada') negadas++
      else if (c && candidatas.length < OPCIONES_POR_PAGINA) candidatas.push(c)
    }
  }
  // La página abrió pero el sitio niega TODAS sus fotos al servidor: es el mismo muro.
  if (desde === 0 && candidatas.length === 0 && negadas > 0 && negadas === i) return errorDeLectura('bloqueada', leida.pagina)
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
  if (esDeAgenciaDeViajes(paginaUrl) || urlEsDeAgencia(imagenUrl)) return { ok: false, error: MENSAJE_AGENCIA }
  const leida = await leerPagina(paginaUrl, red)
  if (!leida.ok) return { ok: false, error: 'No se pudo abrir la página oficial. Vuelve a intentarlo.' }
  if (urlEsDeAgencia(leida.pagina)) return { ok: false, error: MENSAJE_AGENCIA }
  if (!leida.imagenes.includes(imagenUrl)) return { ok: false, error: 'Esa foto ya no está en la página oficial. Vuelve a buscar.' }
  const r = await traerSeguro(imagenUrl, { ...red, maxBytes: BYTES_MAXIMOS_IMAGEN, tipo: /^image\/(jpeg|jpg|png|webp|avif)$/ })
  if (!r) return { ok: false, error: 'No se pudo bajar la foto de la página oficial.' }
  return { ok: true, bytes: r.bytes, pagina: leida.pagina, imagen: imagenUrl }
}

/** El lado más largo de una imagen pegada que se devuelve al navegador (luego se comprime allá). */
const LADO_MAXIMO_PEGADA = 2400

/**
 * Una imagen pegada que llegó solo como URL (el `<img src>` del HTML del portapapeles): se baja por
 * `traerConMotivo` (lo público, con topes), se revisa que sea una foto de verdad y se devuelve como
 * data URL JPEG. No se guarda nada. Nunca lanza.
 */
export async function imagenPegadaPorUrl(url: string, red: Red = {}): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  if (urlEsDeAgencia(url) || esDeAgenciaDeViajes(url)) return { ok: false, error: MENSAJE_AGENCIA }
  const r = await traerConMotivo(url, { ...red, maxBytes: BYTES_MAXIMOS_IMAGEN, timeoutMs: 8000, tipo: /^image\/(jpeg|jpg|png|webp|avif)$/ })
  if (!r.ok) {
    if (r.falla === 'bloqueada') return { ok: false, error: 'Esa página no deja traer la imagen. Guárdala en tu equipo (clic derecho › Guardar imagen) y súbela con «Subir la mía».' }
    if (r.falla === 'red') return { ok: false, error: 'No pudimos traer esa imagen. Intenta de nuevo o súbela con «Subir la mía».' }
    return { ok: false, error: 'Lo que pegaste no es una foto. Copia la imagen (clic derecho › Copiar imagen) y pégala otra vez.' }
  }
  try {
    const meta = await sharp(r.bytes).metadata()
    if (!meta.width || !meta.height) return { ok: false, error: 'Lo que pegaste no es una foto.' }
    const jpg = await sharp(r.bytes)
      .rotate()
      .resize({ width: LADO_MAXIMO_PEGADA, height: LADO_MAXIMO_PEGADA, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer()
    return { ok: true, dataUrl: `data:image/jpeg;base64,${jpg.toString('base64')}` }
  } catch {
    return { ok: false, error: 'Lo que pegaste no es una foto.' }
  }
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

/** ¿La entidad tiene el mismo nombre (etiqueta o alias) y está en la ciudad? */
function coincide(
  e: EntidadWikidata,
  buscado: string,
  ciudad: string | null,
  nombreDeLugar: Record<string, string[]>,
): boolean {
  const nombres = [
    ...Object.values(e.labels ?? {}).map((l) => l.value ?? ''),
    ...Object.values(e.aliases ?? {}).flat().map((a) => a.value ?? ''),
  ].map(nombreComparable)
  if (!nombres.includes(buscado)) return false
  if (!ciudad) return true
  const descripciones = Object.values(e.descriptions ?? {}).map((d) => nombreLlano(d.value ?? ''))
  const enDescripcion = descripciones.some((d) => ` ${d} `.includes(` ${ciudad} `))
  const enLugar = lugaresDe(e).some((id) => (nombreDeLugar[id] ?? []).map((n) => nombreLlano(n)).includes(ciudad))
  return enDescripcion || enLugar
}

/** Las entidades que son ESE lugar (mismo nombre, misma ciudad). */
function entidadesQueCoinciden(
  o: { nombre: string; ciudad: string | null },
  entidades: EntidadWikidata[],
  nombreDeLugar: Record<string, string[]>,
): EntidadWikidata[] {
  const buscado = nombreComparable(o.nombre)
  if (!buscado) return []
  const ciudad = o.ciudad ? nombreLlano(claveDeFoto('ciudad', o.ciudad)) : null
  return entidades.filter((e) => coincide(e, buscado, ciudad, nombreDeLugar))
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
  const paginas = new Map<string, string>()
  for (const e of entidadesQueCoinciden(o, entidades, nombreDeLugar)) {
    const web = valoresDe(e, 'P856').find((v): v is string => typeof v === 'string' && v.startsWith('https://'))
    if (web) paginas.set(web, e.id)
  }
  if (paginas.size !== 1) return null
  const [[url, entidad]] = [...paginas]
  return { url, entidad }
}

/**
 * La categoría de Commons del lugar (P373, «Hotel Arts»), con la misma regla: UNA sola entidad con
 * ese nombre en esa ciudad que la declare. Más de una distinta, o ninguna: `null`. PURO.
 */
export function categoriaCommonsConfiable(
  o: { nombre: string; ciudad: string | null },
  entidades: EntidadWikidata[],
  nombreDeLugar: Record<string, string[]>,
): string | null {
  const categorias = new Set<string>()
  for (const e of entidadesQueCoinciden(o, entidades, nombreDeLugar)) {
    const c = valoresDe(e, 'P373').find((v): v is string => typeof v === 'string' && v.trim().length > 0)
    if (c) categorias.add(c.trim())
  }
  return categorias.size === 1 ? [...categorias][0] : null
}

async function wikidata(params: Record<string, string>, f: typeof fetch): Promise<unknown> {
  const u = `${API_WIKIDATA}?${new URLSearchParams({ format: 'json', ...params }).toString()}`
  const r = await f(u, { headers: { 'User-Agent': AGENTE, 'Api-User-Agent': AGENTE }, signal: AbortSignal.timeout(8000) })
  if (!r.ok) throw new Error(`wikidata ${r.status}`)
  return r.json()
}

/** Lo que Wikidata sabe de un hotel o un lugar con ese nombre en esa ciudad. */
export interface DatosWikidata {
  pagina: { url: string; entidad: string } | null
  /** La categoría de Commons (P373), sin «Category:». */
  categoria: string | null
}

/** La página oficial (P856) y la categoría de Commons (P373) desde Wikidata. Nunca lanza. */
export async function datosDesdeWikidata(
  o: { tipo: TipoFoto; nombre: string; ciudad: string | null },
  opts: { fetch?: typeof fetch } = {},
): Promise<DatosWikidata> {
  const nada: DatosWikidata = { pagina: null, categoria: null }
  if (o.tipo === 'ciudad') return nada
  const f = opts.fetch ?? fetch
  try {
    const busqueda = (await wikidata({ action: 'wbsearchentities', search: o.nombre, language: 'es', uselang: 'es', type: 'item', limit: '7' }, f)) as { search?: { id?: string }[] }
    const ids = (busqueda.search ?? []).map((s) => s.id).filter((x): x is string => typeof x === 'string' && /^Q\d+$/.test(x))
    if (ids.length === 0) return nada
    const datos = (await wikidata({ action: 'wbgetentities', ids: ids.join('|'), props: 'labels|aliases|descriptions|claims', languages: 'es|en' }, f)) as { entities?: Record<string, EntidadWikidata> }
    const entidades = Object.values(datos.entities ?? {})
    const lugares = [...new Set(entidades.flatMap(lugaresDe))].slice(0, 40)
    const nombreDeLugar: Record<string, string[]> = {}
    if (lugares.length > 0 && o.ciudad) {
      const l = (await wikidata({ action: 'wbgetentities', ids: lugares.join('|'), props: 'labels', languages: 'es|en' }, f)) as { entities?: Record<string, EntidadWikidata> }
      for (const e of Object.values(l.entities ?? {})) nombreDeLugar[e.id] = Object.values(e.labels ?? {}).map((x) => x.value ?? '')
    }
    return { pagina: paginaConfiable(o, entidades, nombreDeLugar), categoria: categoriaCommonsConfiable(o, entidades, nombreDeLugar) }
  } catch {
    return nada
  }
}

/** Propone la página oficial desde Wikidata. Nunca lanza; `null` = no hay una confiable. */
export async function paginaOficialDesdeWikidata(
  o: { tipo: TipoFoto; nombre: string; ciudad: string | null },
  opts: { fetch?: typeof fetch } = {},
): Promise<{ url: string; entidad: string } | null> {
  return (await datosDesdeWikidata(o, opts)).pagina
}
