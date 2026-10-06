import { z } from 'zod'

/**
 * El reporte que mandan `error.tsx` y `global-error.tsx` a `POST /api/errores-cliente`.
 *
 * Existe porque esas dos pantallas ("Algo se rompio en esta pantalla", "MeTRIK one no
 * pudo cargar") solo hacian `console.error` en el navegador del usuario: con Supabase y
 * Vercel casi sin 5xx (2026-10-01/02), no quedaba rastro de QUE habia roto. El endpoint
 * no guarda nada: escribe una linea `[error-cliente]` en los logs de Vercel con nivel
 * error y nada mas.
 *
 * Solo viajan los campos de abajo. Nada de cookies, query string, usuario ni workspace.
 */

// Los topes viven en `limites.ts` (sin Zod) para que el navegador no cargue Zod.
import { MAX_BYTES_REPORTE, MAX_STACK } from './limites'
export { MAX_BYTES_REPORTE, MAX_STACK }

const recortar = (max: number) => z.string().transform((s) => s.slice(0, max))

/**
 * `navigator.connection` (solo Chrome/Android). Un valor raro NO tumba el reporte: el
 * error es lo que importa, la red es contexto. Por eso `.catch(undefined)`.
 */
export const esquemaRed = z
  .object({
    tipo: recortar(10).optional(),
    rtt: z.number().min(0).max(600_000).optional(),
    bajadaMbps: z.number().min(0).max(100_000).optional(),
    ahorroDatos: z.boolean().optional(),
  })
  .optional()
  .catch(undefined)

const esquemaReporte = z.object({
  // Sin `message` no hay nada que diagnosticar: es el filtro minimo contra ruido.
  message: z.string().trim().min(1).transform((s) => s.slice(0, 1000)),
  name: recortar(100).optional(),
  digest: recortar(100).optional(),
  stack: recortar(MAX_STACK).optional(),
  // Solo la ruta: la query string puede traer tokens (enlaces magicos, vinculacion).
  pathname: recortar(300).transform((s) => s.split(/[?#]/)[0]).optional(),
  host: recortar(200).optional(),
  version: recortar(100).optional(),
  userAgent: recortar(400).optional(),
  /**
   * Cual de las dos pantallas lo mando, o `bandeja`: un envio de la bandeja de pantallazos de
   * Trappvel que no llego a ONE (ver `bandeja` abajo).
   */
  origen: z.enum(['app', 'global', 'bandeja']).optional(),
  /**
   * Desde 2026-10-05 (caso Alejandra, N1 26 1): un pantallazo que no llego al servidor no deja
   * rastro en Vercel, porque la peticion nunca entro. La bandeja lo cuenta despues por aqui:
   * que ruta, que paso (`RED` = el fetch lanzo; `RESPUESTA` = volvio algo que no es JSON),
   * de que cotizacion y cuanto pesaba la imagen. `recuperado` = salio en un reintento.
   */
  bandeja: z
    .object({
      ruta: z.enum(['detectar-captura', 'leer-captura', 'aceptar-captura', 'lectura-manual']),
      codigo: recortar(40),
      cotizacionId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
      bytesImagen: z.number().int().min(0).max(100_000_000).optional(),
      intentos: z.number().int().min(1).max(20),
      status: z.number().int().min(0).max(999).optional(),
      ms: z.number().int().min(0).max(3_600_000).optional(),
      recuperado: z.boolean().optional(),
    })
    .optional(),
  /**
   * Si la pantalla se recargo sola (error de red o de chunk, guarda anti-bucle libre).
   * `false` = la persona SI vio "Algo se rompió". Es lo que hay que contar.
   */
  autoRecarga: z.boolean().optional(),
  // Desde 2026-10-03 la recuperacion de un error de red es una escalera (reintento suave,
  // recargas con espera creciente, tope por ruta; ver `lib/red/auto-recarga.ts`). Todo
  // opcional: un bundle viejo que no los manda sigue entrando.
  /** Recargas automaticas ya hechas en la ruta (ventana de 3 min). */
  intento: z.number().int().min(0).max(100).optional(),
  /** Lo que decidio la pantalla: `agotado` = la persona vio "está tardando más de lo normal". */
  accion: z.enum(['suave', 'recarga', 'esperar-red', 'agotado', 'ninguna']).optional(),
  /** `true` = cierre del episodio: la pagina se recupero sola en ese `intento`. */
  recuperado: z.boolean().optional(),
  /** `navigator.onLine` al decidir. */
  enLinea: z.boolean().optional(),
  // Desde 2026-10-05: cola de reenvio y red del navegador. Todo opcional (bundles viejos).
  /**
   * Id del reporte. Un reporte puede llegar dos veces (la cola lo reenvia si no vio la
   * respuesta): al contar en los logs, contar por `id` distinto.
   */
  id: z.string().regex(/^[A-Za-z0-9-]{1,40}$/).optional(),
  /** Cuantas veces salio desde la cola (ausente = primer envio). */
  reenvio: z.number().int().min(1).max(20).optional(),
  /** Segundos entre que se armo el reporte y este reenvio. */
  edadS: z.number().int().min(0).max(7 * 24 * 3600).optional(),
  /** Segundos desde la carga de la pagina hasta el error. */
  segDesdeCarga: z.number().min(0).max(10_000_000).optional(),
  red: esquemaRed,
})

export type ReporteErrorCliente = z.infer<typeof esquemaReporte>

export type ResultadoReporte =
  | { ok: true; reporte: ReporteErrorCliente }
  | { ok: false; status: 400 | 413 }

/**
 * Valida el cuerpo crudo. `contentLength` es la cabecera, si vino: permite rechazar un
 * cuerpo grande sin leerlo; si no vino (chunked), manda el tamano real del texto.
 */
export function leerReporte(cuerpo: string, contentLength?: string | null): ResultadoReporte {
  const declarado = contentLength ? Number(contentLength) : NaN
  if (Number.isFinite(declarado) && declarado > MAX_BYTES_REPORTE) return { ok: false, status: 413 }
  if (new TextEncoder().encode(cuerpo).length > MAX_BYTES_REPORTE) return { ok: false, status: 413 }

  let json: unknown
  try {
    json = JSON.parse(cuerpo)
  } catch {
    return { ok: false, status: 400 }
  }
  const r = esquemaReporte.safeParse(json)
  if (!r.success) return { ok: false, status: 400 }
  return { ok: true, reporte: r.data }
}
