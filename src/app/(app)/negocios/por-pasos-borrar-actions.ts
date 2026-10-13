'use server'

/**
 * Borrar una opción o un servicio en la cotización por pasos, con «Deshacer» de verdad (criterio
 * D2 de Vera, nota técnica de Max §5.1):
 *
 *  · El borrado es INMEDIATO: el total se recalcula en el acto, sin esperar la cuenta.
 *  · La acción devuelve la foto completa (ítem, rubros, adicionales y en qué tarifas iba) y los
 *    pantallazos firmados para la bandeja.
 *  · «Deshacer» la reinserta con los MISMOS ids y le devuelve su elección en cada tarifa.
 *  · Pasada la cuenta, los pantallazos vuelven a la bandeja (lo hace la pantalla) y las imágenes
 *    guardadas se sueltan (`soltarImagenesPorPasos`).
 *
 * Todo con el interruptor encendido: con él apagado se rechaza sin escribir (N5).
 */

import { getWorkspace } from '@/lib/actions/get-workspace'
import { lecturasParaLaBandeja, type LecturaDevuelta } from '@/app/(app)/negocios/tarifa-pax-actions'
import { exigirPorPasos } from '@/lib/cotizaciones/por-pasos-datos'
import { fotoDeTarifas } from '@/lib/cotizaciones/tarifas-por-pasos-datos'
import { cerrarAccionPorPasos, type ResultadoPorPasos } from '@/lib/cotizaciones/por-pasos-cierre'
import { normalizarGrupo } from '@/lib/cotizaciones/itinerarios'
import { retirarRanuraSiQuedoVacia } from '@/lib/cotizaciones/ranuras-datos'
import { borrarImagenesDeCaptura } from '@/lib/cotizaciones/imagen-captura'
import {
  YA_CAMBIO,
  imagenesDeFoto,
  itemParaReponer,
  ordenParaReponer,
  rubroParaReponer,
  type FotoDeOpcion,
} from '@/lib/cotizaciones/deshacer-por-pasos'

/**
 * Borra opciones de UN servicio (o el servicio entero). Devuelve su foto para «Deshacer» y sus
 * pantallazos firmados para la bandeja.
 */
export async function borrarOpcionesPorPasos(
  cotizacionId: string,
  itemIds: string[],
): Promise<ResultadoPorPasos<{ fotos: FotoDeOpcion[]; devueltas: Record<string, LecturaDevuelta[]>; valorTotal: number | null }>> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const guard = await exigirPorPasos(supabase, cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  const ids = [...new Set(itemIds)].filter(Boolean)
  if (ids.length === 0) return { success: false, error: 'No hay nada que borrar.' }

  const antes = await fotoDeTarifas(supabase, cotizacionId)
  if (!antes) return { success: false, error: 'Cotización no encontrada' }
  const deLaCotizacion = new Map(antes.ctx.items.map(i => [i.id, i]))
  if (ids.some(id => !deLaCotizacion.has(id) || deLaCotizacion.get(id)?.es_ajuste === true)) {
    return { success: false, error: 'Esa opción ya no está en la cotización. Recarga la página.' }
  }

  const [{ data: filas }, { data: rubros }, { data: adicionales }, { data: selecciones }] = await Promise.all([
    supabase.from('items').select('*').in('id', ids).eq('cotizacion_id', cotizacionId),
    supabase.from('rubros').select('*').in('item_id', ids),
    supabase.from('item_adicionales').select('*').in('item_id', ids),
    supabase.from('itinerario_opciones').select('*').in('item_id', ids),
  ])
  const fotos: FotoDeOpcion[] = ((filas ?? []) as Record<string, unknown>[]).map(item => ({
    item,
    rubros: ((rubros ?? []) as Record<string, unknown>[]).filter(r => r.item_id === item.id),
    adicionales: ((adicionales ?? []) as Record<string, unknown>[]).filter(a => a.item_id === item.id),
    selecciones: ((selecciones ?? []) as { itinerario_id: string; item_id: string }[])
      .filter(s => s.item_id === item.id)
      .map(s => ({ itinerario_id: s.itinerario_id, item_id: s.item_id })),
  }))

  // Los pantallazos, firmados para volver a la bandeja cuando venza la cuenta.
  const devueltas: Record<string, LecturaDevuelta[]> = {}
  for (const id of ids) {
    const l = await lecturasParaLaBandeja(id)
    devueltas[id] = l.ok ? l.devueltas : []
  }

  const { error: errDel } = await supabase.from('items').delete().in('id', ids).eq('cotizacion_id', cotizacionId)
  if (errDel) return { success: false, error: errDel.message }
  const ranuras = [...new Set(fotos.map(f => f.item.ranura_id).filter((r): r is string => typeof r === 'string'))]
  for (const r of ranuras) await retirarRanuraSiQuedoVacia(supabase, r)

  const c = await cerrarAccionPorPasos(supabase, { workspaceId, cotizacionId, antes, staffId })
  if (!c.success) return c
  return { success: true, fotos, devueltas, valorTotal: c.valorTotal }
}

/**
 * «Deshacer» de un borrado: reinserta las opciones con los mismos ids, sus rubros, sus adicionales
 * y su elección en cada tarifa. Si alguna ya volvió (otro «Deshacer», otra pestaña), no hace nada.
 *
 * ⚠️ La foto viene del navegador: se reinserta solo lo que es de ESTA cotización (y el RLS acota
 * al workspace). Nada de lo que trae puede apuntar a otra cotización.
 */
export async function reponerOpcionesPorPasos(
  cotizacionId: string,
  fotos: FotoDeOpcion[],
): Promise<ResultadoPorPasos<{ valorTotal: number | null }>> {
  const { supabase: sesion, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const supabase = sesion as any
  const guard = await exigirPorPasos(supabase, cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  if (!Array.isArray(fotos) || fotos.length === 0) return { success: false, error: 'No hay nada que deshacer.' }
  const ids = fotos.map(f => String(f?.item?.id ?? ''))
  if (fotos.some(f => f?.item?.cotizacion_id !== cotizacionId) || ids.some(id => !id)) {
    return { success: false, error: 'Esa opción no es de esta cotización.' }
  }

  const antes = await fotoDeTarifas(supabase, cotizacionId)
  if (!antes) return { success: false, error: 'Cotización no encontrada' }
  if (ids.some(id => antes.ctx.items.some(i => i.id === id))) return { success: false, error: YA_CAMBIO }
  const tarifasDeLaCotizacion = new Set(antes.filas.map(f => f.id))

  for (const foto of ordenParaReponer(fotos)) {
    const fila = itemParaReponer(foto.item)
    let { error: errIns } = await supabase.from('items').insert(fila)
    // La ranura (la entidad del nombre) se retira si el servicio quedó vacío: sin ella, la opción
    // vuelve agrupada por su `grupo`, que es lo que suma y lo que se lee.
    if (errIns && (errIns as { code?: string }).code === '23503' && fila.ranura_id) {
      ;({ error: errIns } = await supabase.from('items').insert({ ...fila, ranura_id: null }))
    }
    if (errIns) return { success: false, error: errIns.message }
    const rubros = foto.rubros.filter(r => r.item_id === foto.item.id).map(rubroParaReponer)
    if (rubros.length > 0) {
      const { error: e } = await supabase.from('rubros').insert(rubros)
      if (e) return { success: false, error: e.message }
    }
    const adicionales = foto.adicionales.filter(a => a.item_id === foto.item.id)
    if (adicionales.length > 0) {
      const { error: e } = await supabase.from('item_adicionales').insert(adicionales)
      if (e) return { success: false, error: e.message }
    }
  }

  // La elección de cada tarifa: la opción repuesta vuelve a ser la que iba. Se borra lo que la
  // tarifa nombra HOY en ese servicio (ONE le propuso otra al borrar) y se pone la de antes.
  const despues = await fotoDeTarifas(supabase, cotizacionId)
  if (!despues) return { success: false, error: 'Cotización no encontrada' }
  for (const foto of fotos) {
    const grupo = normalizarGrupo((foto.item.grupo ?? null) as string | null)
    const hermanas = despues.ctx.items.filter(i => normalizarGrupo(i.grupo ?? null) === grupo).map(i => i.id)
    for (const s of foto.selecciones) {
      if (s.item_id !== foto.item.id || !tarifasDeLaCotizacion.has(s.itinerario_id)) continue
      const { error: eDel } = await supabase.from('itinerario_opciones').delete().eq('itinerario_id', s.itinerario_id).in('item_id', hermanas)
      if (eDel) return { success: false, error: eDel.message }
      const { error: eIns } = await supabase.from('itinerario_opciones').insert({ itinerario_id: s.itinerario_id, item_id: s.item_id })
      if (eIns) return { success: false, error: eIns.message }
    }
  }
  return cerrarAccionPorPasos(supabase, { workspaceId, cotizacionId, antes, staffId })
}

/**
 * Pasada la cuenta de «Deshacer»: suelta las imágenes guardadas de lo que se borró (los
 * pantallazos ya viajaron a la bandeja como datos). Solo las que ninguna opción de la cotización
 * sigue usando: si alguien deshizo el borrado, no se toca nada.
 */
export async function soltarImagenesPorPasos(cotizacionId: string, fotos: FotoDeOpcion[]): Promise<ResultadoPorPasos> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const guard = await exigirPorPasos(supabase, cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  const { data: vivas } = await supabase.from('items').select('id, tarifa_pax').eq('cotizacion_id', cotizacionId)
  const enUso = new Set(((vivas ?? []) as Record<string, unknown>[]).flatMap(item => imagenesDeFoto({ item, rubros: [], adicionales: [], selecciones: [] })))
  // La foto viene del navegador: solo se sueltan imágenes guardadas bajo ESTA cotización
  // (`capturas/{cotización}` y `fotos-hotel/{cotización}`), nunca una ruta cualquiera.
  const deEstaCotizacion = (r: string) => r.includes(`/capturas/${cotizacionId}/`) || r.includes(`/fotos-hotel/${cotizacionId}/`)
  const refs = (Array.isArray(fotos) ? fotos : []).flatMap(imagenesDeFoto).filter(r => deEstaCotizacion(r) && !enUso.has(r))
  if (refs.length > 0) await borrarImagenesDeCaptura(workspaceId, refs)
  return { success: true }
}
