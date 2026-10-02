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

/** Tope del cuerpo en bytes. Lo demas se rechaza con 413 sin leerlo como JSON. */
export const MAX_BYTES_REPORTE = 8 * 1024
/** Tope del stack que se manda y que se registra (~2 KB). */
export const MAX_STACK = 2000

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
