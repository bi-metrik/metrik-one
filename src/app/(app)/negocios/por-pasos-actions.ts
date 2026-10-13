'use server'

/**
 * Las acciones NUEVAS de la cotización por pasos (etapa C de la cotización integrada).
 *
 * Todas empiezan igual: `exigirPorPasos` relee el interruptor contra la base con sus cuatro
 * condiciones (C1). Con el interruptor apagado se rechazan sin escribir nada (criterio N5):
 * una pestaña abierta antes de apagar no sigue escribiendo con la forma nueva.
 *
 * Ninguna cambia cómo se lee el total. Escriben el DATO que la lectura de siempre ya entiende
 * (`itemsDelItinerario`, `idDelPrincipal`), así que una cotización hecha aquí abre, suma,
 * imprime y se aprueba igual con el interruptor apagado (prueba de ida y vuelta).
 *
 * Vive aparte de `itinerario-actions.ts` a propósito: ningún lector de plata importa este
 * archivo, y así el guard del interruptor nunca queda al alcance de la lectura (N4).
 */

import { getWorkspace } from '@/lib/actions/get-workspace'
import { actualizarRanuraDeItem } from '@/app/(app)/negocios/itinerario-actions'
import { devolverOpcionABandeja } from '@/app/(app)/negocios/tarifa-pax-actions'
import { exigirPorPasos } from '@/lib/cotizaciones/por-pasos-datos'
import { fotoDeTarifas, type FotoDeTarifas } from '@/lib/cotizaciones/tarifas-por-pasos-datos'
import { cerrarAccionPorPasos as cerrarAccion, type ResultadoPorPasos } from '@/lib/cotizaciones/por-pasos-cierre'
import { firmaDeTarifa } from '@/lib/cotizaciones/tarifas-por-pasos'
import { leerCabecera } from '@/lib/cotizaciones/itinerarios-datos'
import { itemsDelItinerario, itemsQueAportanAlTotal, normalizarGrupo, ranurasConAlternativas } from '@/lib/cotizaciones/itinerarios'
import { leerViajeDelNegocio } from '@/lib/cotizaciones/viaje-negocio'
import { motivoSinPrecioPorPasajero, opcionesSinPrecio } from '@/lib/cotizaciones/precio-que-falta'
import { enviarCotizacion } from '@/app/(app)/negocios/cotizacion-actions'
import { esRecomendada, recomendadaDe } from '@/lib/cotizaciones/tarifas'
import { grupoDeInstancia, resolverRanura, siguienteGrupoDeTipo } from '@/lib/cotizaciones/ranuras-pantallazo'


// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

/** La cotización de una línea, leída de la base (RLS acota al workspace de la sesión). */
async function cotizacionDeItem(supabase: Supabase, itemId: string): Promise<{ cotizacionId: string; grupo: string | null } | null> {
  const { data } = await supabase.from('items').select('id, cotizacion_id, grupo').eq('id', itemId).maybeSingle()
  if (!data?.cotizacion_id) return null
  return { cotizacionId: data.cotizacion_id as string, grupo: (data.grupo ?? null) as string | null }
}

// ── Tarifas ──────────────────────────────────────────────────────────────────

/**
 * Escoge la opción que va en una tarifa para un servicio con opciones: vuelo, hotel, traslado
 * o actividad (decisión 3: se acaba el «por supuesto»). Hoy `cambiarOpcionDeItinerario` solo
 * acepta vuelo y hotel; la lectura (`itemsDelItinerario`) ya respeta la elección de un
 * traslado o actividad, así que apagar no mueve el precio.
 *
 * Devuelve la opción que había, para el «Deshacer».
 */
export async function elegirOpcionEnTarifa(
  itinerarioId: string,
  grupo: string,
  itemId: string,
): Promise<ResultadoPorPasos<{ anterior: string | null; valorTotal: number | null }>> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const cab = await leerCabecera(supabase, itinerarioId)
  if (!cab) return { success: false, error: 'Tarifa no encontrada' }
  const guard = await exigirPorPasos(supabase, cab.cotizacionId, 'toda_opcion_en_tarifas')
  if (!guard.ok) return { success: false, error: guard.error }

  const antes = await fotoDeTarifas(supabase, cab.cotizacionId)
  if (!antes) return { success: false, error: 'Cotización no encontrada' }
  const ranura = ranurasConAlternativas(antes.ctx.items).find(r => r.grupo === normalizarGrupo(grupo))
  if (!ranura) return { success: false, error: 'Ese servicio no tiene opciones entre qué escoger.' }
  if (!ranura.candidatos.includes(itemId)) return { success: false, error: 'Esa opción no es de este servicio.' }
  const anterior = ranura.candidatos.find(id => cab.seleccion.includes(id)) ?? null

  if (anterior !== itemId) {
    const { error: errDel } = await supabase
      .from('itinerario_opciones')
      .delete()
      .eq('itinerario_id', itinerarioId)
      .in('item_id', ranura.candidatos)
    if (errDel) return { success: false, error: errDel.message }
    const { error: errIns } = await supabase.from('itinerario_opciones').insert({ itinerario_id: itinerarioId, item_id: itemId })
    if (errIns) return { success: false, error: errIns.message }
  }
  const r = await cerrarAccion(supabase, { workspaceId, cotizacionId: cab.cotizacionId, antes, staffId })
  if (!r.success) return r
  return { success: true, anterior, valorTotal: r.valorTotal }
}

/**
 * «Mandarla al cliente» de la Económica o la Premium. La Recomendada siempre se manda
 * (decisión E) y una tarifa idéntica a la Recomendada no se manda (decisión C): las dos cosas
 * se rechazan aquí, no solo en la pantalla.
 *
 * Bajo el mínimo SÍ se puede mandar: el candado está en la salida (PDF, Enviar, Aprobar), donde
 * el dueño la autoriza (decisión L).
 */
export async function mandarTarifa(
  itinerarioId: string,
  va: boolean,
): Promise<ResultadoPorPasos<{ anterior: boolean; valorTotal: number | null }>> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const cab = await leerCabecera(supabase, itinerarioId)
  if (!cab) return { success: false, error: 'Tarifa no encontrada' }
  const guard = await exigirPorPasos(supabase, cab.cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }

  if (esRecomendada(cab.nombre)) {
    if (!va) return { success: false, error: 'La Recomendada siempre se manda: es el total de la cotización.' }
    return { success: true, anterior: true, valorTotal: null }
  }
  const antes = await fotoDeTarifas(supabase, cab.cotizacionId)
  if (!antes) return { success: false, error: 'Cotización no encontrada' }
  if (va) {
    const rec = recomendadaDe(antes.filas).fila
    const items = antes.ctx.items
    if (rec && firmaDeTarifa(items, cab.seleccion) === firmaDeTarifa(items, rec.seleccion)) {
      return { success: false, error: 'Quedó igual a la Recomendada: no se manda. Cambia una opción para mandarla.' }
    }
  }
  if (cab.vaEnPropuesta !== va) {
    const { error: errUpd } = await supabase.from('cotizacion_itinerarios').update({ va_en_propuesta: va }).eq('id', itinerarioId)
    if (errUpd) return { success: false, error: errUpd.message }
  }
  // Sin `antes`: marcar no cambia las opciones de ningún servicio, y así el plan respeta la marca.
  const r = await cerrarAccion(supabase, { workspaceId, cotizacionId: cab.cotizacionId, antes: null, staffId })
  if (!r.success) return r
  return { success: true, anterior: cab.vaEnPropuesta, valorTotal: r.valorTotal }
}

// ── Servicio y opción ────────────────────────────────────────────────────────

/** Mueve una línea a otro grupo y deja las tarifas completas. Comparte guard y cierre. */
async function moverLinea(
  itemId: string,
  destino: (args: { supabase: Supabase; grupoActual: string; antes: FotoDeTarifas }) => string | { error: string },
): Promise<ResultadoPorPasos<{ grupoAnterior: string | null; grupo: string; valorTotal: number | null }>> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const linea = await cotizacionDeItem(supabase, itemId)
  if (!linea) return { success: false, error: 'La opción no existe o no es de este workspace.' }
  const guard = await exigirPorPasos(supabase, linea.cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  const grupoActual = normalizarGrupo(linea.grupo)
  if (!grupoActual || !resolverRanura(grupoActual)) return { success: false, error: 'Esta línea no es un servicio del viaje.' }

  const antes = await fotoDeTarifas(supabase, linea.cotizacionId)
  if (!antes) return { success: false, error: 'Cotización no encontrada' }
  const d = destino({ supabase, grupoActual, antes })
  if (typeof d !== 'string') return { success: false, error: d.error }
  const grupo = normalizarGrupo(d)
  if (!grupo) return { success: false, error: 'Falta el servicio de destino.' }
  // Una opción solo compite con otras del MISMO tipo: un traslado nunca es opción de un hotel.
  if (resolverRanura(grupo)?.definicion.slug !== resolverRanura(grupoActual)?.definicion.slug) {
    return { success: false, error: 'Una opción solo puede ir en un servicio del mismo tipo.' }
  }
  if (grupo !== grupoActual) {
    const r = await actualizarRanuraDeItem(itemId, { grupo })
    if (!r.success) return { success: false, error: r.error ?? 'No se pudo mover la opción.' }
  }
  const c = await cerrarAccion(supabase, { workspaceId, cotizacionId: linea.cotizacionId, antes, staffId })
  if (!c.success) return c
  return { success: true, grupoAnterior: grupoActual, grupo, valorTotal: c.valorTotal }
}

/** «Mover esta opción a…»: solo esa opción, a otro servicio del mismo tipo. */
export async function moverOpcionPorPasos(itemId: string, grupoDestino: string) {
  return moverLinea(itemId, ({ antes }) => {
    const destino = normalizarGrupo(grupoDestino)
    if (!destino) return { error: 'Falta el servicio de destino.' }
    const existe = antes.ctx.items.some(i => normalizarGrupo(i.grupo) === destino)
    return existe ? destino : { error: 'Ese servicio ya no está en la cotización. Recarga la página.' }
  })
}

/**
 * «Separar como servicio aparte»: la opción pasa a ser su propio servicio, del mismo tipo, con
 * el nombre del lugar del que salió y «(aparte)» (diseño, «Nombres»).
 */
export async function separarOpcionPorPasos(itemId: string) {
  return moverLinea(itemId, ({ grupoActual, antes }) => {
    const inst = resolverRanura(grupoActual)
    if (!inst) return { error: 'Esta línea no es un servicio del viaje.' }
    const delGrupo = antes.ctx.items.filter(i => normalizarGrupo(i.grupo) === grupoActual && i.es_ajuste !== true)
    if (delGrupo.length < 2) return { error: 'Este servicio tiene una sola opción: ya está aparte.' }
    const enUso = antes.ctx.items.map(i => i.grupo ?? null)
    const siguiente = resolverRanura(siguienteGrupoDeTipo(inst.definicion, enUso))
    const base = inst.nombre ?? inst.definicion.label
    return grupoDeInstancia(inst.definicion, { numero: siguiente?.numero ?? null, nombre: `${base} (aparte)` })
  })
}

/**
 * «Juntar como opción de…»: TODAS las opciones de un servicio pasan a competir dentro de otro
 * del mismo tipo. Devuelve el grupo que tenía, para el «Deshacer».
 */
export async function juntarServicioPorPasos(
  cotizacionId: string,
  grupoOrigen: string,
  grupoDestino: string,
): Promise<ResultadoPorPasos<{ movidas: string[]; grupoAnterior: string; valorTotal: number | null }>> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const guard = await exigirPorPasos(supabase, cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  const origen = normalizarGrupo(grupoOrigen)
  const destino = normalizarGrupo(grupoDestino)
  if (!origen || !destino || origen === destino) return { success: false, error: 'Escoge otro servicio para juntarlo.' }
  if (resolverRanura(origen)?.definicion.slug !== resolverRanura(destino)?.definicion.slug) {
    return { success: false, error: 'Solo se juntan servicios del mismo tipo.' }
  }
  const antes = await fotoDeTarifas(supabase, cotizacionId)
  if (!antes) return { success: false, error: 'Cotización no encontrada' }
  if (!antes.ctx.items.some(i => normalizarGrupo(i.grupo) === destino)) {
    return { success: false, error: 'Ese servicio ya no está en la cotización. Recarga la página.' }
  }
  const movidas = antes.ctx.items.filter(i => normalizarGrupo(i.grupo) === origen && i.es_ajuste !== true).map(i => i.id)
  if (movidas.length === 0) return { success: false, error: 'Ese servicio ya no tiene opciones.' }
  for (const id of movidas) {
    const r = await actualizarRanuraDeItem(id, { grupo: destino })
    if (!r.success) return { success: false, error: r.error ?? 'No se pudo juntar el servicio.' }
  }
  const c = await cerrarAccion(supabase, { workspaceId, cotizacionId, antes, staffId })
  if (!c.success) return c
  return { success: true, movidas, grupoAnterior: origen, valorTotal: c.valorTotal }
}

/**
 * «Eliminar opción» de la forma por pasos: la opción sale, su pantallazo vuelve a la bandeja (como
 * hoy) y las tarifas que la tenían escogida pasan a la propuesta de ONE. Ninguna queda incompleta
 * (R1). El «Deshacer» inmediato con los mismos ids llega con la pantalla (C4).
 */
export async function eliminarOpcionPorPasos(
  itemId: string,
): Promise<ResultadoPorPasos<{ devueltas: unknown[]; valorTotal: number | null }>> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const linea = await cotizacionDeItem(supabase, itemId)
  if (!linea) return { success: false, error: 'La opción no existe o no es de este workspace.' }
  const guard = await exigirPorPasos(supabase, linea.cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  const antes = await fotoDeTarifas(supabase, linea.cotizacionId)
  if (!antes) return { success: false, error: 'Cotización no encontrada' }
  const r = await devolverOpcionABandeja(itemId)
  if (!r.ok) return { success: false, error: r.mensaje }
  const c = await cerrarAccion(supabase, { workspaceId, cotizacionId: linea.cotizacionId, antes, staffId })
  if (!c.success) return c
  return { success: true, devueltas: r.devueltas, valorTotal: c.valorTotal }
}

// ── Enviar ───────────────────────────────────────────────────────────────────

/**
 * «Enviar al cliente» de la forma por pasos. Las guardas de siempre no cambian (criterio N13):
 * después de la regla nueva, envía con `enviarCotizacion`, que es la misma del editor.
 *
 * La regla nueva (aprobada por Mauricio el 2026-10-12, P12): una opción de vuelo o actividad
 * que va al cliente y no trae el precio del niño o del infante impide enviar. Solo aquí, con el
 * interruptor encendido: apagado, el envío de siempre no la conoce.
 */
export async function enviarPorPasos(cotizacionId: string): Promise<ResultadoPorPasos> {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }
  const guard = await exigirPorPasos(supabase, cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  const foto = await fotoDeTarifas(supabase, cotizacionId)
  if (!foto) return { success: false, error: 'Cotización no encontrada' }
  const vanAlCliente = foto.filas.filter(f => f.vaEnPropuesta)
  const ids = new Set(
    vanAlCliente.length > 0
      ? vanAlCliente.flatMap(f => itemsDelItinerario(foto.ctx.items, f.seleccion))
      : itemsQueAportanAlTotal(foto.ctx.items),
  )
  const { viaje } = await leerViajeDelNegocio(supabase, foto.ctx.negocioId)
  const motivo = motivoSinPrecioPorPasajero(opcionesSinPrecio(foto.ctx.items, ids, viaje.composicion))
  if (motivo) return { success: false, error: motivo }
  const r = await enviarCotizacion(cotizacionId)
  return r.success ? { success: true } : { success: false, error: r.error ?? 'No se pudo enviar.' }
}
