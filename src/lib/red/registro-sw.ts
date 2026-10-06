import { RUTA_SW_PILOTO } from './piloto'

/**
 * Registra o retira el service worker del piloto de red (`public/sw.js`).
 *
 * - `activo`: lo registra con alcance `/` y `updateViaCache: 'none'`, para que el navegador
 *   revise `sw.js` contra el servidor en cada navegación (así llega el interruptor de apagado).
 * - Inactivo (workspace fuera del piloto, o `SW_PILOTO_ACTIVO = false`): desregistra el que
 *   haya. Es la segunda llave del interruptor; la primera vive en el propio `sw.js`.
 *
 * Nunca lanza: un navegador sin service workers (o en modo privado) sigue como siempre.
 */

type Contenedor = Pick<ServiceWorkerContainer, 'register' | 'getRegistrations'>

export type ResultadoRegistro = 'registrado' | 'desregistrado' | 'nada' | 'sin-soporte' | 'error'

function contenedor(): Contenedor | null {
  try {
    return typeof navigator !== 'undefined' && navigator.serviceWorker ? navigator.serviceWorker : null
  } catch {
    return null
  }
}

function esDelPiloto(r: ServiceWorkerRegistration): boolean {
  const w = r.active ?? r.waiting ?? r.installing
  try {
    return !!w && new URL(w.scriptURL).pathname === RUTA_SW_PILOTO
  } catch {
    return false
  }
}

export async function sincronizarSwPiloto(activo: boolean, sw: Contenedor | null = contenedor()): Promise<ResultadoRegistro> {
  if (!sw) return 'sin-soporte'
  try {
    if (activo) {
      await sw.register(RUTA_SW_PILOTO, { scope: '/', updateViaCache: 'none' })
      return 'registrado'
    }
    const propios = (await sw.getRegistrations()).filter(esDelPiloto)
    if (propios.length === 0) return 'nada'
    await Promise.all(propios.map((r) => r.unregister()))
    return 'desregistrado'
  } catch {
    return 'error'
  }
}
