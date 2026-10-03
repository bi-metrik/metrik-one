import { MAX_STACK } from './limites'

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

/** Un mismo reporte (error, ruta, paso de la recuperacion) se manda una vez por carga. */
const yaReportados = new Set<string>()

type Origen = 'app' | 'global'

/** En que iba la recuperacion automatica de un error de red (ver `auto-recarga.ts`). */
export interface DetalleRecuperacion {
  /** Recargas automaticas ya hechas en la ruta, dentro de la ventana del tope. */
  intento?: number
  /** Lo que se decidio hacer: `ninguna` = no es de red, pantalla de siempre. */
  accion?: 'suave' | 'recarga' | 'esperar-red' | 'agotado' | 'ninguna'
  /** `true` = este reporte cierra un episodio: la pagina se recupero sola. */
  recuperado?: boolean
  /** `navigator.onLine` al decidir. */
  enLinea?: boolean
}

function enviar(cuerpoBase: Record<string, unknown>, clave: string): void {
  if (yaReportados.has(clave)) return
  yaReportados.add(clave)
  const cuerpo = JSON.stringify({
    ...cuerpoBase,
    pathname: window.location.pathname,
    host: window.location.host,
    // El mismo valor que `versionDelBuild()` y que compara `VersionWatcher`: Next
    // inlina `deploymentId` (= VERCEL_DEPLOYMENT_ID) como NEXT_DEPLOYMENT_ID en el
    // bundle del navegador. Es la version del bundle que fallo, no la del servidor.
    version: String(process.env.NEXT_DEPLOYMENT_ID || 'dev'),
    userAgent: navigator.userAgent,
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
}

export function reportarErrorCliente(
  error: Error & { digest?: string },
  origen: Origen,
  autoRecarga = false,
  detalle: DetalleRecuperacion = {},
): void {
  try {
    if (typeof window === 'undefined') return
    const message = String(error?.message ?? '').trim() || String(error)
    const clave = [
      origen,
      window.location.pathname,
      error?.digest ?? '',
      message,
      detalle.accion ?? '',
      detalle.intento ?? '',
    ].join('|')
    enviar(
      {
        message: message.slice(0, 1000),
        name: error?.name,
        digest: error?.digest,
        stack: typeof error?.stack === 'string' ? error.stack.slice(0, MAX_STACK) : undefined,
        origen,
        autoRecarga,
        ...detalle,
      },
      clave,
    )
  } catch {
    // El reporte es lo de menos: la pantalla de error tiene que seguir en pie.
  }
}

/**
 * Cierra el episodio: la pagina se recupero sola tras un error de red. Lleva el mensaje del
 * error ORIGINAL (el endpoint exige `message`) y en que intento se recupero.
 */
export function reportarRecuperacion(p: {
  message: string
  name?: string
  origen: Origen
  intento: number
  accion: 'suave' | 'recarga'
}): void {
  try {
    if (typeof window === 'undefined') return
    enviar(
      {
        message: String(p.message).slice(0, 1000),
        name: p.name,
        origen: p.origen,
        autoRecarga: true,
        intento: p.intento,
        accion: p.accion,
        recuperado: true,
      },
      ['recuperado', p.origen, window.location.pathname, p.intento, p.accion].join('|'),
    )
  } catch {
    // Idem.
  }
}
