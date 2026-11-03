/**
 * El total contra el que se confirma un viaje: una sola regla para la hoja «El cliente confirmó»
 * (lo que se ve) y para las acciones del servidor (lo que se guarda).
 *
 * - **Con tarifas** (filas de `cotizacion_itinerarios` que iban en la propuesta): el precio de la
 *   escogida, el mismo de `preciosDeLasTarifas` (el que «Aprobar» fija en `precio_aprobado`).
 * - **Sin tarifas** (cotización de una sola opción por componente: el editor no arma tarifas
 *   porque «saldrían idénticas»): una tarifa única implícita cuyo precio es el de
 *   `precioAprobadoDeCotizacion` sobre `valor_total`. Es lo que `aceptarCotizacionNegocio`
 *   escribe en `precio_aprobado`, así que el plan y el negocio no pueden decir cifras distintas,
 *   tampoco con el IVA sobre el ingreso propio encima.
 *
 * Hasta el 2026-10-22 la hoja solo miraba las tarifas: sin filas decía «no tiene tarifas con
 * precio», el total quedaba en 0 y el viaje no se podía confirmar nunca. El servidor ya usaba
 * `valor_total`, pero a secas (sin el IVA que sí fijaba la aprobación).
 */

import { precioAprobadoDeCotizacion, preciosDeLasTarifas } from '@/lib/fiscal/iva-cotizacion-datos'

// Las acciones del viaje usan el cliente sin los tipos del esquema nuevo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

export const SIN_TOTAL = 'La cotización no tiene total.'

/** Cómo se llama en la hoja la tarifa única implícita (no viaja al mensaje del cliente). */
export const TARIFA_UNICA = 'Total de la cotización'

export type TotalSinTarifas =
  | { ok: true; total: number }
  /** `sinTotal`: de verdad no hay cifra (no es un error de lectura ni de IVA). */
  | { ok: false; error: string; sinTotal: boolean }

/** El precio de la tarifa única implícita de una cotización sin tarifas. */
export async function totalSinTarifas(db: Db, args: { workspaceId: string; cotizacionId: string }): Promise<TotalSinTarifas> {
  const { data } = await db
    .from('cotizaciones')
    .select('valor_total')
    .eq('id', args.cotizacionId)
    .eq('workspace_id', args.workspaceId)
    .maybeSingle()
  const valorTotal = Number((data as { valor_total?: number | null } | null)?.valor_total ?? 0)
  if (!(valorTotal > 0)) return { ok: false, error: SIN_TOTAL, sinTotal: true }
  const precio = await precioAprobadoDeCotizacion(db, { workspaceId: args.workspaceId, cotizacionId: args.cotizacionId, valorTotal })
  if (!precio.ok) return { ok: false, error: precio.error, sinTotal: false }
  const total = Number(precio.precio ?? 0)
  return total > 0 ? { ok: true, total } : { ok: false, error: SIN_TOTAL, sinTotal: true }
}

/** El total de la tarifa elegida (`itinerarioId`), o el de la tarifa única si no hay tarifas. */
export async function totalDeTarifa(
  db: Db,
  args: { workspaceId: string; cotizacionId: string; itinerarioId: string | null },
): Promise<{ ok: true; total: number; nombre: string | null } | { ok: false; error: string }> {
  const precios = await preciosDeLasTarifas(db, { workspaceId: args.workspaceId, cotizacionId: args.cotizacionId })
  if (!precios.ok) return { ok: false, error: precios.error }
  if (precios.tarifas.length === 0) {
    const unica = await totalSinTarifas(db, args)
    return unica.ok ? { ok: true, total: unica.total, nombre: null } : { ok: false, error: unica.error }
  }
  const t = args.itinerarioId
    ? precios.tarifas.find((x) => x.itinerarioId === args.itinerarioId)
    : precios.tarifas.find((x) => x.esRecomendada)
  if (!t) return { ok: false, error: 'Esa tarifa no iba en la propuesta.' }
  if (t.precio === null) return { ok: false, error: t.motivo ?? 'No se pudo calcular el precio de esa tarifa.' }
  return { ok: true, total: t.precio, nombre: t.nombre }
}
