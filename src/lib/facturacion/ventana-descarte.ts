/**
 * Ventana del descarte provisional de facturación.
 *
 * Vive FUERA de `facturacion-actions.ts` porque ese archivo es `'use server'` y
 * ahí todo export debe ser una función async: exportar una constante desde un
 * módulo de server actions no falla el typecheck, **anula el módulo entero** en
 * el build ("The module has no exports at all"). Ya está documentado en
 * `CLAUDE.md` para funciones puras; una constante rompe igual.
 */

import { todayBogotaISO } from '@/lib/dates/bogota'

/**
 * Herramienta de puesta al día: sacar de la cola los casos ya facturados por
 * fuera o que no se van a facturar. Vence el 31 de agosto de 2026 (decisión de
 * Mauricio, 2026-08-08). Después de esa fecha el barrido deja de estar
 * disponible y cada caso se resuelve por el flujo normal.
 */
export const DESCARTE_FACTURACION_HASTA = '2026-08-31'

/**
 * Se compara en hora de Bogotá, no UTC: entre las 19:00 y la medianoche del 31
 * de agosto, UTC ya está en septiembre y la herramienta se cerraría medio día
 * antes de lo dicho.
 */
export function ventanaDescarteAbierta(): boolean {
  return todayBogotaISO() <= DESCARTE_FACTURACION_HASTA
}
