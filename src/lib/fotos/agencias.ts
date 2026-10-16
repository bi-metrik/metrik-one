/**
 * Las agencias de viaje en línea (OTA) NUNCA son fuente de fotos (Emilio, 2026-10-16): Booking,
 * Expedia, Despegar y las demás no autorizan usar sus fotos. Si alguien pega un enlace de una de
 * ellas, se rechaza con `MENSAJE_AGENCIA`; si la página oficial de un hotel trae imágenes servidas
 * desde sus servidores (el widget de reservas de Booking sirve desde bstatic.com), esas no se
 * ofrecen. PURO: lo usan el navegador y el servidor.
 *
 * Se compara el nombre REGISTRABLE del dominio («booking» en www.booking.com, «despegar» en
 * despegar.com.co), no cualquier pedazo: hotels.marriott.com no es hotels.com.
 */

export const MENSAJE_AGENCIA = 'Esa página no nos deja usar sus fotos: pide el kit de medios al hotel o súbela.'

/** Nombres registrables de agencias en línea, metabuscadores y sus servidores de imágenes. */
const AGENCIAS = new Set([
  'booking',
  'bstatic', // imágenes de Booking
  'expedia',
  'trvl-media', // imágenes de Expedia, Hotels.com, Vrbo
  'expedia-cdn',
  'hotels',
  'hoteles',
  'vrbo',
  'despegar',
  'decolar',
  'almundo',
  'trivago',
  'tripadvisor',
  'agoda',
  'airbnb',
  'muscache', // imágenes de Airbnb
  'kayak',
  'priceline',
  'orbitz',
  'travelocity',
  'edreams',
  'atrapalo',
  'hostelworld',
  'trip',
  'ctrip',
  'hotelbeds',
  'lastminute',
  'skyscanner',
  'momondo',
  'hrs',
])

/** Segundos niveles genéricos de un ccTLD («.com.co», «.co.uk»): se saltan para hallar el nombre. */
const SEGUNDO_NIVEL = new Set(['com', 'co', 'net', 'org', 'gob', 'gov', 'edu', 'ac', 'or', 'ne'])

/** El nombre registrable del host: «booking» de secure.booking.com, «despegar» de despegar.com.co. */
export function nombreRegistrable(host: string): string | null {
  const partes = host.toLowerCase().replace(/\.$/, '').split('.').filter(Boolean)
  if (partes.length < 2) return null
  partes.pop()
  if (partes.length >= 2 && SEGUNDO_NIVEL.has(partes[partes.length - 1])) partes.pop()
  return partes[partes.length - 1] ?? null
}

/** ¿Esta URL (una imagen o la página leída tras redirecciones) está en un servidor de una agencia? Solo mira el host. */
export function urlEsDeAgencia(url: string | null | undefined): boolean {
  if (typeof url !== 'string') return false
  try {
    const n = nombreRegistrable(new URL(url).hostname)
    return n !== null && AGENCIAS.has(n)
  } catch {
    return false
  }
}

/**
 * ¿El texto es (o contiene) un enlace de una agencia en línea? Acepta una URL completa o un texto
 * pegado con la URL adentro («mira https://www.booking.com/hotel/…»), y un dominio suelto
 * («booking.com/hotel/…»).
 */
export function esDeAgenciaDeViajes(texto: string | null | undefined): boolean {
  if (typeof texto !== 'string' || !texto.trim()) return false
  // Solo lo que EMPIEZA como enlace (al inicio o tras un espacio): «File:Booking.jpg» dentro de
  // una ruta de Commons no es un dominio.
  const candidatos = [...texto.matchAll(/(?:^|[\s(<"'])((?:https?:\/\/)?(?:[a-z0-9-]+\.)+[a-z]{2,})(?=[\/:?#\s)>"']|$)/gi)].map((m) => m[1])
  return candidatos.some((c) => {
    try {
      const host = new URL(/^https?:\/\//i.test(c) ? c : `https://${c}`).hostname
      const n = nombreRegistrable(host)
      return n !== null && AGENCIAS.has(n)
    } catch {
      return false
    }
  })
}
