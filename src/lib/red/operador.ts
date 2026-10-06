import 'server-only'
import { Resolver } from 'node:dns/promises'
import { isIPv4, isIPv6 } from 'node:net'

/**
 * El operador (sistema autónomo) de quien manda los eventos del piloto de red, SIN guardar la
 * IP: se consulta por DNS al servicio público de Team Cymru (IP → ASN → nombre) y lo único que
 * sale de aquí es el número y el nombre del sistema autónomo («Telmex Colombia S.A.»).
 *
 * Vercel no pone el ASN en las cabeceras de la función (sí lo tiene en sus métricas, como
 * `asn_name`, que es lo que se usó para la línea base). Se resuelve una vez por prefijo y se
 * guarda en memoria de la instancia: con 100 personas son unas decenas de prefijos.
 *
 * Nunca lanza ni demora la respuesta más de `ESPERA_DNS_MS`: sin respuesta, `null`.
 */

export interface Operador {
  asn: number
  nombre: string
  /** Nombre comercial corto (Claro, Movistar, Tigo-UNE…) o el del sistema autónomo. */
  marca: string
}

const ESPERA_DNS_MS = 800
const MAX_CACHE = 2000
const cache = new Map<string, Operador | null>()

/** Marcas por nombre del sistema autónomo (como lo publica el registro regional). */
const MARCAS: ReadonlyArray<[RegExp, string]> = [
  [/telmex|comcel/i, 'Claro'],
  [/colombia telecomunicaciones|telefonica/i, 'Movistar'],
  [/une epm/i, 'Tigo-UNE'],
  [/colombia movil/i, 'Tigo'],
  [/telecomunicaciones de bogota|\betb\b/i, 'ETB'],
  [/partners telecom|wom/i, 'WOM'],
  [/conexion digital express/i, 'Conexión Digital'],
]

export function marcaDeOperador(nombre: string): string {
  for (const [re, marca] of MARCAS) if (re.test(nombre)) return marca
  return nombre.replace(/,\s*[A-Z]{2}$/, '').slice(0, 60)
}

/** La IP del cliente según las cabeceras de Vercel. Solo se usa para la consulta; no se guarda. */
export function ipDelCliente(headers: Headers): string | null {
  const real = headers.get('x-real-ip')?.trim()
  if (real) return real
  const xff = headers.get('x-forwarded-for')?.split(',')[0]?.trim()
  return xff || null
}

/** El nombre DNS de la consulta de origen, y la clave de cache (el prefijo, no la IP). */
export function consultaDeOrigen(ip: string): { nombre: string; clave: string } | null {
  if (isIPv4(ip)) {
    const o = ip.split('.')
    return { nombre: `${o[3]}.${o[2]}.${o[1]}.${o[0]}.origin.asn.cymru.com`, clave: `${o[0]}.${o[1]}.${o[2]}` }
  }
  if (isIPv6(ip)) {
    const completa = expandirIPv6(ip)
    if (!completa) return null
    const nibbles = completa.replace(/:/g, '').split('').reverse().join('.')
    return { nombre: `${nibbles}.origin6.asn.cymru.com`, clave: completa.slice(0, 19) }
  }
  return null
}

function expandirIPv6(ip: string): string | null {
  if (ip.includes('.')) return null // IPv4 embebida: rara en este tráfico, no vale la pena
  const [cabeza, cola] = ip.split('::')
  const a = cabeza ? cabeza.split(':') : []
  const b = cola !== undefined ? (cola ? cola.split(':') : []) : []
  const faltan = 8 - a.length - b.length
  if (faltan < 0 || (cola === undefined && faltan !== 0)) return null
  const grupos = [...a, ...Array(faltan).fill('0'), ...b]
  if (grupos.length !== 8 || grupos.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null
  return grupos.map((g) => g.toLowerCase().padStart(4, '0')).join(':')
}

/** `"14080 | 186.81.102.0/23 | CO | lacnic | 2008-10-28"` → 14080. */
export function asnDeRespuesta(txt: string): number | null {
  const n = Number(txt.split('|')[0]?.trim().split(/\s+/)[0])
  return Number.isInteger(n) && n > 0 ? n : null
}

/**
 * `"14080 | CO | lacnic | 1999-10-15 | AS14080 - Telmex Colombia S.A., CO"` → `"Telmex Colombia S.A., CO"`
 * (formato medido el 2026-10-06 con la IP de Camila).
 */
export function nombreDeRespuesta(txt: string): string | null {
  const partes = txt.split('|')
  const n = partes.slice(4).join('|').trim().replace(/^AS\d+\s*-\s*/i, '')
  return n ? n.slice(0, 120) : null
}

async function conTope<T>(p: Promise<T>): Promise<T | null> {
  let t: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([p, new Promise<null>((r) => { t = setTimeout(() => r(null), ESPERA_DNS_MS) })])
  } catch {
    return null
  } finally {
    if (t) clearTimeout(t)
  }
}

export async function operadorDeIp(ip: string | null): Promise<Operador | null> {
  if (!ip) return null
  const consulta = consultaDeOrigen(ip)
  if (!consulta) return null
  if (cache.has(consulta.clave)) return cache.get(consulta.clave) ?? null

  const resolver = new Resolver({ timeout: ESPERA_DNS_MS, tries: 1 })
  const origen = await conTope(resolver.resolveTxt(consulta.nombre))
  const asn = origen?.[0] ? asnDeRespuesta(origen[0].join('')) : null
  let operador: Operador | null = null
  if (asn) {
    const desc = await conTope(resolver.resolveTxt(`AS${asn}.asn.cymru.com`))
    const nombre = (desc?.[0] && nombreDeRespuesta(desc[0].join(''))) || `AS${asn}`
    operador = { asn, nombre, marca: marcaDeOperador(nombre) }
  }
  // Un fallo de DNS no se guarda: la siguiente petición lo vuelve a intentar.
  if (operador) {
    if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value as string)
    cache.set(consulta.clave, operador)
  }
  return operador
}
