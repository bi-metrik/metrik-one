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
import { etiquetaDeRanura, grupoDeInstancia, resolverRanura, siguienteGrupoDeTipo } from '@/lib/cotizaciones/ranuras-pantallazo'
import { cambiosDeEstado, estadoDeLinea, estadosPermitidos, type EstadoServicio } from '@/lib/cotizaciones/estado-servicio'
import { YA_CAMBIO, type OperacionDeshacer } from '@/lib/cotizaciones/deshacer-por-pasos'
import { agregarOpcionARanura } from '@/app/(app)/negocios/ranura-actions'
import { createServiceClient } from '@/lib/supabase/server'
import { registrarActividad } from '@/lib/activity/registrar-actividad'
import { evaluarSalida, leerUltimaExcepcion, recortarParaLog, TABLA_EXCEPCIONES } from '@/lib/cotizaciones/piso-salida-datos'
import { pctTexto } from '@/lib/cotizaciones/piso-salida'
import { CAUSA_RETIRADA } from '@/lib/cotizaciones/autorizacion-vista'
import { esDuenoDelWorkspace, leerPlatformAdmin } from '@/lib/permissions/dueno-workspace'
import { lineasConMargenPropio } from '@/lib/cotizaciones/margen-propio'
import { hotelesAsociados } from '@/lib/cotizaciones/va-con-hotel'
import { leerTarifaPax } from '@/lib/cotizaciones/tarifa-pasajero'
import { motivoAutorizacionParaEnviar } from '@/lib/autorizacion-datos/envio'
import { leerReglasDeCotizacion, motivoReglasInvalidas, reglasAJsonb } from '@/lib/cotizaciones/reglas-margen'


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
  // El traslado que va con OTRA opción de hotel no cabe en esta tarifa (`va-con-hotel.ts`): el plan
  // lo cambiaría solo por el de su hotel y la elección se perdería sin aviso.
  const hotelDelTraslado = hotelesAsociados(antes.ctx.items).get(itemId)
  if (hotelDelTraslado && !itemsDelItinerario(antes.ctx.items, cab.seleccion).includes(hotelDelTraslado)) {
    return { success: false, error: 'Esa opción va con otro hotel, y en esta tarifa va otro. Cambia el hotel de la tarifa, o deja la opción como general en su tarjeta.' }
  }

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

// ── Incluido · Opcional · No va (C3) ────────────────────────────────────────

/**
 * El estado de un SERVICIO entero (decisión 4 del diseño): «Incluido», «Opcional» (traslado y
 * actividad) o «No va». Se escribe con los dos interruptores de siempre en TODAS sus opciones,
 * así que la lectura no cambia: un traslado Opcional no suma y sale en «Opcionales» del PDF con su
 * precio, exactamente como una actividad opcional de hoy.
 *
 * Lo nuevo frente a la pantalla de siempre: el traslado Opcional (pieza `opcional_traslado`) y el
 * hotel que no va. Vuelo y hotel nunca son opcionales: el servidor lo rechaza (P10).
 *
 * Devuelve el estado que tenía cada opción, para el «Deshacer».
 */
export async function estadoDeServicioPorPasos(
  cotizacionId: string,
  grupo: string,
  estado: EstadoServicio,
): Promise<ResultadoPorPasos<{ anterior: Record<string, EstadoServicio>; valorTotal: number | null }>> {
  const { supabase, workspaceId, staffId, userId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const g = normalizarGrupo(grupo)
  if (!g) return { success: false, error: 'Falta el servicio.' }
  const permitidos = estadosPermitidos(g)
  if (!permitidos.includes(estado)) {
    return {
      success: false,
      error: permitidos.length === 0
        ? 'Este servicio no tiene estado: no es un vuelo, hotel, traslado ni actividad.'
        : `Un ${etiquetaDeRanura(g).toLowerCase().split(' ')[0]} va o no va: no puede ser opcional.`,
    }
  }
  const esTraslado = resolverRanura(g)?.definicion.slug === 'traslado_detalle'
  const guard = await exigirPorPasos(supabase, cotizacionId, esTraslado && estado === 'opcional' ? 'opcional_traslado' : undefined)
  if (!guard.ok) return { success: false, error: guard.error }

  const antes = await fotoDeTarifas(supabase, cotizacionId)
  if (!antes) return { success: false, error: 'Cotización no encontrada' }
  const { data: filas, error: errLee } = await supabase
    .from('items')
    .select('*')
    .eq('cotizacion_id', cotizacionId)
    .eq('grupo', g)
  if (errLee) return { success: false, error: errLee.message }
  const lineas = ((filas ?? []) as Record<string, unknown>[]).filter(f => f.es_ajuste !== true)
  if (lineas.length === 0) return { success: false, error: 'Ese servicio ya no está en la cotización. Recarga la página.' }

  const anterior: Record<string, EstadoServicio> = {}
  let quien: { por: string | null; porId: string | null } | null = null
  for (const l of lineas) {
    const actual = { grupo: g, entra_al_precio: (l.entra_al_precio ?? null) as boolean | null, mostrar_en_sugeridos: (l.mostrar_en_sugeridos ?? null) as boolean | null }
    anterior[l.id as string] = estadoDeLinea(actual)
    const cambios = cambiosDeEstado(actual, estado)
    if (!cambios) continue
    const tarifa = { ...((l.tarifa_pax && typeof l.tarifa_pax === 'object' ? l.tarifa_pax : {}) as Record<string, unknown>) }
    if (cambios.noVa) {
      if (!quien) {
        const { data: perfil } = await supabase.from('profiles').select('full_name').eq('id', userId).maybeSingle()
        quien = { por: ((perfil?.full_name as string | null | undefined) ?? '').trim() || null, porId: userId ?? null }
      }
      tarifa.noVa = { era: cambios.noVa.era, por: quien.por, porId: quien.porId, en: new Date().toISOString() }
    } else {
      delete tarifa.noVa
    }
    const patch: Record<string, unknown> = {
      entra_al_precio: cambios.entra_al_precio,
      mostrar_en_sugeridos: cambios.mostrar_en_sugeridos,
      // Sin tarifa guardada y sin marca que poner, la columna se queda como estaba.
      ...(l.tarifa_pax || cambios.noVa ? { tarifa_pax: tarifa } : {}),
    }
    const { error: errUpd } = await supabase.from('items').update(patch).eq('id', l.id as string)
    if (errUpd) return { success: false, error: errUpd.message }
  }
  const c = await cerrarAccion(supabase, { workspaceId, cotizacionId, antes, staffId })
  if (!c.success) return c
  return { success: true, anterior, valorTotal: c.valorTotal }
}

// ── El margen de la cotización (uno para las tres tarifas) ──────────────────

/**
 * La casilla única de margen de Tarifas: es el «margen general» de hoy
 * (`cotizaciones.margen_porcentaje`) y vale para las tres tarifas (decisión B: el margen por
 * tarifa llega en C7). Devuelve el anterior, para el «Deshacer».
 */
export async function margenPorPasos(
  cotizacionId: string,
  pct: number,
): Promise<ResultadoPorPasos<{ anterior: number | null; valorTotal: number | null }>> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  if (!Number.isFinite(pct) || pct < 0 || pct >= 100) return { success: false, error: 'El margen tiene que estar entre 0 % y 99 %.' }
  const guard = await exigirPorPasos(supabase, cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  const { data: cot } = await supabase.from('cotizaciones').select('margen_porcentaje').eq('id', cotizacionId).maybeSingle()
  const anterior = (cot?.margen_porcentaje ?? null) as number | null
  const { error: errUpd } = await supabase.from('cotizaciones').update({ margen_porcentaje: pct }).eq('id', cotizacionId)
  if (errUpd) return { success: false, error: errUpd.message }
  const c = await cerrarAccion(supabase, { workspaceId, cotizacionId, antes: null, staffId })
  if (!c.success) return c
  return { success: true, anterior, valorTotal: c.valorTotal }
}

/**
 * Los puntos extra y los descuentos sobre el total de una cotización con reglas de margen
 * (`reglas-margen.ts`, brief del 2026-10-27). Solo en una cotización que nació con reglas: la
 * política (colchón, piso de hotel, tope de puntos) no se toca aquí, es la que se copió de la línea.
 *
 * `descuentos` reemplaza la lista entera (la pantalla la manda como queda). Devuelve lo anterior.
 */
export async function reglasPorPasos(
  cotizacionId: string,
  cambio: { puntosExtra?: number; descuentos?: { id?: string; descripcion: string; pct: number }[] },
): Promise<ResultadoPorPasos<{ valorTotal: number | null }>> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const guard = await exigirPorPasos(supabase, cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  // `*`: la columna la agrega una migración; sin ella llega `undefined` y se dice, sin escribir.
  const { data: cot } = await supabase.from('cotizaciones').select('*').eq('id', cotizacionId).maybeSingle()
  const actuales = leerReglasDeCotizacion((cot as { reglas_margen?: unknown } | null)?.reglas_margen)
  if (!actuales) return { success: false, error: 'Esta cotización no tiene reglas de margen.' }
  if ((cot as { estado?: string | null } | null)?.estado !== 'borrador') return { success: false, error: 'Solo se cambia en una cotización en borrador.' }
  const descuentos = cambio.descuentos?.map((d, i) => ({ id: (d.id ?? '').trim() || `d${Date.now().toString(36)}${i}`, descripcion: (d.descripcion ?? '').trim(), pct: Number(d.pct) }))
  const invalido = motivoReglasInvalidas(actuales.politica, { puntosExtra: cambio.puntosExtra, descuentos })
  if (invalido) return { success: false, error: invalido }
  const siguientes = {
    ...actuales,
    ...(cambio.puntosExtra !== undefined ? { puntosExtra: Math.round(cambio.puntosExtra * 100) / 100 } : {}),
    ...(descuentos ? { descuentos } : {}),
  }
  const { error: errUpd } = await supabase.from('cotizaciones').update({ reglas_margen: reglasAJsonb(siguientes) } as never).eq('id', cotizacionId)
  if (errUpd) return { success: false, error: errUpd.message }
  const c = await cerrarAccion(supabase, { workspaceId, cotizacionId, antes: null, staffId })
  if (!c.success) return c
  return { success: true, valorTotal: c.valorTotal }
}

/**
 * «Va con el hotel…» de un traslado (reunión del 2026-10-22, punto 5, `va-con-hotel.ts`): la
 * opción queda atada a UNA opción de hotel y cuenta solo en las tarifas que la llevan; `null` la
 * deja general (sirve para cualquier hotel). Después, cada tarifa toma el traslado de su hotel.
 */
export async function asociarConHotel(
  itemId: string,
  hotelId: string | null,
): Promise<ResultadoPorPasos<{ valorTotal: number | null }>> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const de = await cotizacionDeItem(supabase, itemId)
  if (!de) return { success: false, error: 'Opción no encontrada' }
  const guard = await exigirPorPasos(supabase, de.cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  const antes = await fotoDeTarifas(supabase, de.cotizacionId)
  if (!antes) return { success: false, error: 'Cotización no encontrada' }
  const item = antes.ctx.items.find(i => i.id === itemId)
  if (!item) return { success: false, error: 'Opción no encontrada' }
  if (resolverRanura(item.grupo ?? '')?.definicion.slug === 'hotel_detalle') return { success: false, error: 'Un hotel no va con otro hotel.' }
  if (hotelId !== null) {
    const hotel = antes.ctx.items.find(i => i.id === hotelId)
    if (!hotel || resolverRanura(hotel.grupo ?? '')?.definicion.slug !== 'hotel_detalle') return { success: false, error: 'Esa opción de hotel ya no está en la cotización. Recarga.' }
  }
  const { data: fila, error: errLeer } = await supabase.from('items').select('tarifa_pax').eq('id', itemId).maybeSingle()
  if (errLeer || !fila) return { success: false, error: 'No se pudo leer la opción. Vuelve a intentarlo.' }
  const actual = leerTarifaPax(fila.tarifa_pax)
  if ((actual.vaConHotel ?? null) === hotelId) return { success: true, valorTotal: null }
  const siguiente = { ...actual, actualizadaEn: new Date().toISOString() }
  if (hotelId === null) delete siguiente.vaConHotel
  else siguiente.vaConHotel = hotelId
  const { error: errUpd } = await supabase.from('items').update({ tarifa_pax: siguiente as never }).eq('id', itemId)
  if (errUpd) return { success: false, error: errUpd.message }
  const c = await cerrarAccion(supabase, { workspaceId, cotizacionId: de.cotizacionId, antes, staffId })
  if (!c.success) return c
  return { success: true, valorTotal: c.valorTotal }
}

/**
 * «Que usen el margen de la cotización» (reunión del 2026-10-22, punto 2, `margen-propio.ts`): las
 * opciones Netas con un margen propio escrito por una persona vuelven a heredar el de la
 * cotización. Las Públicas, las de precio a mano y las del margen del proveedor no se tocan, aunque
 * el navegador las mande: el servidor vuelve a decidir cuáles son.
 */
export async function margenDeLaCotizacionEnOpciones(
  cotizacionId: string,
  itemIds: string[],
): Promise<ResultadoPorPasos<{ cambiadas: number; valorTotal: number | null }>> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  if (!Array.isArray(itemIds) || itemIds.length === 0 || itemIds.length > 200) return { success: false, error: 'No hay opciones que cambiar.' }
  const guard = await exigirPorPasos(supabase, cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  const antes = await fotoDeTarifas(supabase, cotizacionId)
  if (!antes) return { success: false, error: 'Cotización no encontrada' }
  const pedidas = new Set(itemIds.filter(id => typeof id === 'string'))
  const propias = lineasConMargenPropio(
    antes.ctx.items.filter(i => pedidas.has(i.id)),
    Number(antes.ctx.params.margenPct) || 0,
    antes.ctx.params.convencionMargen,
  ).map(i => i.id)
  if (propias.length === 0) return { success: false, error: 'Esas opciones ya usan el margen de la cotización.' }
  const { error: errUpd } = await supabase.from('items').update({ margen_porcentaje: null }).eq('cotizacion_id', cotizacionId).in('id', propias)
  if (errUpd) return { success: false, error: errUpd.message }
  const c = await cerrarAccion(supabase, { workspaceId, cotizacionId, antes: null, staffId })
  if (!c.success) return c
  return { success: true, cambiadas: propias.length, valorTotal: c.valorTotal }
}

/**
 * «+ Otra opción» de un servicio: una opción vacía en ese servicio, para pegarle su pantallazo, y
 * las tres tarifas con la propuesta de ONE para él.
 */
export async function agregarOpcionPorPasos(
  cotizacionId: string,
  grupo: string,
): Promise<ResultadoPorPasos<{ itemId: string; valorTotal: number | null }>> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const guard = await exigirPorPasos(supabase, cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  const antes = await fotoDeTarifas(supabase, cotizacionId)
  if (!antes) return { success: false, error: 'Cotización no encontrada' }
  const r = await agregarOpcionARanura(cotizacionId, grupo)
  if (!r.success) return { success: false, error: r.error }
  const c = await cerrarAccion(supabase, { workspaceId, cotizacionId, antes, staffId })
  if (!c.success) return c
  return { success: true, itemId: r.itemId, valorTotal: c.valorTotal }
}

// ── Deshacer (condicionado) ─────────────────────────────────────────────────

/**
 * «Deshacer» de los cambios de valor de la forma por pasos (D1): solo revierte si lo que la
 * acción escribió sigue ahí. Si alguien lo cambió en medio, responde «Ya cambió: no se deshace»
 * y no pisa el cambio nuevo. Borrar se deshace aparte (`reponerOpcionesPorPasos`), y la
 * autorización bajo el mínimo NO se deshace: se retira, con su registro.
 */
export async function deshacerPorPasos(op: OperacionDeshacer): Promise<ResultadoPorPasos<{ valorTotal: number | null }>> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  if (!op || typeof op !== 'object' || typeof op.cotizacionId !== 'string') return { success: false, error: 'Nada que deshacer.' }
  const guard = await exigirPorPasos(supabase, op.cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  const antes = await fotoDeTarifas(supabase, op.cotizacionId)
  if (!antes) return { success: false, error: 'Cotización no encontrada' }
  const cerrar = () => cerrarAccion(supabase, { workspaceId, cotizacionId: op.cotizacionId, antes, staffId })

  switch (op.tipo) {
    case 'eleccion': {
      const fila = antes.filas.find(f => f.id === op.itinerarioId)
      const ranura = ranurasConAlternativas(antes.ctx.items).find(r => r.grupo === normalizarGrupo(op.grupo))
      const hoy = ranura?.candidatos.find(id => fila?.seleccion.includes(id)) ?? null
      if (!fila || !ranura || hoy !== op.escrita) return { success: false, error: YA_CAMBIO }
      if (op.anterior === null || !ranura.candidatos.includes(op.anterior)) return { success: false, error: YA_CAMBIO }
      const { error: eDel } = await supabase.from('itinerario_opciones').delete().eq('itinerario_id', op.itinerarioId).in('item_id', ranura.candidatos)
      if (eDel) return { success: false, error: eDel.message }
      const { error: eIns } = await supabase.from('itinerario_opciones').insert({ itinerario_id: op.itinerarioId, item_id: op.anterior })
      if (eIns) return { success: false, error: eIns.message }
      return cerrar()
    }
    case 'mandar': {
      const fila = antes.filas.find(f => f.id === op.itinerarioId)
      if (!fila || fila.vaEnPropuesta !== op.escrita || esRecomendada(fila.nombre)) return { success: false, error: YA_CAMBIO }
      const { error: e } = await supabase.from('cotizacion_itinerarios').update({ va_en_propuesta: op.anterior }).eq('id', op.itinerarioId)
      if (e) return { success: false, error: e.message }
      return cerrar()
    }
    case 'margen': {
      const { data: cot } = await supabase.from('cotizaciones').select('margen_porcentaje').eq('id', op.cotizacionId).maybeSingle()
      if (Number(cot?.margen_porcentaje) !== op.escrito) return { success: false, error: YA_CAMBIO }
      const { error: e } = await supabase.from('cotizaciones').update({ margen_porcentaje: op.anterior }).eq('id', op.cotizacionId)
      if (e) return { success: false, error: e.message }
      return cerrar()
    }
    case 'estado': {
      const g = normalizarGrupo(op.grupo)
      const lineas = antes.ctx.items.filter(i => normalizarGrupo(i.grupo ?? null) === g && i.es_ajuste !== true)
      const ids = Object.keys(op.anterior ?? {})
      if (ids.length === 0 || lineas.length !== ids.length) return { success: false, error: YA_CAMBIO }
      const { data: filas } = await supabase.from('items').select('*').in('id', ids).eq('cotizacion_id', op.cotizacionId)
      const porId = new Map(((filas ?? []) as Record<string, unknown>[]).map(f => [f.id as string, f]))
      for (const id of ids) {
        const f = porId.get(id)
        if (!f || estadoDeLinea({ grupo: g, entra_al_precio: f.entra_al_precio as boolean | null, mostrar_en_sugeridos: f.mostrar_en_sugeridos as boolean | null }) !== op.escrito) {
          return { success: false, error: YA_CAMBIO }
        }
      }
      for (const id of ids) {
        const f = porId.get(id)!
        const cambios = cambiosDeEstado({ grupo: g, entra_al_precio: f.entra_al_precio as boolean | null, mostrar_en_sugeridos: f.mostrar_en_sugeridos as boolean | null }, op.anterior[id])
        if (!cambios) continue
        const tarifa = { ...((f.tarifa_pax && typeof f.tarifa_pax === 'object' ? f.tarifa_pax : {}) as Record<string, unknown>) }
        if (cambios.noVa) tarifa.noVa = { era: cambios.noVa.era, por: null, porId: null, en: new Date().toISOString() }
        else delete tarifa.noVa
        const patch: Record<string, unknown> = {
          entra_al_precio: cambios.entra_al_precio,
          mostrar_en_sugeridos: cambios.mostrar_en_sugeridos,
          ...(f.tarifa_pax || cambios.noVa ? { tarifa_pax: tarifa } : {}),
        }
        const { error: e } = await supabase.from('items').update(patch).eq('id', id)
        if (e) return { success: false, error: e.message }
      }
      return cerrar()
    }
    case 'mover':
    case 'juntar': {
      const ids = op.tipo === 'mover' ? [op.itemId] : op.movidas
      const escrito = normalizarGrupo(op.grupoEscrito)
      if (ids.length === 0 || ids.some(id => normalizarGrupo(antes.ctx.items.find(i => i.id === id)?.grupo ?? null) !== escrito)) {
        return { success: false, error: YA_CAMBIO }
      }
      for (const id of ids) {
        const r = await actualizarRanuraDeItem(id, { grupo: op.grupoAnterior })
        if (!r.success) return { success: false, error: r.error ?? 'No se pudo deshacer.' }
      }
      return cerrar()
    }
    default:
      return { success: false, error: 'Nada que deshacer.' }
  }
}

// ── Autorización bajo el mínimo (Noor, Paso 2; P6 y P7) ──────────────────────

/**
 * «Pedir autorización a {dueño}». Queda en la actividad del negocio y le llega al dueño del
 * workspace por la tabla `notificaciones` (P7 de la nota técnica). Quién autoriza sale de la
 * configuración del workspace (el rol de dueño), nunca de un nombre escrito en el código.
 */
export async function pedirAutorizacionPorPasos(cotizacionId: string): Promise<ResultadoPorPasos<{ a: string | null; notificado: boolean }>> {
  const { supabase, workspaceId, staffId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const guard = await exigirPorPasos(supabase, cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  const servicio = createServiceClient()
  const salida = await evaluarSalida(supabase, { servicio: () => servicio, workspaceId, cotizacionId })
  if (!salida || !salida.aplica || !salida.bloquea || !salida.bajoPiso) {
    return { success: false, error: 'Esta cotización no está bajo el margen mínimo: no hay nada que pedir.' }
  }
  const { data: cot } = await supabase.from('cotizaciones').select('codigo, consecutivo, negocio_id').eq('id', cotizacionId).maybeSingle()
  const negocioId = (cot?.negocio_id ?? null) as string | null
  if (!negocioId) return { success: false, error: 'La cotización no tiene negocio.' }
  const codigo = (cot?.codigo || cot?.consecutivo || 'la cotización') as string
  const detalle = (salida.medicion?.bajoPiso ?? [])
    .map(s => `${s.tipo === 'tarifa' ? `tarifa ${s.nombre}` : 'cotización'} al ${s.margenRealPct === null ? 'sin margen medible' : pctTexto(s.margenRealPct, salida.medicion!.pisoPct)}`)
    .join(', ')
  const log = await registrarActividad(supabase, {
    workspace_id: workspaceId,
    entidad_tipo: 'negocio',
    entidad_id: negocioId,
    tipo: 'cambio',
    autor_id: staffId,
    campo_modificado: 'excepcion_margen',
    valor_anterior: null,
    valor_nuevo: 'pedida',
    contenido: recortarParaLog(`Pidió autorización para enviar ${codigo} bajo el margen mínimo (${detalle}).`),
  }, 'pedirAutorizacionPorPasos')
  if (!log.ok) return { success: false, error: 'No se pudo registrar el pedido. Vuelve a intentarlo.' }

  // A quién le llega: los dueños del workspace (el rol, no una persona del código).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const svc = servicio as any
  const { data: duenos } = await svc.from('profiles').select('id').eq('workspace_id', workspaceId).eq('role', 'owner').eq('platform_admin', false)
  const destinatarios = ((duenos ?? []) as { id: string }[]).map(d => d.id)
  // P7 (H8 de la verificación D) · si la notificación no se escribe, la pantalla no puede decir
  // «le llega en sus notificaciones»: el pedido quedó en la actividad, y eso es lo que se dice.
  let notificado = false
  if (destinatarios.length > 0) {
    const { error: errNot } = await svc.from('notificaciones').insert(destinatarios.map(id => ({
      workspace_id: workspaceId,
      destinatario_id: id,
      tipo: 'aprobacion_pendiente',
      estado: 'pendiente',
      contenido: recortarParaLog(`Te piden autorizar ${codigo} bajo el margen mínimo (${detalle}).`, 500),
      entidad_tipo: 'negocio',
      entidad_id: negocioId,
      deep_link: `/negocios/${negocioId}/cotizacion/${cotizacionId}?paso=tarifas`,
      metadata: { cotizacion_id: cotizacionId, motivo: 'margen_bajo_minimo' },
    })))
    if (errNot) console.error('[por-pasos] no se pudo avisar al dueño:', errNot.message)
    else notificado = true
  }
  return { success: true, a: salida.dueno, notificado }
}

/**
 * «Retirar la autorización» (el dueño): no es un «Deshacer», es otra acción con su registro. La
 * excepción queda perdida con la causa «la retiró» y la cotización vuelve a frenarse.
 */
export async function retirarAutorizacionPorPasos(cotizacionId: string): Promise<ResultadoPorPasos> {
  const { supabase, workspaceId, userId, staffId, role, impersonating, error } = await getWorkspace()
  if (error || !workspaceId || !userId) return { success: false, error: 'No autenticado' }
  const guard = await exigirPorPasos(supabase, cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const servicio = createServiceClient() as any
  const esDueno = esDuenoDelWorkspace({ role, impersonating, platformAdmin: await leerPlatformAdmin(servicio, userId) })
  if (!esDueno) return { success: false, error: 'Solo el dueño del workspace puede retirar la autorización.' }
  const { ultima } = await leerUltimaExcepcion(servicio, workspaceId, cotizacionId)
  if (!ultima || ultima.perdidaAt !== null) return { success: false, error: 'No hay una autorización vigente que retirar.' }
  const { data: marcada, error: errUpd } = await servicio
    .from(TABLA_EXCEPCIONES)
    .update({ perdida_at: new Date().toISOString(), perdida_causa: CAUSA_RETIRADA })
    .eq('id', ultima.id)
    .eq('workspace_id', workspaceId)
    .is('perdida_at', null)
    .select('id')
  if (errUpd) return { success: false, error: errUpd.message }
  if (!Array.isArray(marcada) || marcada.length === 0) return { success: false, error: 'No hay una autorización vigente que retirar.' }
  const { data: cot } = await supabase.from('cotizaciones').select('codigo, consecutivo, negocio_id').eq('id', cotizacionId).maybeSingle()
  if (cot?.negocio_id) {
    await registrarActividad(supabase, {
      workspace_id: workspaceId,
      entidad_tipo: 'negocio',
      entidad_id: cot.negocio_id as string,
      tipo: 'cambio',
      autor_id: staffId,
      campo_modificado: 'excepcion_margen',
      valor_anterior: 'autorizada',
      valor_nuevo: 'retirada',
      contenido: recortarParaLog(`Retiró la autorización para enviar ${(cot.codigo || cot.consecutivo || 'la cotización') as string} bajo el margen mínimo.`),
    }, 'retirarAutorizacionPorPasos')
  }
  return { success: true }
}

/**
 * Si hay un pedido de autorización esperando: el último registro de `excepcion_margen` del
 * negocio dice «pedida» y no hay una autorización posterior. Solo lo lee la forma por pasos.
 */
export async function getPedidoDeAutorizacion(cotizacionId: string): Promise<{ por: string | null; en: string } | null> {
  const { supabase, error } = await getWorkspace()
  if (error) return null
  const { data: cot } = await supabase.from('cotizaciones').select('negocio_id').eq('id', cotizacionId).maybeSingle()
  const negocioId = (cot?.negocio_id ?? null) as string | null
  if (!negocioId) return null
  const { data } = await supabase
    .from('activity_log')
    .select('created_at, valor_nuevo, autor_id')
    .eq('entidad_tipo', 'negocio')
    .eq('entidad_id', negocioId)
    .eq('campo_modificado', 'excepcion_margen')
    .order('created_at', { ascending: false })
    .limit(1)
  const ultimo = (Array.isArray(data) ? data[0] : null) as { created_at: string; valor_nuevo: string | null; autor_id: string | null } | null
  if (!ultimo || ultimo.valor_nuevo !== 'pedida') return null
  let por: string | null = null
  if (ultimo.autor_id) {
    const { data: staff } = await supabase.from('staff').select('full_name').eq('id', ultimo.autor_id).maybeSingle()
    por = ((staff as { full_name?: string | null } | null)?.full_name ?? '').trim() || null
  }
  return { por, en: ultimo.created_at }
}

// ── Enviar ───────────────────────────────────────────────────────────────────

/**
 * «Enviar al cliente» de la forma por pasos. Las guardas de siempre no cambian (criterio N13):
 * después de la regla nueva, envía con `enviarCotizacion`, que es la misma del editor.
 *
 * La regla nueva (aprobada por Mauricio el 2026-10-12, P12): una opción de vuelo o actividad
 * que va al cliente y no trae el precio del niño o del infante impide enviar. Solo aquí, con el
 * interruptor encendido: apagado, el envío de siempre no la conoce.
 *
 * `canal = 'descargado'` es el «Sí, ya se la mandé» tras descargar el PDF (H33).
 */
export async function enviarPorPasos(cotizacionId: string, canal?: 'enviar' | 'descargado'): Promise<ResultadoPorPasos> {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }
  const guard = await exigirPorPasos(supabase, cotizacionId)
  if (!guard.ok) return { success: false, error: guard.error }
  const foto = await fotoDeTarifas(supabase, cotizacionId)
  if (!foto) return { success: false, error: 'Cotización no encontrada' }
  // Primero la autorización de datos del cliente: armar sí, enviar no (reunión del 2026-10-22).
  // Es lo primero que dice la lista única de Revisar.
  const motivoDatos = await motivoAutorizacionParaEnviar(supabase, { workspaceId, negocioId: foto.ctx.negocioId })
  if (motivoDatos) return { success: false, error: motivoDatos }
  const vanAlCliente = foto.filas.filter(f => f.vaEnPropuesta)
  const ids = new Set(
    vanAlCliente.length > 0
      ? vanAlCliente.flatMap(f => itemsDelItinerario(foto.ctx.items, f.seleccion))
      : itemsQueAportanAlTotal(foto.ctx.items),
  )
  const { viaje } = await leerViajeDelNegocio(supabase, foto.ctx.negocioId)
  const motivo = motivoSinPrecioPorPasajero(opcionesSinPrecio(foto.ctx.items, ids, viaje.composicion))
  if (motivo) return { success: false, error: motivo }
  const r = await enviarCotizacion(cotizacionId, canal)
  return r.success ? { success: true } : { success: false, error: r.error ?? 'No se pudo enviar.' }
}
