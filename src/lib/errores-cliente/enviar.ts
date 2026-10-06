import { MAX_STACK } from './limites'
import {
  anotarReenvio,
  encolar,
  leerCola,
  localStorageSeguro,
  nuevoId,
  quitarDeCola,
  type Almacen,
} from './cola'
import { leerContextoRed } from '@/lib/red/contexto-red'
import { MENSAJE_REPORTE_AVISO, type CausaAvisoConexion } from '@/lib/red/aviso-conexion'

/**
 * Manda el error que pinto `error.tsx` / `global-error.tsx` a `/api/errores-cliente`.
 *
 * NUNCA lanza y NUNCA espera: corre en la pantalla de error, y un reporte que fallara
 * no puede convertirse en un segundo error.
 *
 * Desde 2026-10-05 el reporte pasa por una bandeja de salida (`cola.ts`): se anota en
 * localStorage, sale por `fetch` con `keepalive` (sobrevive a que la persona pulse
 * "Recargar" enseguida) y se borra de la cola solo cuando el servidor contesta. Antes iba
 * por `sendBeacon`, que dice "encolado" aunque la red lo pierda despues: con la red mala
 * de Claro/Telmex no habia forma de saber que no habia llegado. `sendBeacon` queda solo
 * para navegadores sin `fetch`.
 *
 * El cuerpo va como `text/plain`: es un tipo "simple", sin preflight. El endpoint lo
 * parsea igual. Lleva tambien la red del navegador (`red`, `enLinea`, `segDesdeCarga`).
 */

const URL_REPORTE = '/api/errores-cliente'

/** Ids mandados en esta carga cuya respuesta aun no llega: la cola no los reenvia. */
const enVuelo = new Set<string>()

/**
 * Manda un cuerpo ya armado. Cualquier respuesta HTTP < 500 cuenta como entregado
 * (un 400/413 no cambia por reintentar); sin respuesta o con 5xx, se queda en la cola.
 */
function mandar(cuerpo: Record<string, unknown>, id: string, almacen: Almacen | null): void {
  const texto = JSON.stringify(cuerpo)
  if (typeof fetch !== 'function') {
    try {
      const blob = new Blob([texto], { type: 'text/plain;charset=UTF-8' })
      if (typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(URL_REPORTE, blob)) {
        quitarDeCola(almacen, id, Date.now())
      }
    } catch {
      // Sin fetch ni beacon: queda en la cola.
    }
    return
  }
  enVuelo.add(id)
  void fetch(URL_REPORTE, {
    method: 'POST',
    body: texto,
    headers: { 'Content-Type': 'text/plain;charset=UTF-8' },
    keepalive: true,
    credentials: 'omit',
  })
    .then((res) => {
      if (res.status < 500) quitarDeCola(almacen, id, Date.now())
    })
    .catch(() => {})
    .finally(() => enVuelo.delete(id))
}

/**
 * Reenvia lo que quedo en la cola (de una carga anterior, o de esta si fallo). Lleva
 * `reenvio` (cuantas veces) y `edadS` (segundos desde que se armo). No hace nada sin red.
 */
export function reenviarPendientes(almacen: Almacen | null = localStorageSeguro()): void {
  try {
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return
    const ahora = Date.now()
    for (const e of leerCola(almacen, ahora)) {
      if (enVuelo.has(e.id)) continue
      anotarReenvio(almacen, e.id, ahora)
      mandar(
        { ...e.cuerpo, id: e.id, reenvio: e.reenvios + 1, edadS: Math.max(0, Math.round((ahora - e.creado) / 1000)) },
        e.id,
        almacen,
      )
    }
  } catch {
    // Idem.
  }
}

let colaIniciada = false

/**
 * Vacia la cola unos segundos despues de cargar (no le compite a la pagina por la red) y
 * cada vez que el navegador vuelve `online`. Idempotente: se llama en cada carga completa.
 */
export function iniciarColaDeReenvio(esperaMs = 3000): () => void {
  if (typeof window === 'undefined' || colaIniciada) return () => {}
  colaIniciada = true
  const alVolver = () => reenviarPendientes()
  const t = setTimeout(alVolver, esperaMs)
  window.addEventListener('online', alVolver)
  return () => {
    clearTimeout(t)
    window.removeEventListener('online', alVolver)
    colaIniciada = false
  }
}

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
  const id = nuevoId()
  const cuerpo = {
    // El contexto de red va primero: si el llamador ya midio `enLinea` al decidir, manda el suyo.
    ...leerContextoRed(),
    ...cuerpoBase,
    id,
    pathname: window.location.pathname,
    host: window.location.host,
    // El mismo valor que `versionDelBuild()` y que compara `VersionWatcher`: Next
    // inlina `deploymentId` (= VERCEL_DEPLOYMENT_ID) como NEXT_DEPLOYMENT_ID en el
    // bundle del navegador. Es la version del bundle que fallo, no la del servidor.
    version: String(process.env.NEXT_DEPLOYMENT_ID || 'dev'),
    // Sin `navigator` (Node 20, el de CI) leer `.userAgent` lanzaba, el `catch` del llamador
    // se lo tragaba y el reporte no salía: un dato accesorio no puede tumbar la línea.
    userAgent: typeof navigator === 'undefined' ? undefined : navigator.userAgent,
  }
  const almacen = localStorageSeguro()
  encolar(almacen, { id, creado: Date.now(), reenvios: 0, cuerpo }, Date.now())
  mandar(cuerpo, id, almacen)
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

let avisosDeConexion = 0

/**
 * La persona vio "No pudimos conectar con ONE" (`aviso-conexion.ts`). Una línea por
 * aparición, con la causa: así se cuenta cuántas veces ONE se rindió ante la red. Los avisos
 * que pinta el script en línea (sin hidratar, chunk, espera de ruta) se reportan desde el
 * script; este es el de las pantallas de error con la escalera agotada. NUNCA lanza.
 */
export function reportarAvisoConexion(causa: CausaAvisoConexion): void {
  try {
    if (typeof window === 'undefined') return
    enviar(
      { message: MENSAJE_REPORTE_AVISO, name: 'AvisoConexion', causa },
      ['aviso', ++avisosDeConexion, causa].join('|'),
    )
  } catch {
    // Idem.
  }
}

/** Lo que la bandeja de pantallazos cuenta de un envío que no llegó (ver `reporte.ts`). */
export interface FalloDeBandeja {
  ruta: 'detectar-captura' | 'leer-captura' | 'aceptar-captura' | 'lectura-manual'
  /** `RED` = el fetch lanzó; `RESPUESTA` = volvió algo que no es JSON; `PESADA` = 413. */
  codigo: string
  cotizacionId: string
  bytesImagen?: number
  intentos: number
  status?: number
  ms?: number
  /** `true` = falló y salió en un reintento: nadie lo vio, pero es señal de red. */
  recuperado?: boolean
}

let fallosDeBandeja = 0

/**
 * Deja la línea `[error-cliente]` con `origen: 'bandeja'` en el log de Vercel (caso Alejandra,
 * 2026-10-05: sus pantallazos no llegaron y no quedó rastro). Va por la misma cola que los
 * errores de pantalla: si la red tampoco deja salir este reporte (es pequeño, casi siempre
 * pasa), se reenvía en la siguiente carga o al volver `online`. NUNCA lanza.
 */
export function reportarFalloDeBandeja(f: FalloDeBandeja): void {
  try {
    if (typeof window === 'undefined') return
    enviar(
      {
        message: `Bandeja: ${f.ruta} ${f.codigo}${f.recuperado ? ' (recuperado)' : ''}`,
        name: 'FalloDeBandeja',
        origen: 'bandeja',
        bandeja: f,
      },
      // Cada fallo es una línea: dos pantallazos que fallan juntos son dos.
      ['bandeja', ++fallosDeBandeja, f.ruta, f.codigo].join('|'),
    )
  } catch {
    // El reporte es lo de menos: la bandeja sigue.
  }
}
