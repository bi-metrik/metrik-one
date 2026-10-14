/**
 * Quién puede usar `/api/interno/ensayo-chromium`. Pura, para probarla sin servidor.
 *
 * - **GET en un preview de Vercel:** abierto. Imprime solo el fixture del repo (sin datos de
 *   nadie) y el preview ya está detrás del SSO del team `metrik-one`
 *   (`ssoProtection: all_except_custom_domains`). Es lo que deja medir el arranque en frío
 *   sin iniciar sesión en ONE.
 * - **Todo lo demás** (GET en producción o local, y cualquier POST con HTML propio): solo un
 *   platform admin de MéTRIK. Un HTML arbitrario corre en un navegador del servidor; aunque
 *   la red va cerrada (`peticionPermitida`), no se ofrece a nadie más.
 */
export type AccesoEnsayo = 'abierto' | 'requiere_admin'

export function accesoAlEnsayo(opts: { vercelEnv: string | undefined; metodo: string }): AccesoEnsayo {
  if (opts.vercelEnv === 'preview' && opts.metodo.toUpperCase() === 'GET') return 'abierto'
  return 'requiere_admin'
}

/** Ruta del ensayo: la que el middleware deja pasar sin sesión, solo en un preview. */
export const RUTA_ENSAYO_CHROMIUM = '/api/interno/ensayo-chromium'

/** Tope del HTML que acepta el POST (el fixture con fotos y fuentes pesa ~2,4 MB). */
export const MAX_BYTES_HTML_ENSAYO = 15 * 1024 * 1024
