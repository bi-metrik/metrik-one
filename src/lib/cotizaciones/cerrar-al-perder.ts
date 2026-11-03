/**
 * H10-3 (QA de punta a punta del 2026-10-29, viaje 10): al perder el negocio, sus cotizaciones
 * abiertas quedaban como estaban —la v1 «enviada» y la v2 «borrador»— y contaban para siempre
 * como enviadas o abiertas en cualquier métrica.
 *
 * Perder el negocio las CIERRA: la enviada y el borrador pasan a `rechazada` (el cliente no
 * tomó ninguna). Es el único estado de cierre que admite volver (`rechazada → enviada`, en
 * `state-machine.ts`) si alguien reabre el negocio; `vencida` es terminal y diría otra cosa (que
 * se venció la validez). La aceptada no se toca: es el precio acordado y el rastro del cierre.
 *
 * No usa estados nuevos: el CHECK de `cotizaciones.estado` no cambia (sin migración).
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** Los estados que se cierran al perder el negocio. */
export const ESTADOS_QUE_SE_CIERRAN_AL_PERDER = ['enviada', 'borrador'] as const

/** Cierra las cotizaciones abiertas del negocio. Devuelve cuántas cerró (0 si falló: no frena el cierre). */
export async function cerrarCotizacionesDelNegocioPerdido(
  db: Db,
  args: { workspaceId: string; negocioId: string },
): Promise<number> {
  const { data, error } = await db
    .from('cotizaciones')
    .update({ estado: 'rechazada' })
    .eq('workspace_id', args.workspaceId)
    .eq('negocio_id', args.negocioId)
    .in('estado', ESTADOS_QUE_SE_CIERRAN_AL_PERDER as unknown as string[])
    .select('id')
  if (error) {
    console.error('[cerrarCotizacionesDelNegocioPerdido] no se pudieron cerrar las cotizaciones:', error.message ?? error)
    return 0
  }
  return Array.isArray(data) ? data.length : 0
}

/** «. Sus 2 cotizaciones abiertas quedaron rechazadas», para ir tras el motivo. Vacío si no cerró ninguna. */
export function textoCotizacionesCerradas(n: number): string {
  if (n <= 0) return ''
  return n === 1 ? '. Su cotización abierta quedó rechazada' : `. Sus ${n} cotizaciones abiertas quedaron rechazadas`
}
