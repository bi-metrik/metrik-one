/**
 * Lo que las rutas de la bandeja dejan en el log de Vercel (caso Alejandra, N1 26 1, 2026-10-05).
 *
 * Ese día la bandeja dijo «No se pudo agregar la captura» y «No se pudo leer el pantallazo» y en
 * el log no había nada: ni la causa ni la cotización. Desde entonces:
 *
 *  · toda respuesta `ok:false` sale CON `mensaje` (qué pasó y qué hacer) y deja una línea
 *    `[bandeja]` con la ruta, el código, la cotización y el tamaño de la imagen;
 *  · una excepción dentro de la acción ya no sale como la página 500 de Next (que el navegador
 *    no puede leer y convertía en «Inténtalo otra vez»): sale como `ok:false` con código
 *    `ERROR` y su línea en el log con el texto del error.
 *
 * Lo que nunca llega al servidor (la red se cortó antes) lo registra el navegador por
 * `/api/errores-cliente` (`bandeja-red.ts`). Buscar los dos desde la torre:
 *
 *     vercel logs … --query "bandeja"
 */

export type RutaBandeja = 'detectar-captura' | 'leer-captura' | 'aceptar-captura' | 'lectura-manual'

/** Lo que se dice cuando la acción lanzó: no es la captura, es ONE. */
export const MENSAJE_ERROR_SERVIDOR =
  'ONE tuvo un error al procesar esta captura. Sigue aquí: inténtalo de nuevo en un momento; si se repite, avísale a MeTRIK.'

/** Un `ok:false` que llegó sin texto: igual dice qué pasó, con el código para buscarlo. */
export function mensajeDeCodigo(codigo: string | null | undefined): string {
  return `ONE no pudo procesar esta captura (código ${codigo || 'sin código'}). Sigue aquí: inténtalo de nuevo; si se repite, avísale a MeTRIK con ese código.`
}

interface Salida {
  ok: boolean
  codigo?: string
  mensaje?: string
}

/** Lo que pesa la imagen de un data URL, en bytes. */
export function bytesDeImagen(dataUrl: unknown): number | null {
  if (typeof dataUrl !== 'string' || dataUrl === '') return null
  const coma = dataUrl.indexOf(',')
  return Math.floor(((coma >= 0 ? dataUrl.length - coma - 1 : dataUrl.length) * 3) / 4)
}

/** La línea `[bandeja]` del log de Vercel. */
export function registrarEnBandeja(
  nivel: 'warn' | 'error',
  linea: { ruta: RutaBandeja; codigo: string; cotizacionId: string; bytesImagen: number | null; mensaje?: string; error?: string },
): void {
  const texto = JSON.stringify(linea)
  if (nivel === 'error') console.error('[bandeja]', texto)
  else console.warn('[bandeja]', texto)
}

/**
 * Corre la acción de una ruta de la bandeja: nunca lanza, nunca devuelve `ok:false` sin
 * mensaje, y todo `ok:false` queda registrado.
 */
export async function responderBandeja<T extends Salida>(
  ruta: RutaBandeja,
  cotizacionId: string,
  bytesImagen: number | null,
  accion: () => Promise<T>,
): Promise<T | { ok: false; codigo: 'ERROR'; mensaje: string }> {
  let r: T
  try {
    r = await accion()
  } catch (e) {
    registrarEnBandeja('error', {
      ruta, codigo: 'ERROR', cotizacionId, bytesImagen,
      error: e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 500) : String(e).slice(0, 500),
    })
    return { ok: false, codigo: 'ERROR', mensaje: MENSAJE_ERROR_SERVIDOR }
  }
  if (r.ok) return r
  const mensaje = typeof r.mensaje === 'string' && r.mensaje.trim() !== '' ? r.mensaje : mensajeDeCodigo(r.codigo)
  registrarEnBandeja('warn', { ruta, codigo: r.codigo || 'SIN_CODIGO', cotizacionId, bytesImagen, mensaje })
  return mensaje === r.mensaje ? r : { ...r, mensaje }
}
