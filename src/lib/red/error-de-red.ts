/**
 * ¿Este error es de RED (o de carga de un chunk), y no de la app?
 *
 * Nació del log `[error-cliente]` del 2026-10-02: en iPhone (Safari y Chrome iOS, ambos
 * WebKit) la pantalla "Algo se rompió en esta pantalla" salía por `TypeError: Load
 * failed` y `Failed to load chunk …`, con la version del bundle IGUAL a la del servidor
 * y los chunks respondiendo 200. No era un deploy viejo ni un bug: era la señal del
 * telefono, que se cae al cambiar de antena o al volver la app del fondo. Esos errores
 * se curan reintentando o recargando; un error de la app no.
 *
 * Cada navegador lo dice distinto:
 * - WebKit (Safari, y TODO navegador en iOS):  `TypeError: Load failed`
 * - Chromium:                                  `TypeError: Failed to fetch`
 * - Firefox:                                   `TypeError: NetworkError when attempting…`
 * - Chromium (body/stream de un fetch cortado a medias, visto 12 veces el 2026-10-03 en
 *   Chrome de Mac, /negocios/[id]):            `TypeError: network error` (con espacio)
 * - Firefox (stream RSC cortado a medias, visto el 2026-10-03 en /negocios/[id]):
 *                                              `TypeError: Error in input stream`
 * - WebKit (NSURLError de la conexion, que Safari pasa tal cual al `TypeError`):
 *                                              `The network connection was lost.` (-1005),
 *                                              `The Internet connection appears to be offline.` (-1009)
 * - Chromium, `import()` nativo que no bajo:   `Failed to fetch dynamically imported module: …`
 * - Turbopack / webpack (chunk que no bajo):   `ChunkLoadError`, `Failed to load chunk …`,
 *                                              `Loading chunk 123 failed`, `Loading CSS chunk …`
 * - `import()` nativo que no bajo:             `Importing a module script failed` (WebKit),
 *                                              `error loading dynamically imported module` (Firefox)
 *
 * Solo mira `name` y `message`. Un error de negocio (la accion responde `{ error }`) ni
 * siquiera llega aqui; y un `throw new Error('Negocio no encontrado')` no casa con nada.
 *
 * `net::ERR_…` NO esta: es lo que Chromium escribe en la consola y en DevTools, pero el
 * `TypeError` que ve el JS dice `Failed to fetch` / `network error`, nunca `net::ERR_`.
 *
 * Criterio de los patrones AMBIGUOS (`PATRONES_RED_SOLO_TYPEERROR`): un texto que tambien
 * podria escribir la app o una integracion ("Network error de la API de Siigo", "Error in
 * input stream del PDF") solo cuenta como red si el error es `TypeError`, que es como
 * TODOS los navegadores rechazan un `fetch` o la lectura de su body. Un `throw new
 * Error(...)` de la app con ese texto sigue siendo error de la app. Los patrones que ya
 * estaban antes de este criterio (`Load failed`, `Failed to fetch`) se dejan sin exigir
 * nombre para no cambiar lo que ya recuperaba.
 */

/** Casan con cualquier `name`: son frases que solo dice un navegador o el bundler. */
const PATRONES_RED = [
  /failed to load chunk/i,
  /loading (css )?chunk/i,
  /load failed/i,
  /failed to fetch/i,
  // Firefox, frase completa: no la escribe nadie mas.
  /networkerror when attempting to fetch resource/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
]

/**
 * Casan SOLO si `name === 'TypeError'`: el texto podria venir de la app o de una API
 * (ver el criterio arriba).
 */
const PATRONES_RED_SOLO_TYPEERROR = [
  // `NetworkError` (Firefox, en otras frases) y `network error` (Chromium, body cortado).
  // Con limites de palabra para no casar con un identificador (`networkErrors is not defined`).
  /\bnetwork ?error\b/i,
  // Firefox: el stream (RSC o body de un fetch) se corto a medias.
  /\berror in input stream\b/i,
  // WebKit: NSURLErrorNetworkConnectionLost (-1005) y NSURLErrorNotConnectedToInternet (-1009).
  /\bthe network connection was lost\b/i,
  /\bthe internet connection appears to be offline\b/i,
]

const PATRONES_CHUNK = [
  /failed to load chunk/i,
  /loading (css )?chunk/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
  // Chromium, `import()` nativo que no bajo.
  /failed to fetch dynamically imported module/i,
]

function nombreYMensaje(error: unknown): { name: string; message: string } {
  if (error instanceof Error) return { name: error.name ?? '', message: error.message ?? '' }
  if (error && typeof error === 'object') {
    const e = error as { name?: unknown; message?: unknown }
    return {
      name: typeof e.name === 'string' ? e.name : '',
      message: typeof e.message === 'string' ? e.message : '',
    }
  }
  return { name: '', message: typeof error === 'string' ? error : '' }
}

/** Un chunk de JS/CSS que no bajo. Recargar la pagina lo vuelve a pedir. */
export function esErrorDeCargaDeChunk(error: unknown): boolean {
  const { name, message } = nombreYMensaje(error)
  if (name === 'ChunkLoadError') return true
  return PATRONES_CHUNK.some((p) => p.test(message))
}

/** Cualquier falla de red: un `fetch`/server action que no llego, o un chunk que no bajo. */
export function esErrorDeRed(error: unknown): boolean {
  if (esErrorDeCargaDeChunk(error)) return true
  const { name, message } = nombreYMensaje(error)
  if (PATRONES_RED.some((p) => p.test(message))) return true
  return name === 'TypeError' && PATRONES_RED_SOLO_TYPEERROR.some((p) => p.test(message))
}

/** Lo que ve la persona cuando una accion no alcanzo a llegar al servidor. */
export const MENSAJE_SIN_CONEXION =
  'No hubo conexión con el servidor. Revisa la señal y vuelve a intentarlo.'

/**
 * Texto para una LECTURA que lanzo (no para una respuesta `{ error }`, que trae el suyo):
 * si fue la red se dice; si fue otra cosa, el texto generico de quien llama.
 */
export function mensajeDeFallaDeCarga(error: unknown, porDefecto: string): string {
  return esErrorDeRed(error) ? MENSAJE_SIN_CONEXION : porDefecto
}

/** Lo que dice la pantalla de error cuando ya no sigue intentando sola. */
export interface TextoPantallaDeError {
  titulo: string
  cuerpo: string
}

/**
 * Error de red con el tope de reintentos agotado (`auto-recarga.ts`). No dice "conexión" ni
 * "revisa la señal": el 2026-10-03 se midio que la persona SI tenia internet (la ruta de su
 * ISP hacia Vercel perdia paquetes), y culparla era falso. Dice lo que se sabe.
 */
export const PANTALLA_TARDANDO: TextoPantallaDeError = {
  titulo: 'Esta página está tardando más de lo normal',
  cuerpo: 'Lo intentamos varias veces y todavía no carga. Prueba recargar en un momento.',
}

/**
 * Lo unico que se muestra mientras se espera a que vuelva la red, y SOLO cuando el navegador
 * dice que no hay (`navigator.onLine === false`). Va debajo de la animacion de carga.
 */
export const TEXTO_SIN_INTERNET = 'Sin internet. Seguimos apenas vuelva.'

const CUERPO_PESTANA_VIEJA =
  'Casi siempre es una pestaña que llevaba mucho tiempo abierta. Recargar la deja al día y suele bastar.'

/**
 * Texto de `error.tsx` / `global-error.tsx` cuando ya no intentan solas. Si fue la red:
 * `PANTALLA_TARDANDO` (sin culpar a la señal). La "pestaña vieja" queda solo para lo que no
 * es de red (nacio de un iPhone con `Load failed` que la veia, y era falso). `tituloOtro` es
 * el titulo propio de cada pantalla.
 */
export function textoPantallaDeError(error: unknown, tituloOtro: string): TextoPantallaDeError {
  if (esErrorDeRed(error)) return PANTALLA_TARDANDO
  return { titulo: tituloOtro, cuerpo: CUERPO_PESTANA_VIEJA }
}
