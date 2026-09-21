'use server'

import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { recalcularTotales } from '@/app/(app)/negocios/cotizacion-actions'
import { revalidarItinerarios } from '@/app/(app)/negocios/itinerario-actions'
import {
  faltaLaTablaDeAdicionales,
  normalizarAdicional,
  type EntradaAdicional,
} from '@/lib/cotizaciones/adicionales'

/**
 * Adicionales dentro de una variante: escribir, corregir y borrar.
 *
 * Parte 1 de `proyectos/trappvel/clarity/docs/diseno/adicionales-y-ficha-por-ranura.md`.
 * La decisión —que el adicional cuelga de la VARIANTE y no de la ranura— vive en
 * `src/lib/cotizaciones/adicionales.ts`; aquí solo se ejecuta.
 *
 * ## Las tres cosas que este archivo protege
 *
 * **1 · El ítem se resuelve contra la BASE, nunca contra el navegador.** Una server action
 * exportada es un endpoint alcanzable con cualquier id aunque ningún botón la invoque. El
 * `cotizacion_id` sale de leer la fila, así que un id ajeno no resuelve —RLS acota la
 * lectura al workspace de la sesión— y la función corta antes de escribir.
 *
 * **2 · Esto MUEVE PLATA, así que recalcula.** Un adicional cambia el precio de su
 * variante, el total de toda tarifa que la elija y el margen contra el que decide el gate
 * del piso. Dejar `valor_total` viejo hasta el próximo recálculo sería un total que
 * miente, y peor: una tarifa marcada para propuesta podría quedar bajo el piso y seguir
 * marcada. Por eso, después de cada escritura, `recalcularTotales` **y**
 * `revalidarItinerarios` (§2.6.5: ninguna edición puede dejar un itinerario bajo el piso
 * duro y marcado para propuesta).
 *
 * **3 · La asimetría de despliegue: leer tolera, escribir NO.** Sin la tabla, la lectura
 * devuelve «esta línea no tiene adicionales» —que es el estado de todo lo que existe hoy—
 * pero un insert que se tragara el error dejaría a alguien cargando maletas que no se
 * guardan en ninguna parte, y eso no se ve hasta que recarga. Aquí el error se traduce a
 * una frase que dice qué falta y que la cotización sigue funcionando.
 *
 * ⚠️ `origen` NO es parámetro de ninguna de estas funciones: se escribe `'manual'` por
 * construcción. Ver la nota de `Adicional.origen` — un valor que se puede pasar por
 * parámetro se pasa, y el día que se mida cuántos adicionales llegaron leídos de un
 * pantallazo, la cifra estaría midiendo a quien llamó y no al lector.
 */

const SIN_TABLA =
  'Los adicionales todavía no están disponibles en esta base: falta aplicar la migración ' +
  '2026-09-21_adicionales-PENDIENTE.sql. La cotización y su precio funcionan igual.'

/** Traduce el error de la tabla ausente; devuelve `null` si el error es otro. */
function mensajeDeTablaAusente(error: { code?: string | null; message?: string | null }): string | null {
  return faltaLaTablaDeAdicionales(error) ? SIN_TABLA : null
}

/**
 * La línea a la que se le cuelga el adicional, leída de la base.
 *
 * Devuelve también su cotización, que es lo que hace falta para recalcular. El ítem de
 * CUADRE se rechaza: es ajuste de precio, no un componente del viaje, y colgarle una
 * maleta dejaría al cuadre cuadrando contra sí mismo.
 */
async function resolverItem(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any,
  itemId: string,
): Promise<{ ok: true; cotizacionId: string } | { ok: false; error: string }> {
  const { data, error } = await supabase
    .from('items')
    .select('id, cotizacion_id, es_ajuste')
    .eq('id', itemId)
    .maybeSingle()
  if (error) return { ok: false, error: error.message }
  if (!data) return { ok: false, error: 'La línea no existe o no es de este workspace.' }
  if (data.es_ajuste === true) {
    return { ok: false, error: 'La línea de cuadre no admite adicionales: es ajuste de precio, no un componente del viaje.' }
  }
  return { ok: true, cotizacionId: data.cotizacion_id as string }
}

/**
 * Rehace los números y suelta las tarifas que quedaron bajo el piso.
 *
 * Se llama después de TODA escritura, incluida la de borrado: quitar una maleta que se
 * vendía con margen puede dejar la tarifa por debajo igual que agregarla.
 */
async function recalcularYRevalidar(cotizacionId: string, negocioId: string | null) {
  await recalcularTotales(cotizacionId)
  const { desmarcados } = await revalidarItinerarios(cotizacionId)
  if (negocioId) revalidatePath(`/negocios/${negocioId}`)
  return desmarcados
}

/** El negocio de una cotización, para revalidar su ruta. `null` si no cuelga de uno. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function negocioDe(supabase: any, cotizacionId: string): Promise<string | null> {
  const { data } = await supabase
    .from('cotizaciones')
    .select('negocio_id')
    .eq('id', cotizacionId)
    .maybeSingle()
  return (data?.negocio_id ?? null) as string | null
}

/**
 * Agrega un adicional a UNA variante.
 *
 * Nace al final de la lista de esa variante. El orden importa poco para el dinero y mucho
 * para el documento: sin uno estable, el PDF lista los adicionales distinto en cada render.
 */
export async function agregarAdicional(itemId: string, entrada: EntradaAdicional) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const item = await resolverItem(supabase, itemId)
  if (!item.ok) return { success: false, error: item.error }

  const limpio = normalizarAdicional(entrada)
  if (!limpio.ok) return { success: false, error: limpio.motivo }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ultimo } = await (supabase as any)
    .from('item_adicionales')
    .select('orden')
    .eq('item_id', itemId)
    .order('orden', { ascending: false })
    .limit(1)
  const orden = ((ultimo?.[0]?.orden as number | undefined) ?? 0) + 1

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: creado, error: errIns } = await (supabase as any)
    .from('item_adicionales')
    .insert({
      item_id: itemId,
      codigo: limpio.valor.codigo,
      nombre: limpio.valor.nombre,
      cantidad: limpio.valor.cantidad,
      costo: limpio.valor.costo,
      precio: limpio.valor.precio,
      moneda: limpio.valor.moneda,
      tasa_cop: limpio.valor.tasaCop,
      // Ver la nota de la cabecera: NO llega por parámetro.
      origen: 'manual',
      orden,
    })
    .select('id')
    .single()
  if (errIns) return { success: false, error: mensajeDeTablaAusente(errIns) ?? errIns.message }

  const desmarcados = await recalcularYRevalidar(item.cotizacionId, await negocioDe(supabase, item.cotizacionId))
  return { success: true, id: creado?.id as string | undefined, desmarcados }
}

/**
 * Corrige un adicional ya cargado.
 *
 * ⚠️ El `item_id` NO se puede mover por aquí. Cambiar de variante es cambiar de qué vuelo
 * cuelga la maleta: se borra y se vuelve a cargar, que deja las dos operaciones visibles
 * en vez de una mutación que nadie puede reconstruir después.
 */
export async function actualizarAdicional(adicionalId: string, entrada: EntradaAdicional) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: actual, error: errLeer } = await (supabase as any)
    .from('item_adicionales')
    .select('id, item_id')
    .eq('id', adicionalId)
    .maybeSingle()
  if (errLeer) return { success: false, error: mensajeDeTablaAusente(errLeer) ?? errLeer.message }
  if (!actual) return { success: false, error: 'Ese adicional no existe o no es de este workspace.' }

  const item = await resolverItem(supabase, actual.item_id as string)
  if (!item.ok) return { success: false, error: item.error }

  const limpio = normalizarAdicional(entrada)
  if (!limpio.ok) return { success: false, error: limpio.motivo }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supabase as any)
    .from('item_adicionales')
    .update({
      codigo: limpio.valor.codigo,
      nombre: limpio.valor.nombre,
      cantidad: limpio.valor.cantidad,
      costo: limpio.valor.costo,
      precio: limpio.valor.precio,
      moneda: limpio.valor.moneda,
      tasa_cop: limpio.valor.tasaCop,
    })
    .eq('id', adicionalId)
  if (errUpd) return { success: false, error: mensajeDeTablaAusente(errUpd) ?? errUpd.message }

  const desmarcados = await recalcularYRevalidar(item.cotizacionId, await negocioDe(supabase, item.cotizacionId))
  return { success: true, desmarcados }
}

/** Quita un adicional. El precio de su variante vuelve a ser el de base. */
export async function eliminarAdicional(adicionalId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: actual, error: errLeer } = await (supabase as any)
    .from('item_adicionales')
    .select('id, item_id')
    .eq('id', adicionalId)
    .maybeSingle()
  if (errLeer) return { success: false, error: mensajeDeTablaAusente(errLeer) ?? errLeer.message }
  if (!actual) return { success: false, error: 'Ese adicional no existe o no es de este workspace.' }

  const item = await resolverItem(supabase, actual.item_id as string)
  if (!item.ok) return { success: false, error: item.error }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errDel } = await (supabase as any)
    .from('item_adicionales')
    .delete()
    .eq('id', adicionalId)
  if (errDel) return { success: false, error: mensajeDeTablaAusente(errDel) ?? errDel.message }

  const desmarcados = await recalcularYRevalidar(item.cotizacionId, await negocioDe(supabase, item.cotizacionId))
  return { success: true, desmarcados }
}

/**
 * Los adicionales de una cotización, para la pantalla.
 *
 * Devuelve un mapa plano por id de variante y **nunca falla**: sin la tabla devuelve vacío
 * y el editor se ve exactamente como hoy (R6). El corte es el dato, no un flag.
 *
 * `disponible` distingue «esta cotización no tiene adicionales» de «la base todavía no
 * puede guardarlos», que es lo que decide si la pantalla ofrece el control. Ofrecer un
 * botón que va a devolver un `42P01` enseña a ignorar los errores de la pantalla — es el
 * mismo criterio que `motivoDisponible` en la tabla de combinaciones.
 */
export async function getAdicionalesDeCotizacion(cotizacionId: string) {
  const vacio = { disponible: false, porItem: {} as Record<string, unknown[]> }
  const { supabase, error } = await getWorkspace()
  if (error) return vacio

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: items } = await (supabase as any)
    .from('items')
    .select('id')
    .eq('cotizacion_id', cotizacionId)
  const ids = ((items ?? []) as { id: string }[]).map(i => i.id)
  if (ids.length === 0) return { disponible: true, porItem: {} }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error: errLeer } = await (supabase as any)
    .from('item_adicionales')
    .select('*')
    .in('item_id', ids)
  if (errLeer) {
    if (!faltaLaTablaDeAdicionales(errLeer)) {
      console.error('[adicionales] no se pudieron leer:', errLeer.message)
    }
    return vacio
  }

  const porItem: Record<string, unknown[]> = {}
  for (const fila of (data ?? []) as { item_id: string }[]) {
    const lista = porItem[fila.item_id] ?? []
    lista.push(fila)
    porItem[fila.item_id] = lista
  }
  return { disponible: true, porItem }
}
