import { esErrorDeRed } from './error-de-red'

/**
 * Politica de recuperacion de las pantallas de error ante un error de RED o de chunk
 * (`esErrorDeRed`): la pagina se recupera sola y, mientras lo intenta, se ve la animacion
 * de carga, no un aviso de desconexion.
 *
 * Por que reintentar y no avisar (medido 2026-10-03): desde redes de algunos ISP
 * colombianos la ruta hacia Vercel pierde paquetes. 9 de 20 descargas de un chunk estatico
 * fallaron con `Failed to fetch` mientras Cloudflare respondia 20 de 20 en < 0,7 s. La
 * persona SI tiene internet, asi que "Se perdió la conexión, revisa la señal" era falso, y
 * reintentar suele bastar.
 *
 * La escalera, por ruta:
 *   1. Reintento SUAVE (`router.refresh()` + `reset()`), UNO por episodio (ventana): no
 *      baja otra vez toda la pagina, solo lo que fallo. Tambien se anota en `sessionStorage`:
 *      si el `refresh` no logra bajar el payload RSC, Next cae a una navegacion completa del
 *      navegador (`fetchServerResponse` → MPA), o sea, una recarga que no pasa por aqui.
 *      Anotarlo antes impide que cada carga nueva repita ese reintento en bucle.
 *   2. Si vuelve a fallar, recarga completa con espera creciente: `ESPERAS_RECARGA_MS`
 *      (2 s, 5 s, 15 s, 30 s).
 *   3. Tope anti-bucle: `MAX_RECARGAS` recargas por ruta en `VENTANA_RECARGAS_MS` (3 min),
 *      en `sessionStorage` (por pestaña, sobrevive a la recarga). Agotado el tope, la
 *      pantalla tranquila con un boton Recargar.
 *   - Si `navigator.onLine === false` no se recarga a ciegas: se espera el evento `online`.
 *
 * ⚠️ Lo que ESCRIBE (`reclamarRecarga`, `marcarReintentoSuave`, `registrarErrorDeRuta`...)
 * se llama SOLO desde efectos o temporizadores, NUNCA al renderizar. Paso el 2026-10-03
 * (#1002): React renderiza el boundary DOS veces cuando el error sale de un render
 * concurrente (lo descarta y lo reintenta en sincrono); reclamar en el render gastaba la
 * guarda en el render descartado y el que quedaba en pantalla nunca recargaba.
 *
 * Si `sessionStorage` no se puede leer ni escribir (Safari privado viejo, cuotas, iframes),
 * no se intenta nada solo, ni siquiera el reintento suave (puede terminar en recarga, ver
 * arriba): sin guarda no hay forma de cortar un bucle. Queda la pantalla con Recargar.
 */

/** Espera antes de cada recarga completa, segun cuantas van en la ventana. */
export const ESPERAS_RECARGA_MS = [2_000, 5_000, 15_000, 30_000] as const
/** Tope de recargas automaticas por ruta dentro de `VENTANA_RECARGAS_MS`. */
export const MAX_RECARGAS = ESPERAS_RECARGA_MS.length
export const VENTANA_RECARGAS_MS = 3 * 60_000
/** Tiempo sin un error nuevo en la ruta para dar el reintento por bueno. */
export const ESPERA_CONFIRMAR_RECUPERACION_MS = 5_000

const PREFIJO = 'metrik:auto-recarga:'

/** Lo minimo de `Storage` que se usa: permite probarlo sin DOM. */
export type AlmacenRecarga = Pick<Storage, 'getItem' | 'setItem'>

export type AccionRecuperacion = 'suave' | 'recarga' | 'esperar-red' | 'agotado'
export type OrigenPantalla = 'app' | 'global'

export interface PlanRecuperacion {
  accion: AccionRecuperacion
  /** Cuanto esperar antes de ejecutarla (solo `recarga` espera). */
  esperaMs: number
  /** Recargas automaticas YA hechas en esta ruta dentro de la ventana (0 = primera carga). */
  intento: number
}

/** Lo que queda anotado al recargar, para reportar si la carga siguiente se recupero. */
export interface Pendiente {
  accion: 'suave' | 'recarga'
  message: string
  name?: string
  origen: OrigenPantalla
  intento: number
  ts: number
}

interface Estado {
  /** Momento de cada recarga automatica (ms). */
  r: number[]
  /** Momento del reintento suave del episodio. */
  s?: number
  p?: Pendiente
}

function claveDe(pathname: string): string {
  return PREFIJO + (pathname || '/')
}

/**
 * Lee el estado de la ruta. `null` = el almacen no se puede leer (no hay guarda).
 * Tolera la marca de #1002 (un numero suelto) y la basura: nunca bloquea para siempre.
 */
function leerEstado(almacen: AlmacenRecarga | null | undefined, clave: string): Estado | null {
  if (!almacen) return null
  let crudo: string | null
  try {
    crudo = almacen.getItem(clave)
  } catch {
    return null
  }
  if (!crudo) return { r: [] }
  const viejo = Number(crudo)
  if (Number.isFinite(viejo) && viejo > 0) return { r: [viejo] }
  try {
    const v = JSON.parse(crudo) as Partial<Estado>
    const r = Array.isArray(v?.r) ? v.r.filter((n) => typeof n === 'number' && Number.isFinite(n)) : []
    const suave = typeof v?.s === 'number' && Number.isFinite(v.s) ? v.s : undefined
    return { r, s: suave, p: v?.p && typeof v.p === 'object' ? (v.p as Pendiente) : undefined }
  } catch {
    return { r: [] }
  }
}

function escribirEstado(almacen: AlmacenRecarga, clave: string, estado: Estado): boolean {
  const texto = JSON.stringify(estado)
  try {
    almacen.setItem(clave, texto)
    // Releer: hay navegadores que aceptan el `setItem` sin guardar nada.
    return almacen.getItem(clave) === texto
  } catch {
    return false
  }
}

const enVentana = (t: number, ahora: number) => t <= ahora && ahora - t < VENTANA_RECARGAS_MS

function recargasEnVentana(estado: Estado, ahora: number): number[] {
  return estado.r.filter((t) => enVentana(t, ahora))
}

function suaveEnVentana(estado: Estado, ahora: number): boolean {
  return estado.s !== undefined && enVentana(estado.s, ahora)
}

// ---------------------------------------------------------------------------------------
// Estado de ESTA carga de la pagina (memoria del modulo: una recarga lo borra, que es justo
// lo que se quiere). Compartido entre las pantallas de error y el vigia: dice si la ruta
// volvio a fallar despues de un reintento.
// ---------------------------------------------------------------------------------------

/** Errores de red vistos por ruta en esta carga (contador, no hora: un reloj quieto no engaña). */
const erroresPorRuta = new Map<string, number>()

/** ESCRIBE (memoria). Lo llama la pantalla de error cada vez que un error de red la monta. */
export function registrarErrorDeRuta(pathname: string): void {
  erroresPorRuta.set(pathname, (erroresPorRuta.get(pathname) ?? 0) + 1)
}

export function erroresDeRuta(pathname: string): number {
  return erroresPorRuta.get(pathname) ?? 0
}

/** Identidad de esta carga: un temporizador de una carga anterior no debe opinar en esta. */
let carga = {}
export function cargaActual(): object {
  return carga
}

/** Solo para pruebas (simulan una recarga en el mismo proceso): deja el modulo como recien cargado. */
export function olvidarCargaDeLaPagina(): void {
  erroresPorRuta.clear()
  carga = {}
}

// ---------------------------------------------------------------------------------------
// Decision (solo lee) y reclamos (escriben)
// ---------------------------------------------------------------------------------------

/**
 * Que hacer ante este error. Solo LEE. `null` = no es de red: no se recupera solo.
 */
export function planearRecuperacion(p: {
  error: unknown
  pathname: string
  almacen: AlmacenRecarga | null | undefined
  ahora: number
  enLinea: boolean
}): PlanRecuperacion | null {
  if (!esErrorDeRed(p.error)) return null
  const estado = leerEstado(p.almacen, claveDe(p.pathname))
  // Sin almacen no hay guarda: nada automatico (ni el suave, que puede acabar en recarga).
  if (!estado) return { accion: 'agotado', esperaMs: 0, intento: 0 }
  const intento = recargasEnVentana(estado, p.ahora).length
  if (!p.enLinea) return { accion: 'esperar-red', esperaMs: 0, intento }
  if (intento >= MAX_RECARGAS) return { accion: 'agotado', esperaMs: 0, intento }
  if (!suaveEnVentana(estado, p.ahora)) return { accion: 'suave', esperaMs: 0, intento }
  return { accion: 'recarga', esperaMs: ESPERAS_RECARGA_MS[intento], intento }
}

/**
 * Reclama el reintento suave del episodio: lo anota (con lo pendiente, por si el `refresh`
 * termina en navegacion completa) y devuelve `true` solo si quedo GUARDADO.
 *
 * ESCRIBE: solo desde un efecto o temporizador, nunca al renderizar.
 */
export function reclamarSuave(
  pathname: string,
  almacen: AlmacenRecarga | null | undefined,
  ahora: number,
  pendiente: Omit<Pendiente, 'ts' | 'intento' | 'accion'>,
): boolean {
  const clave = claveDe(pathname)
  const estado = leerEstado(almacen, clave)
  if (!almacen || !estado || suaveEnVentana(estado, ahora)) return false
  const r = recargasEnVentana(estado, ahora)
  return escribirEstado(almacen, clave, {
    r,
    s: ahora,
    p: { ...pendiente, accion: 'suave', message: pendiente.message.slice(0, 300), intento: r.length, ts: ahora },
  })
}

/**
 * Reclama una recarga: vuelve a mirar el tope, anota la hora y lo pendiente, y devuelve
 * `true` solo si quedo GUARDADO. Quien llama recarga enseguida.
 *
 * ESCRIBE: solo desde un efecto o temporizador, nunca al renderizar.
 */
export function reclamarRecarga(
  pathname: string,
  almacen: AlmacenRecarga | null | undefined,
  ahora: number,
  pendiente: Omit<Pendiente, 'ts' | 'intento' | 'accion'>,
): boolean {
  const clave = claveDe(pathname)
  const estado = leerEstado(almacen, clave)
  if (!almacen || !estado) return false
  const r = recargasEnVentana(estado, ahora)
  if (r.length >= MAX_RECARGAS) return false
  const nuevo: Estado = {
    r: [...r, ahora],
    s: estado.s,
    p: { ...pendiente, accion: 'recarga', message: pendiente.message.slice(0, 300), intento: r.length + 1, ts: ahora },
  }
  return escribirEstado(almacen, clave, nuevo)
}

/**
 * Si la ruta quedo pendiente de una recarga reciente, la saca y la devuelve (para el beacon
 * de "se recupero"). ESCRIBE: solo desde un efecto o temporizador.
 */
export function tomarPendiente(
  pathname: string,
  almacen: AlmacenRecarga | null | undefined,
  ahora: number,
): Pendiente | null {
  const clave = claveDe(pathname)
  const estado = leerEstado(almacen, clave)
  if (!almacen || !estado?.p) return null
  const p = estado.p
  escribirEstado(almacen, clave, { r: estado.r, s: estado.s })
  if (typeof p.message !== 'string' || !p.message) return null
  if (!(ahora - p.ts < VENTANA_RECARGAS_MS)) return null
  return p
}

/**
 * Borra el historial de la ruta: lo usa el boton Recargar de la pantalla de agotado. Un
 * clic de la persona no es un bucle, y la carga siguiente merece la escalera completa.
 */
export function olvidarRecargas(pathname: string, almacen: AlmacenRecarga | null | undefined): void {
  if (!almacen) return
  try {
    almacen.setItem(claveDe(pathname), JSON.stringify({ r: [] }))
  } catch {
    // Sin almacen no hay historial que borrar.
  }
}

/** `window.sessionStorage`, o `null` si el navegador lo niega (acceder puede lanzar). */
export function sessionStorageSeguro(): AlmacenRecarga | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}

/** `navigator.onLine`, y `true` si no se sabe: ante la duda se reintenta. */
export function enLinea(): boolean {
  try {
    return typeof navigator === 'undefined' || navigator.onLine !== false
  } catch {
    return true
  }
}
