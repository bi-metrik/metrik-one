/**
 * Toda opción en Tarifas (C2), contra la BASE: lee la cotización, pide el plan a
 * `tarifas-por-pasos.ts` (puro) y lo escribe. Solo lo llaman las acciones de la forma por
 * pasos (`por-pasos-actions.ts`), DESPUÉS de comprobar el interruptor.
 *
 * ⚠️ Ningún lector de plata importa este archivo: escribe, no lee el total.
 */

import { calcularCascada } from './totales'
import { contextoDeCotizacion, leerItinerarios, type ContextoCotizacion, type FilaItinerario } from './itinerarios-datos'
import { planDeTarifas, planVacio, type EstadoDeTarifas, type PlanDeTarifas } from './tarifas-por-pasos'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

export interface FotoDeTarifas {
  ctx: ContextoCotizacion
  filas: FilaItinerario[]
  estado: EstadoDeTarifas
  costoDe: (id: string) => number | null
}

/** El costo de cada línea con sus adicionales, de la MISMA cascada que pinta la pantalla. */
function costosDe(ctx: ContextoCotizacion): Map<string, number> {
  return new Map(
    calcularCascada(ctx.items, ctx.params).lineas
      .filter(l => typeof l.id === 'string')
      .map(l => [l.id as string, l.costoLinea + l.costoAdicionales]),
  )
}

/** La cotización y sus tarifas en este instante. `null` si no se puede leer. */
export async function fotoDeTarifas(supabase: Supabase, cotizacionId: string): Promise<FotoDeTarifas | null> {
  // H2 (verificación D) · la cotización y sus tarifas se leen en paralelo: no dependen una de otra.
  const [ctx, filas] = await Promise.all([contextoDeCotizacion(supabase, cotizacionId), leerItinerarios(supabase, cotizacionId)])
  if (!ctx) return null
  if (filas === null) return null
  const costos = costosDe(ctx)
  return {
    ctx,
    filas,
    estado: {
      items: ctx.items,
      tarifas: filas.map(f => ({ id: f.id, nombre: f.nombre, orden: f.orden, vaEnPropuesta: f.vaEnPropuesta, seleccion: f.seleccion })),
    },
    costoDe: id => costos.get(id) ?? null,
  }
}

/**
 * Deja las tarifas como las promete la forma por pasos (`planDeTarifas`) y devuelve el plan
 * escrito. NO recalcula el total: lo hace quien llama, una sola vez al final.
 *
 * @param antes La foto ANTES de la acción, si la acción cambió las opciones de un servicio
 *   (aceptar, mover, separar, juntar, borrar, cambiar el estado). Sin ella, el plan supone que
 *   ningún servicio ganó ni perdió opciones.
 */
export async function sincronizarTarifas(
  supabase: Supabase,
  args: { workspaceId: string; cotizacionId: string; antes?: FotoDeTarifas | null },
): Promise<{ ok: true; plan: PlanDeTarifas; despues: FotoDeTarifas } | { ok: false; error: string }> {
  const despues = await fotoDeTarifas(supabase, args.cotizacionId)
  if (!despues) return { ok: false, error: 'No se pudieron leer las tarifas de la cotización.' }
  const plan = planDeTarifas({
    antes: args.antes?.estado ?? null,
    despues: despues.estado,
    costoDe: despues.costoDe,
    costoAntesDe: args.antes ? (id => args.antes!.costoDe(id) ?? despues.costoDe(id)) : undefined,
  })
  if (planVacio(plan)) return { ok: true, plan, despues }

  for (const n of plan.crear) {
    const { data: fila, error } = await supabase
      .from('cotizacion_itinerarios')
      .insert({
        workspace_id: args.workspaceId,
        cotizacion_id: args.cotizacionId,
        nombre: n.nombre,
        orden: n.orden,
        va_en_propuesta: n.vaEnPropuesta,
        es_principal: false,
      })
      .select('id')
      .single()
    if (error || !fila) return { ok: false, error: error?.message ?? 'No se pudo crear la tarifa.' }
    if (n.seleccion.length > 0) {
      const { error: errSel } = await supabase
        .from('itinerario_opciones')
        .insert(n.seleccion.map(itemId => ({ itinerario_id: (fila as { id: string }).id, item_id: itemId })))
      if (errSel) return { ok: false, error: errSel.message }
    }
  }
  for (const c of plan.seleccion) {
    if (c.quitar.length > 0) {
      const { error } = await supabase
        .from('itinerario_opciones')
        .delete()
        .eq('itinerario_id', c.itinerarioId)
        .in('item_id', c.quitar)
      if (error) return { ok: false, error: error.message }
    }
    if (c.poner.length > 0) {
      const { error } = await supabase
        .from('itinerario_opciones')
        .insert(c.poner.map(itemId => ({ itinerario_id: c.itinerarioId, item_id: itemId })))
      if (error) return { ok: false, error: error.message }
    }
  }
  for (const m of plan.marcas) {
    const { error } = await supabase
      .from('cotizacion_itinerarios')
      .update({ va_en_propuesta: m.vaEnPropuesta })
      .eq('id', m.itinerarioId)
    if (error) return { ok: false, error: error.message }
  }
  return { ok: true, plan, despues }
}
