/**
 * La IP y la ubicación de quien hace el pedido, sirva o no Cloudflare de por medio.
 *
 * Desde el 2026-11-04 `soena.metrikone.co` entra por Cloudflare for SaaS (navegador → Cloudflare →
 * Vercel). Vercel trata a Cloudflare como «Verified Proxy Lite» y NO reescribe la IP: en
 * `x-real-ip` / `x-forwarded-for` llega la del PoP de Cloudflare, y en `x-vercel-ip-city` la
 * ciudad de ese PoP (medido en los logs `[red-piloto]` del 2026-11-04: después de las 17:20 UTC
 * todos los pedidos salían AS13335 «Cloudflare, Inc.», Miami, FL, US).
 *
 * La IP real viene en `cf-connecting-ip`, pero esa cabecera la puede poner cualquiera que le
 * pegue directo a Vercel. Por eso solo se cree cuando la IP que VE Vercel (`x-real-ip`, que Vercel
 * sobrescribe y el cliente no controla) está en los rangos publicados de Cloudflare. Si no, se
 * sigue como antes: la IP de Vercel y sus cabeceras de ubicación.
 *
 * Límite conocido: alguien con su propia cuenta de Cloudflare (un Worker) también sale desde esos
 * rangos; Cloudflare no deja que un Worker reescriba `cf-connecting-ip` hacia otra zona, pero esto
 * es una señal de fricción y de medición, no una identidad.
 *
 * Sin dependencias de Node: se puede importar desde cualquier runtime.
 */

export type Via = 'cloudflare' | 'directo'

/**
 * Rangos de Cloudflare. Fuente: https://www.cloudflare.com/ips-v4 y https://www.cloudflare.com/ips-v6
 * (bajados el 2026-11-04; cambian muy rara vez). Si Cloudflare publica un rango nuevo y no está
 * aquí, esos pedidos caen en 'directo' con la IP del PoP: se ve en la columna `via` del resumen.
 */
export const RANGOS_CLOUDFLARE: readonly string[] = [
  '173.245.48.0/20',
  '103.21.244.0/22',
  '103.22.200.0/22',
  '103.31.4.0/22',
  '141.101.64.0/18',
  '108.162.192.0/18',
  '190.93.240.0/20',
  '188.114.96.0/20',
  '197.234.240.0/22',
  '198.41.128.0/17',
  '162.158.0.0/15',
  '104.16.0.0/13',
  '104.24.0.0/14',
  '172.64.0.0/13',
  '131.0.72.0/22',
  '2400:cb00::/32',
  '2606:4700::/32',
  '2803:f800::/32',
  '2405:b500::/32',
  '2405:8100::/32',
  '2a06:98c0::/29',
  '2c0f:f248::/32',
]

/** Una IP como lista de bytes (4 en IPv4, 16 en IPv6). Sin BigInt: el target del repo es ES2017. */
type Bytes = number[]

function ipv4(ip: string): Bytes | null {
  const o = ip.split('.')
  if (o.length !== 4 || o.some((p) => !/^\d{1,3}$/.test(p) || Number(p) > 255)) return null
  return o.map(Number)
}

function ipv6(ip: string): Bytes | null {
  if (ip.includes('.') || ip.split('::').length > 2) return null // IPv4 embebida: no aparece aquí
  const [cabeza, cola] = ip.split('::')
  const a = cabeza ? cabeza.split(':') : []
  const b = cola !== undefined ? (cola ? cola.split(':') : []) : []
  const faltan = 8 - a.length - b.length
  if (faltan < 0 || (cola === undefined && faltan !== 0)) return null
  const grupos = [...a, ...Array<string>(faltan).fill('0'), ...b]
  if (grupos.length !== 8 || grupos.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null
  return grupos.flatMap((g) => {
    const n = parseInt(g, 16)
    return [n >> 8, n & 0xff]
  })
}

/** `"1.2.3.4"` / `"2606:4700::1"` → bytes, o `null` si no es una IP. */
export function leerIp(ip: string | null | undefined): Bytes | null {
  const t = ip?.trim()
  if (!t) return null
  return t.includes(':') ? ipv6(t) : ipv4(t)
}

const RANGOS = RANGOS_CLOUDFLARE.map((r) => {
  const [base, bits] = r.split('/')
  return { bytes: leerIp(base)!, bits: Number(bits) }
})

function enRango(ip: Bytes, rango: { bytes: Bytes; bits: number }): boolean {
  if (ip.length !== rango.bytes.length) return false
  let resto = rango.bits
  for (let i = 0; resto > 0; i++, resto -= 8) {
    const mascara = resto >= 8 ? 0xff : (0xff << (8 - resto)) & 0xff
    if ((ip[i] & mascara) !== (rango.bytes[i] & mascara)) return false
  }
  return true
}

export function esIpDeCloudflare(ip: string | null | undefined): boolean {
  const x = leerIp(ip)
  return !!x && RANGOS.some((r) => enRango(x, r))
}

/** La IP que ve Vercel (la del par TCP): la sobrescribe Vercel, el cliente no la controla. */
function ipVistaPorVercel(headers: Headers): string | null {
  const real = headers.get('x-real-ip')?.trim()
  if (real) return real
  return headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null
}

export interface OrigenDelPedido {
  /** La IP del usuario, o `null` si no se puede saber (nunca la del PoP de Cloudflare). */
  ip: string | null
  via: Via
}

/**
 * La IP del usuario. Por Cloudflare (IP vista en sus rangos) es `cf-connecting-ip` si es una IP
 * válida, y si falta, `null`; directo es la que ve Vercel, como siempre.
 */
export function origenDelPedido(headers: Headers): OrigenDelPedido {
  const vista = ipVistaPorVercel(headers)
  if (esIpDeCloudflare(vista)) {
    const cf = headers.get('cf-connecting-ip')?.trim()
    return { ip: cf && leerIp(cf) ? cf : null, via: 'cloudflare' }
  }
  return { ip: vista, via: 'directo' }
}

/** Atajo para quien solo necesita la IP (topes por IP, constancias). */
export function ipDelCliente(headers: Headers): string | null {
  return origenDelPedido(headers).ip
}

function decodificar(v: string | null, max: number): string | null {
  const t = v?.trim()
  if (!t) return null
  try {
    return decodeURIComponent(t).slice(0, max)
  } catch {
    return t.slice(0, max)
  }
}

export interface Ubicacion {
  ciudad: string | null
  region: string | null
  pais: string | null
}

/**
 * Ciudad, región y país del usuario. Por Cloudflare salen de sus cabeceras de ubicación
 * (`cf-ipcity`, `cf-region-code`/`cf-region`, `cf-ipcountry`), que exigen el Managed Transform
 * «Add visitor location headers» en la zona; si faltan, `null`: NUNCA la ciudad del PoP que pone
 * Vercel. Directo, las `x-vercel-ip-*` de siempre.
 */
export function ubicacionDelPedido(headers: Headers, via: Via = origenDelPedido(headers).via): Ubicacion {
  if (via === 'cloudflare') {
    const pais = headers.get('cf-ipcountry')?.trim().toUpperCase() || null
    return {
      ciudad: decodificar(headers.get('cf-ipcity'), 80),
      region: decodificar(headers.get('cf-region-code') ?? headers.get('cf-region'), 40),
      // XX = desconocido, T1 = Tor (convenciones de Cloudflare).
      pais: pais && pais !== 'XX' && pais !== 'T1' ? pais.slice(0, 4) : null,
    }
  }
  return {
    ciudad: decodificar(headers.get('x-vercel-ip-city'), 80),
    region: headers.get('x-vercel-ip-country-region')?.slice(0, 10) || null,
    pais: headers.get('x-vercel-ip-country')?.slice(0, 4) || null,
  }
}
