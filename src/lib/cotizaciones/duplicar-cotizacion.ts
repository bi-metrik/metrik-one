/**
 * El ÚNICO camino para duplicar una cotización (2026-09-22).
 *
 * Había dos y los dos copiaban de menos:
 *  · el del bloque del negocio (`duplicarCotizacionNegocio`) creaba una cotización SIN
 *    ÍTEMS pero con el `valor_total` de la original: un total que no salía de nada;
 *  · el del editor (`duplicarCotizacion`) copiaba ítems e itinerarios pero no los
 *    adicionales de cada variante, ni las condiciones comerciales, ni el texto del cliente.
 *
 * Ahora los dos botones llaman aquí y la copia es completa: la cotización (menos su
 * identidad, su estado y lo que dejó el envío), los ítems con su tarifa por pasajero
 * (casillas, confirmación y correcciones), los rubros, los adicionales, el vínculo
 * opción → titular, las tarifas con su selección y su motivo, y el nombre de la
 * Recomendada, que es lo que la hace la principal.
 *
 * NO se copia: el estado (nace en `borrador`), las fechas de envío, la tarifa que el
 * cliente escogió, las excepciones de margen (la copia vuelve a medir su margen: quien
 * llama corre `recalcularTotales`) ni el historial de salidas.
 *
 * El cliente de Supabase entra por parámetro para poder probarlo con un doble que escribe.
 */

import { bogotaYear } from '@/lib/dates/bogota'
import { nombreParaDuplicado } from './nombre-cotizacion'
import { leerAdicionalesDeItems, leerItinerarios } from './itinerarios-datos'
import {
  adicionalParaLaCopia,
  cotizacionParaLaCopia,
  itemParaLaCopia,
  itinerariosParaLaCopia,
  remapearOpcionDe,
  rubroParaLaCopia,
} from './duplicar-opciones'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

export type ResultadoDuplicado =
  | { ok: true; id: string; negocioId: string | null; oportunidadId: string | null; modo: string | null }
  | { ok: false; error: string }

/**
 * @param args.negocioId Si viene, la original TIENE que ser de ese negocio: el botón del
 *   bloque manda los dos ids desde el navegador y uno no puede servir para copiar una
 *   cotización de otro negocio.
 */
export async function duplicarCotizacionCompleta(
  supabase: Supabase,
  args: { workspaceId: string; cotizacionId: string; negocioId?: string | null },
): Promise<ResultadoDuplicado> {
  const { data: original, error: errOrig } = await supabase
    .from('cotizaciones')
    .select('*')
    .eq('id', args.cotizacionId)
    .maybeSingle()
  if (errOrig) return { ok: false, error: errOrig.message }
  if (!original) return { ok: false, error: 'Cotización no encontrada' }
  const orig = original as Record<string, unknown>
  if (orig.workspace_id !== undefined && orig.workspace_id !== args.workspaceId) {
    return { ok: false, error: 'Cotización no encontrada' }
  }
  const negocioId = (orig.negocio_id ?? null) as string | null
  const oportunidadId = (orig.oportunidad_id ?? null) as string | null
  if (args.negocioId && negocioId !== args.negocioId) {
    return { ok: false, error: 'Cotización no encontrada en este negocio' }
  }

  // Nuevo consecutivo. Con epoch si el RPC falla: un sufijo fijo chocaría con la
  // siguiente copia en el índice único de (workspace, código).
  const { data: consecutivoRaw } = await supabase.rpc('get_next_cotizacion_consecutivo', {
    p_workspace_id: args.workspaceId,
  })
  const consecutivo = (consecutivoRaw as string | null) ?? `COT-${bogotaYear()}-${Date.now()}`

  // El nombre NO se hereda tal cual: dos variantes con la misma etiqueta son justo lo que
  // la comercial no puede distinguir en la lista. Se resuelve contra los hermanos.
  let hermanos: { descripcion: string | null }[] = []
  if (negocioId) {
    const { data } = await supabase.from('cotizaciones').select('descripcion').eq('negocio_id', negocioId)
    hermanos = (data ?? []) as { descripcion: string | null }[]
  } else if (oportunidadId) {
    const { data } = await supabase.from('cotizaciones').select('descripcion').eq('oportunidad_id', oportunidadId)
    hermanos = (data ?? []) as { descripcion: string | null }[]
  }
  const descripcion = nombreParaDuplicado(orig.descripcion as string | null, hermanos.map(h => h.descripcion))

  const { data: nueva, error: errIns } = await supabase
    .from('cotizaciones')
    .insert(cotizacionParaLaCopia(orig, {
      workspaceId: args.workspaceId,
      consecutivo,
      descripcion,
      originalId: args.cotizacionId,
    }))
    .select('id')
    .single()
  if (errIns || !nueva) return { ok: false, error: errIns?.message ?? 'No se pudo crear la copia' }
  const nuevaId = (nueva as { id: string }).id

  const fallo = await copiarContenido(supabase, {
    workspaceId: args.workspaceId,
    originalId: args.cotizacionId,
    nuevaId,
  })
  if (fallo) {
    // Una copia a medias es peor que ninguna: le falta algo que nadie ve que falta. Se
    // borra entera (ítems, rubros, adicionales y tarifas se van con ella por cascada).
    await supabase.from('cotizaciones').delete().eq('id', nuevaId)
    return { ok: false, error: `No se pudo duplicar: ${fallo}` }
  }

  return { ok: true, id: nuevaId, negocioId, oportunidadId, modo: (orig.modo ?? null) as string | null }
}

/** Copia ítems, rubros, adicionales, vínculos y tarifas. Devuelve el primer error, o `null`. */
async function copiarContenido(
  supabase: Supabase,
  args: { workspaceId: string; originalId: string; nuevaId: string },
): Promise<string | null> {
  // `select('*')`: cada columna de la línea viaja, incluidas las que agregue una migración
  // futura (`itemParaLaCopia` solo quita la identidad y el vínculo).
  const { data: itemsRaw, error: errItems } = await supabase
    .from('items')
    .select('*, rubros(*)')
    .eq('cotizacion_id', args.originalId)
    .order('orden')
  if (errItems) return errItems.message
  const items = (itemsRaw ?? []) as Record<string, unknown>[]

  // Viejo id → nuevo id. Sin este mapa la copia quedaría apuntando a los ítems del
  // ORIGINAL (`opcion_de`, la selección de cada tarifa, los adicionales), que no falla y
  // mueve las combinaciones de la cotización de la que salió.
  const mapaItems = new Map<string, string>()
  for (const item of items) {
    const { data: nuevoItem, error } = await supabase
      .from('items')
      .insert(itemParaLaCopia(item, args.nuevaId))
      .select('id')
      .single()
    if (error || !nuevoItem) return error?.message ?? 'No se pudo copiar una línea'
    const nuevoId = (nuevoItem as { id: string }).id
    mapaItems.set(item.id as string, nuevoId)

    const rubros = ((item.rubros ?? []) as Record<string, unknown>[]).map(r => rubroParaLaCopia(r, nuevoId))
    if (rubros.length > 0) {
      const { error: errRub } = await supabase.from('rubros').insert(rubros)
      if (errRub) return errRub.message
    }
  }

  // Los adicionales de cada VARIANTE. Tolerante como la lectura: sin la tabla no hay nada
  // que copiar, que es el estado de toda cotización que no es de viaje.
  const adicionales = await leerAdicionalesDeItems(supabase, [...mapaItems.keys()])
  const aInsertar = adicionales
    .filter(a => typeof a.item_id === 'string' && mapaItems.has(a.item_id))
    .map(a => adicionalParaLaCopia(a as unknown as Record<string, unknown>, mapaItems.get(a.item_id as string)!))
  if (aInsertar.length > 0) {
    const { error } = await supabase.from('item_adicionales').insert(aInsertar)
    if (error) return error.message
  }

  // Segunda pasada: el vínculo entre opción y titular, ya en el mundo de la copia.
  for (const patch of remapearOpcionDe(items as { id: string; opcion_de?: string | null }[], mapaItems)) {
    const { error } = await supabase.from('items').update({ opcion_de: patch.opcionDe }).eq('id', patch.nuevoId)
    if (error) return error.message
  }

  // Las tarifas. `null` = las tablas no están: no hay nada que copiar.
  const itinerarios = await leerItinerarios(supabase, args.originalId)
  if (itinerarios && itinerarios.length > 0) {
    const copias = itinerariosParaLaCopia(
      itinerarios.map(it => ({
        id: it.id,
        nombre: it.nombre,
        orden: it.orden,
        va_en_propuesta: it.vaEnPropuesta,
        // Informativa: la principal la decide el nombre (`idDelPrincipal`), y el nombre viaja.
        es_principal: it.esPrincipal,
        seleccion: it.seleccion,
        ...(it.traeColumnasDeMotivo ? { motivo_codigo: it.motivoCodigo, motivo_texto: it.motivoTexto } : {}),
      })),
      mapaItems,
      args.nuevaId,
      args.workspaceId,
    )
    for (const copia of copias) {
      const { data: nuevoItin, error } = await supabase
        .from('cotizacion_itinerarios')
        .insert(copia.cabecera)
        .select('id')
        .single()
      if (error || !nuevoItin) return error?.message ?? 'No se pudo copiar una tarifa'
      if (copia.seleccion.length > 0) {
        const { error: errSel } = await supabase
          .from('itinerario_opciones')
          .insert(copia.seleccion.map(itemId => ({ itinerario_id: (nuevoItin as { id: string }).id, item_id: itemId })))
        if (errSel) return errSel.message
      }
    }
  }

  return null
}
