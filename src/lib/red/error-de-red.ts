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
 * - Chromium (fetch abortado a medias, visto el 2026-10-03 en Chrome 154 de Mac):
 *                                              `TypeError: network error` (con espacio)
 * - Turbopack / webpack (chunk que no bajo):   `ChunkLoadError`, `Failed to load chunk …`,
 *                                              `Loading chunk 123 failed`, `Loading CSS chunk …`
 * - `import()` nativo que no bajo:             `Importing a module script failed` (WebKit),
 *                                              `error loading dynamically imported module` (Firefox)
 *
 * Solo mira `name` y `message`. Un error de negocio (la accion responde `{ error }`) ni
 * siquiera llega aqui; y un `throw new Error('Negocio no encontrado')` no casa con nada.
 */

const PATRONES_RED = [
  /failed to load chunk/i,
  /loading (css )?chunk/i,
  /load failed/i,
  /failed to fetch/i,
  // `NetworkError` (Firefox) y `network error` (Chromium). Con limites de palabra para no
  // casar con un identificador de la app (`networkErrors is not defined`).
  /\bnetwork ?error\b/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
]

const PATRONES_CHUNK = [
  /failed to load chunk/i,
  /loading (css )?chunk/i,
  /importing a module script failed/i,
  /error loading dynamically imported module/i,
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
  const { message } = nombreYMensaje(error)
  return PATRONES_RED.some((p) => p.test(message))
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

/** Lo que dice la pantalla de error cuando NO recargo sola (o la guarda ya se gasto). */
export interface TextoPantallaDeError {
  titulo: string
  cuerpo: string
}

/** Para un error de red: es la señal, no una pestaña vieja ni un bug. */
export const PANTALLA_SIN_CONEXION: TextoPantallaDeError = {
  titulo: 'Se perdió la conexión',
  cuerpo: 'Revisa la señal y recarga la página.',
}

const CUERPO_PESTANA_VIEJA =
  'Casi siempre es una pestaña que llevaba mucho tiempo abierta. Recargar la deja al día y suele bastar.'

/**
 * Texto de `error.tsx` / `global-error.tsx`. Nacio del log del 2026-10-03: un iPhone con
 * `Load failed` (guarda de 60 s ya gastada) veia "Casi siempre es una pestaña que llevaba
 * mucho tiempo abierta", que era falso. Si fue la red se dice; la "pestaña vieja" queda
 * solo para lo que no es de red. `tituloOtro` es el titulo propio de cada pantalla.
 */
export function textoPantallaDeError(error: unknown, tituloOtro: string): TextoPantallaDeError {
  if (esErrorDeRed(error)) return PANTALLA_SIN_CONEXION
  return { titulo: tituloOtro, cuerpo: CUERPO_PESTANA_VIEJA }
}
