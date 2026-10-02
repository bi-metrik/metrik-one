import { esErrorDeRed } from './error-de-red'

/**
 * Guarda anti-bucle de la recarga automatica de las pantallas de error.
 *
 * `error.tsx` y `global-error.tsx` recargan solas cuando lo que rompio fue la red (ver
 * `esErrorDeRed`). Sin guarda, una red que sigue caida —o un chunk que de verdad no
 * existe— recargaria la pagina en bucle. La regla: como mucho UNA recarga por ruta cada
 * `VENTANA_AUTO_RECARGA_MS`. Si ya se gasto, se muestra la pantalla de siempre.
 *
 * Vive en `sessionStorage` (por pestaña, sobrevive a la recarga, muere al cerrarla).
 * Si no se puede leer ni escribir (Safari privado viejo, cuotas, iframes), NO se recarga:
 * sin guarda no hay forma de cortar un bucle.
 */

export const VENTANA_AUTO_RECARGA_MS = 60_000
const PREFIJO = 'metrik:auto-recarga:'

/** Lo minimo de `Storage` que se usa: permite probarlo sin DOM. */
export type AlmacenRecarga = Pick<Storage, 'getItem' | 'setItem'>

/**
 * ¿Se puede recargar esta ruta ahora? Si la respuesta es si, deja la marca ANTES de
 * devolver: quien llama recarga enseguida y la siguiente carga ya la encuentra.
 */
export function reclamarAutoRecarga(
  pathname: string,
  almacen: AlmacenRecarga | null | undefined,
  ahora: number = Date.now(),
): boolean {
  if (!almacen) return false
  const clave = PREFIJO + (pathname || '/')
  try {
    const previa = Number(almacen.getItem(clave))
    if (Number.isFinite(previa) && previa > 0 && ahora - previa < VENTANA_AUTO_RECARGA_MS) {
      return false
    }
    almacen.setItem(clave, String(ahora))
    // Releer: hay navegadores que aceptan el `setItem` sin guardar nada.
    return almacen.getItem(clave) === String(ahora)
  } catch {
    return false
  }
}

/**
 * Lo que llaman las pantallas de error: ¿este error amerita recargar sola, y la guarda lo
 * permite? Si devuelve `true` ya dejo la marca; quien llama debe recargar.
 */
export function intentarAutoRecarga(error: unknown): boolean {
  if (!esErrorDeRed(error)) return false
  if (typeof window === 'undefined') return false
  return reclamarAutoRecarga(window.location.pathname, sessionStorageSeguro())
}

/** `window.sessionStorage`, o `null` si el navegador lo niega (acceder puede lanzar). */
export function sessionStorageSeguro(): AlmacenRecarga | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}
