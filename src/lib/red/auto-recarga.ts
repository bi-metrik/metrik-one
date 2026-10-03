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

function claveDe(pathname: string): string {
  return PREFIJO + (pathname || '/')
}

/** ¿Hay una marca de menos de `VENTANA_AUTO_RECARGA_MS` en esta clave? Solo lee. */
function marcaVigente(almacen: AlmacenRecarga, clave: string, ahora: number): boolean {
  const previa = Number(almacen.getItem(clave))
  return Number.isFinite(previa) && previa > 0 && ahora - previa < VENTANA_AUTO_RECARGA_MS
}

/**
 * ¿Se puede recargar esta ruta ahora? Si la respuesta es si, deja la marca ANTES de
 * devolver: quien llama recarga enseguida y la siguiente carga ya la encuentra.
 *
 * ESCRIBE: solo se llama desde un `useEffect`, nunca al renderizar (ver `intentarAutoRecarga`).
 */
export function reclamarAutoRecarga(
  pathname: string,
  almacen: AlmacenRecarga | null | undefined,
  ahora: number = Date.now(),
): boolean {
  if (!almacen) return false
  const clave = claveDe(pathname)
  try {
    if (marcaVigente(almacen, clave, ahora)) return false
    almacen.setItem(clave, String(ahora))
    // Releer: hay navegadores que aceptan el `setItem` sin guardar nada.
    return almacen.getItem(clave) === String(ahora)
  } catch {
    return false
  }
}

/**
 * Lo mismo que `reclamarAutoRecarga` pero SIN escribir: ¿la guarda dejaria recargar ahora?
 * Es lo que puede consultar el render. Un `true` aqui no garantiza el reclamo (el `setItem`
 * puede fallar despues); lo garantiza solo `reclamarAutoRecarga`.
 */
export function consultarAutoRecarga(
  pathname: string,
  almacen: AlmacenRecarga | null | undefined,
  ahora: number = Date.now(),
): boolean {
  if (!almacen) return false
  try {
    return !marcaVigente(almacen, claveDe(pathname), ahora)
  } catch {
    return false
  }
}

/**
 * Lo que consulta el RENDER de las pantallas de error: ¿este error amerita recargar sola, y
 * la guarda lo permitiria? No escribe nada: decide si se pinta "Recargando…" mientras corre
 * el efecto. Lo que de verdad recarga es `intentarAutoRecarga`, en el `useEffect`.
 */
export function puedeAutoRecargar(error: unknown): boolean {
  if (!esErrorDeRed(error)) return false
  if (typeof window === 'undefined') return false
  return consultarAutoRecarga(window.location.pathname, sessionStorageSeguro())
}

/**
 * Lo que llama el `useEffect` de las pantallas de error: ¿este error amerita recargar sola,
 * y la guarda lo permite? Si devuelve `true` ya dejo la marca; quien llama debe recargar.
 *
 * NUNCA desde el render (ni desde un inicializador de `useState`). Paso el 2026-10-03: React
 * renderiza el boundary DOS veces cuando el error sale de un render concurrente (lo descarta
 * y lo reintenta en sincrono antes de pintar; con `loading.tsx` toda ruta hace streaming,
 * asi que es el caso de siempre). El primer render, descartado, gastaba la marca sin llegar
 * a su efecto; el que quedaba en pantalla la encontraba gastada y decia `false`: nunca
 * recargo y todos los beacons salian `autoRecarga:false`.
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
