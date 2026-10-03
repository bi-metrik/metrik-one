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
  /** Cual de las dos pantallas lo mando. */
  origen: z.enum(['app', 'global']).optional(),
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
