/**
 * Por qué una página oficial no dio fotos, y qué se le dice a la persona (Mauricio, 2026-10-16).
 *
 * Muchas webs de cadenas (Hilton, Marriott, Accor) responden 403 o un desafío de Cloudflare /
 * Akamai / DataDome a cualquier lectura automática, y otras arman la galería con JavaScript: el
 * HTML llega sin fotos. Antes la galería se quedaba vacía sin explicar. Ahora se distingue:
 *
 *   · `bloqueada`: 401/403/429, un 503 de un muro anti-bots o una página de desafío/captcha;
 *   · `sin_fotos`: la página cargó pero no trae fotos que sirvan;
 *   · `red`: no respondió a tiempo, el DNS falló, 404/5xx: intentar de nuevo o pegar la foto.
 *
 * En los tres casos la salida es la misma: abrir la página en el navegador de la persona, copiar
 * la foto y pegarla (Ctrl+V), que pasa por la casilla de autorización. PURO (también lo usa el
 * navegador para los textos).
 */

export type MotivoFallaPagina = 'bloqueada' | 'sin_fotos' | 'red'

/** La falla de una lectura, más fina que el motivo que ve la persona. */
export type FallaLectura = MotivoFallaPagina | 'invalida' | 'no_es_pagina'

export const TITULO_FALLA: Record<MotivoFallaPagina, string> = {
  bloqueada: 'Esa página no deja leer sus fotos.',
  sin_fotos: 'No encontramos fotos en esa página.',
  red: 'No pudimos abrir esa página.',
}

export const CONSEJO_FALLA: Record<MotivoFallaPagina, string> = {
  bloqueada: 'Ábrela, haz clic derecho sobre la foto › Copiar imagen y pégala aquí (Ctrl+V).',
  sin_fotos: 'Ábrela, haz clic derecho sobre la foto › Copiar imagen y pégala aquí (Ctrl+V).',
  red: 'Intenta de nuevo o pega la foto aquí (Ctrl+V).',
}

/** El texto completo (para un toast o una prueba). */
export function mensajeDeFalla(m: MotivoFallaPagina): string {
  return `${TITULO_FALLA[m]} ${CONSEJO_FALLA[m]}`
}

export const MENSAJE_URL_INVALIDA = 'No se pudo abrir esa página. Revisa que sea https y pública.'

/** Lo que ve la persona por cada falla de lectura (`null` = mensaje propio, no el aviso). */
export function motivoVisible(f: FallaLectura): MotivoFallaPagina | null {
  if (f === 'invalida') return null
  if (f === 'no_es_pagina') return 'sin_fotos'
  return f
}

/** Encabezados que delatan un muro anti-bots en una respuesta de error. */
function esMuroAntiBots(headers: Headers): boolean {
  if (headers.get('cf-mitigated')) return true
  const server = (headers.get('server') ?? '').toLowerCase()
  if (headers.get('x-datadome') || headers.get('x-px-block') || headers.get('x-iinfo')) return true
  return /cloudflare|akamaighost|ddos-guard|sucuri|imperva/.test(server)
}

/**
 * La falla según el estado HTTP de una respuesta que NO fue 2xx ni 3xx. PURO.
 * 401/403/429 = la página bloquea; 503 con encabezados de muro = también; lo demás = red.
 */
export function fallaPorEstado(status: number, headers: Headers = new Headers()): FallaLectura {
  if (status === 401 || status === 403 || status === 429 || status === 451) return 'bloqueada'
  if ((status === 503 || status === 520 || status === 521) && esMuroAntiBots(headers)) return 'bloqueada'
  return 'red'
}

/** Señales inequívocas de una página de desafío (Cloudflare, Akamai, DataDome, PerimeterX, Incapsula). */
const DESAFIO_INEQUIVOCO = [
  /<title>\s*just a moment\.{0,3}\s*<\/title>/i,
  /<title>\s*attention required!?\s*\|\s*cloudflare\s*<\/title>/i,
  /<title>\s*access denied\s*<\/title>/i,
  /cf-browser-verification|cf_chl_opt|challenges\.cloudflare\.com|\/cdn-cgi\/challenge-platform/i,
  /captcha-delivery\.com|geo\.captcha-delivery/i,
  /px-captcha|perimeterx/i,
  /_incapsula_resource|incapsula incident/i,
  /errors\.edgesuite\.net/i,
]

/**
 * ¿El HTML que llegó con 200 es una página de desafío o captcha y no la del hotel? PURO.
 * «captcha» suelto no basta (un formulario de contacto con reCAPTCHA lo trae): solo cuenta en una
 * página corta y sin imágenes.
 */
export function esPaginaDeDesafio(html: string): boolean {
  const cabeza = html.slice(0, 60_000)
  if (DESAFIO_INEQUIVOCO.some((re) => re.test(cabeza))) return true
  const corta = html.length < 20_000
  return corta && /captcha|verify you are (a )?human|are you a robot|comprueba que eres humano/i.test(cabeza) && !/<img\b/i.test(cabeza)
}

