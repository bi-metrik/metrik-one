'use server'

import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { recalcularTotales } from '@/app/(app)/negocios/cotizacion-actions'
import { normalizarCostoManual, type EntradaCostoManual } from '@/lib/cotizaciones/costo-manual'
import { esConfirmado } from '@/lib/cotizaciones/rubros-sugeridos'
import { isEditable, type EstadoCotizacion } from '@/lib/cotizaciones/state-machine'
import { leerTarifaPax, type TarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'

/**
 * El costo escrito a mano de una línea de viaje, en la moneda del proveedor.
 *
 * Brief del 2026-09-22, parte 2. La regla vive en `costo-manual.ts`; aquí se ejecuta.
 *
 * ## Lo que protege, y es lo mismo que `updateItem`
 *
 *  · **Se resuelve contra la base.** El estado de la cotización y los rubros se leen aquí,
 *    no se confían del navegador: una server action exportada es un endpoint alcanzable.
 *  · **Con rubros confirmados no hay costo a mano.** El costo lo mandan ellos (mismo guard
 *    que `updateItem`): escribir `subtotal` ahí dejaría dos costos para la misma línea.
 *  · **Fuera de borrador no se edita.** Regla de Mauricio: si hay cambios, otra cotización.
 *
 * `subtotal` y la anotación de la moneda se escriben en UN solo update: separados, un fallo
 * a mitad dejaría pesos sin explicación o una explicación de otros pesos.
 */
export async function guardarCostoManualEnMoneda(
  itemId: string,
  entrada: EntradaCostoManual,
): Promise<{ success: boolean; error?: string }> {
  const { supabase, userId, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sb = supabase as any
  const { data: item, error: errItem } = await sb
    .from('items')
    .select('*, cotizaciones(estado, negocio_id)')
    .eq('id', itemId)
    .maybeSingle()
  if (errItem) return { success: false, error: errItem.message }
  if (!item) return { success: false, error: 'La línea no existe o no es de este workspace.' }
  if (item.es_ajuste === true) return { success: false, error: 'La línea de cuadre no tiene costo propio.' }
  const cot = (item.cotizaciones ?? {}) as { estado?: string; negocio_id?: string | null }
  if (!isEditable((cot.estado ?? 'borrador') as EstadoCotizacion)) {
    return { success: false, error: 'Esta cotización ya no se edita. Duplícala para trabajar sobre una nueva.' }
  }

  const { data: rubros, error: errRubros } = await sb.from('rubros').select('*').eq('item_id', itemId)
  if (errRubros) return { success: false, error: errRubros.message }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (((rubros ?? []) as any[]).some(esConfirmado)) {
    return { success: false, error: 'Esta línea tiene rubros: su costo sale de ellos, no se escribe a mano.' }
  }

  const limpio = normalizarCostoManual(entrada)
  if (!limpio.ok) return { success: false, error: limpio.motivo }

  let por: string | null = null
  if (limpio.origen) {
    const { data: perfil } = await sb.from('profiles').select('full_name').eq('id', userId).maybeSingle()
    por = (perfil?.full_name as string | null | undefined)?.trim() || null
  }
  // Sobre la tarifa leída con `leerTarifaPax`: toda llave que no se lea ahí se perdería.
  const tarifa: TarifaPax = { ...leerTarifaPax(item.tarifa_pax), actualizadaEn: new Date().toISOString() }
  if (limpio.origen) {
    tarifa.costoManual = { ...limpio.origen, por, porId: userId ?? null, en: new Date().toISOString() }
  } else {
    delete tarifa.costoManual
  }

  const { error: errUpd } = await sb
    .from('items')
    .update({ subtotal: limpio.pesos, tarifa_pax: tarifa })
    .eq('id', itemId)
  if (errUpd) return { success: false, error: errUpd.message }

  await recalcularTotales(item.cotizacion_id as string)
  if (cot.negocio_id) revalidatePath(`/negocios/${cot.negocio_id}`)
  return { success: true }
}
