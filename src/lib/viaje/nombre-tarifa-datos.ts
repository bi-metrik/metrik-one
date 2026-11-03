/**
 * Lectura de los nombres útiles de las tarifas de una cotización (QA G14, `nombre-tarifa.ts`).
 * Una sola regla para la hoja «El cliente confirmó» (lo que se ve) y la acción que guarda y manda
 * el mensaje (lo que recibe el cliente).
 */

import { leerItinerarios } from '@/lib/cotizaciones/itinerarios-datos'
import { nombreUtilDeTarifa, type ItemParaNombre } from './nombre-tarifa'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any

/** `itinerarioId` → nombre útil (o `null`: la línea no sale). Si algo no se puede leer, vacío. */
export async function nombresUtilesDeTarifas(db: Db, cotizacionId: string): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>()
  const [filas, itemsRes] = await Promise.all([
    leerItinerarios(db, cotizacionId),
    db.from('items').select('id, tarifa_pax, es_ajuste').eq('cotizacion_id', cotizacionId),
  ])
  const items = ((itemsRes?.data ?? []) as ItemParaNombre[])
  for (const t of filas ?? []) out.set(t.id, nombreUtilDeTarifa(t.nombre, items, t.seleccion))
  return out
}
