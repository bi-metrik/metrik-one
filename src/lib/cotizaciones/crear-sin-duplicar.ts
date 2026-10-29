/**
 * «Nueva cotización» dos veces seguidas NO crea dos borradores (QA del bloqueo, 2026-10-29).
 *
 * COT-2026-0005 y COT-2026-0006 de Trappvel nacieron con un segundo de diferencia en el mismo
 * negocio: «Nueva cotización» es un enlace a `/cotizacion/nueva`, una página que CREA al
 * renderizarse, y un doble clic (o una segunda navegación) la renderiza dos veces. El enlace ahora se
 * apaga al primer clic, pero el control es del servidor: si este negocio tiene un borrador vacío
 * creado hace menos de `VENTANA_MS`, se devuelve ese en vez de crear otro.
 *
 * Puro: la consulta la hace la acción.
 */

export const VENTANA_MS = 15_000

export interface CotizacionReciente {
  id: string
  estado: string | null
  created_at: string
  valor_total: number | null
}

/** El borrador vacío más reciente creado dentro de la ventana, o `null`. */
export function borradorRecienCreado(filas: readonly CotizacionReciente[], ahoraMs: number, ventanaMs = VENTANA_MS): string | null {
  const candidatas = filas
    .filter(f => f.estado === 'borrador' && !(Number(f.valor_total) > 0))
    .map(f => ({ id: f.id, t: Date.parse(f.created_at) }))
    .filter(f => Number.isFinite(f.t) && ahoraMs - f.t >= 0 && ahoraMs - f.t < ventanaMs)
    .sort((a, b) => b.t - a.t)
  return candidatas[0]?.id ?? null
}
