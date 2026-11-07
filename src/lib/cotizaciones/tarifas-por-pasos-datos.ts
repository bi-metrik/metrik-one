/**
 * Toda opción en Tarifas (C2), contra la BASE: lee la cotización, pide el plan a
 * `tarifas-por-pasos.ts` (puro) y lo escribe. Solo lo llaman las acciones de la forma por
 * pasos (`por-pasos-actions.ts`), DESPUÉS de comprobar el interruptor.
 *
 * ⚠️ Ningún lector de plata importa este archivo: escribe, no lee el total.
 */

import { calcularCascada } from './totales'
import { contextoDeCotizacion, leerItinerarios, type ContextoCotizacion, type FilaItinerario } from './itinerarios-datos'
import { cascadaDeItinerario, ranurasConAlternativas } from './itinerarios'
import { ranuraDeGrupo } from './ranuras-pantallazo'
import { topeDelPresupuesto } from './presupuesto-del-viaje'
import { planDeTarifas, planVacio, type ClienteDelBloqueo, type EstadoDeTarifas, type PlanDeTarifas } from './tarifas-por-pasos'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

export interface FotoDeTarifas {
  ctx: ContextoCotizacion
  filas: FilaItinerario[]
  estado: EstadoDeTarifas
  costoDe: (id: string) => number | null
  /** Solo en un viaje en bloqueo con paquetes: el total al cliente por paquete y el presupuesto (M-H2-2). */
  bloqueo?: ClienteDelBloqueo
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
  const bloqueo = await clienteDelBloqueo(supabase, ctx)
  return {
    ctx,
    filas,
    estado: {
      items: ctx.items,
      tarifas: filas.map(f => ({ id: f.id, nombre: f.nombre, orden: f.orden, vaEnPropuesta: f.vaEnPropuesta, seleccion: f.seleccion })),
    },
    costoDe: id => costos.get(id) ?? null,
    ...(bloqueo ? { bloqueo } : {}),
  }
}

/**
 * Viaje en bloqueo (M-H2-2): el total al cliente de la tarifa que lleva cada paquete (la cascada del
 * documento, sobre los ítems de esa tarifa) y el tope del presupuesto de la solicitud. Sin ranura de
 * paquetes, `undefined` y ninguna consulta de más. Si la solicitud no se puede leer, sin presupuesto
 * (la Recomendada sale por la regla de antes) y no se frena la acción.
 */
async function clienteDelBloqueo(supabase: Supabase, ctx: ContextoCotizacion): Promise<ClienteDelBloqueo | undefined> {
  const ranura = ranurasConAlternativas(ctx.items).find(r => ranuraDeGrupo(r.grupo)?.slug === 'paquete_detalle')
  if (!ranura) return undefined
  const totales = new Map(
    ranura.candidatos.map(id => {
      const c = cascadaDeItinerario(ctx.items, [id], ctx.params)
      return [id, { venta: c.precioVenta, margenPct: c.margenRealPct }] as const
    }),
  )
  return { totalDe: id => totales.get(id) ?? null, tope: await leerTopeDelPresupuesto(supabase, ctx.negocioId) }
}

async function leerTopeDelPresupuesto(supabase: Supabase, negocioId: string | null): Promise<number | null> {
  if (!negocioId) return null
  const { data, error } = await supabase
    .from('negocio_bloques')
    .select('presupuesto:data->>presupuesto')
    .eq('negocio_id', negocioId)
  if (error) {
    console.warn('[tarifas-por-pasos] no se pudo leer el presupuesto de la solicitud:', (error as { message: string }).message)
    return null
  }
  for (const f of (data ?? []) as { presupuesto: unknown }[]) {
    if (typeof f.presupuesto === 'string' && f.presupuesto.trim() !== '') return topeDelPresupuesto(f.presupuesto)
  }
  return null
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
    bloqueo: { despues: despues.bloqueo, antes: args.antes?.bloqueo },
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
  // Premium ⇄ Intermedia (el hotel que sobra va en medio, `repartoPorPrecio`).
  for (const r of plan.nombres ?? []) {
    const { error } = await supabase
      .from('cotizacion_itinerarios')
      .update({ nombre: r.nombre })
      .eq('id', r.itinerarioId)
    if (error) return { ok: false, error: error.message }
  }
  return { ok: true, plan, despues }
}
