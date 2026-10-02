import { MAX_STACK } from './reporte'

/**
 * Manda el error que pinto `error.tsx` / `global-error.tsx` a `/api/errores-cliente`.
 *
 * NUNCA lanza y NUNCA espera: corre en la pantalla de error, y un reporte que fallara
 * no puede convertirse en un segundo error. `sendBeacon` primero (sobrevive a que la
 * persona pulse "Recargar" enseguida); si no existe o rechaza, `fetch` con `keepalive`.
 *
 * El cuerpo va como `text/plain`: es un tipo "simple" para `sendBeacon`, asi que no hay
 * preflight ni navegadores que rechacen el Blob. El endpoint lo parsea igual.
 */

/** Un mismo error en la misma ruta se reporta una vez por carga de la pagina. */
const yaReportados = new Set<string>()

export function reportarErrorCliente(
  error: Error & { digest?: string },
  origen: 'app' | 'global',
  autoRecarga = false,
): void {
  try {
    if (typeof window === 'undefined') return
    const pathname = window.location.pathname
    const message = String(error?.message ?? '').trim() || String(error)
    const clave = `${origen}|${pathname}|${error?.digest ?? ''}|${message}`
    if (yaReportados.has(clave)) return
    yaReportados.add(clave)

    const cuerpo = JSON.stringify({
      message: message.slice(0, 1000),
      name: error?.name,
      digest: error?.digest,
      stack: typeof error?.stack === 'string' ? error.stack.slice(0, MAX_STACK) : undefined,
      pathname,
      host: window.location.host,
      // El mismo valor que `versionDelBuild()` y que compara `VersionWatcher`: Next
      // inlina `deploymentId` (= VERCEL_DEPLOYMENT_ID) como NEXT_DEPLOYMENT_ID en el
      // bundle del navegador. Es la version del bundle que fallo, no la del servidor.
      version: String(process.env.NEXT_DEPLOYMENT_ID || 'dev'),
      userAgent: navigator.userAgent,
      origen,
      autoRecarga,
    })

    const url = '/api/errores-cliente'
    const blob = new Blob([cuerpo], { type: 'text/plain;charset=UTF-8' })
    if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, blob)) return
    void fetch(url, {
      method: 'POST',
      body: cuerpo,
      headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
      keepalive: true,
      credentials: 'omit',
    }).catch(() => {})
  } catch {
    // El reporte es lo de menos: la pantalla de error tiene que seguir en pie.
  }
}
