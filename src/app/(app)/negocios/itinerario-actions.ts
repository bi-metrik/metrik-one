'use server'

import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { diaDeItem, puedeLlevarDia, puedeSerSugerido } from '@/lib/cotizaciones/dia-relativo'
import { recalcularTotales } from '@/app/(app)/negocios/cotizacion-actions'
import { UMBRALES_MARGEN_POR_DEFECTO, type UmbralesMargen } from '@/lib/cotizaciones/convencion-margen'
import {
  combinacionesCartesianas,
  normalizarGrupo,
  ranurasCombinables,
  ranurasNoCombinables,
  TOPE_COMBINACIONES,
} from '@/lib/cotizaciones/itinerarios'
import {
  calcularItinerario,
  contextoDeCotizacion,
  desmarcarLosQueYaNoPueden,
  leerCabecera,
  leerItinerarios,
  type Desmarcado,
  type ItinerarioCalculado,
} from '@/lib/cotizaciones/itinerarios-datos'

/**
 * Itinerarios de una cotización: leer, combinar y decidir cuáles van al cliente.
 *
 * Vive aparte de `cotizacion-actions.ts` —que ya son 1.100 líneas— y la lógica que
 * toca la base vive un nivel más abajo, en `lib/cotizaciones/itinerarios-datos.ts`,
 * para que `recalcularTotales` pueda reusarla sin cerrar un ciclo entre dos archivos
 * `'use server'`.
 *
 * ## Lo que este archivo protege
 *
 * El piso de margen. §2.6.4 del diseño: *«El servidor RECHAZA marcar
 * `va_en_propuesta` en un itinerario por debajo. No es aviso de pantalla.»* Toda
 * decisión se toma con cifras **recalculadas contra la base**, nunca con las que manda
 * el navegador: una server action exportada es un endpoint alcanzable aunque ningún
 * botón la invoque, y lo que el piso protege es que no salga al cliente una propuesta
 * por debajo de él.
 */

export interface EstadoItinerarios {
  /**
   * Las columnas de la tabla: SOLO vuelo y hotel (decisión del 2026-09-14).
   *
   * Un grupo con alternativas que no es ninguno de los dos no abre columna; sale en
   * `fijosConAlternativas` para que la pantalla pueda decir cuál de sus opciones está
   * sumando, que es lo que un supuesto callado no permite corregir.
   */
  ranuras: { grupo: string; candidatos: { id: string; nombre: string | null }[] }[]
  /**
   * Los grupos con alternativas que NO se cruzan (tour, traslado, plan, lo propio).
   *
   * Entran en todos los itinerarios y aportan UNA vez. `aporta` es el nombre del que
   * suma; `fuera`, los que quedan afuera del total.
   */
  fijosConAlternativas: { grupo: string; aporta: string | null; fuera: string[] }[]
  itinerarios: ItinerarioCalculado[]
  umbrales: UmbralesMargen
  /**
   * `true` cuando las tablas todavía no existen en la base.
   *
   * NO es lo mismo que «esta cotización no tiene itinerarios»: la pantalla lo dice en
   * vez de ofrecer un botón que va a fallar.
   */
  tablasAusentes: boolean
}

// ── Lectura ──────────────────────────────────────────────────────────────────

/**
 * Todo lo que la tabla de combinaciones necesita, ya calculado.
 *
 * Devuelve vacío y `tablasAusentes: true` si la migración no está aplicada. Para la
 * pantalla es indistinguible de «esta cotización no tiene itinerarios» —que es el
 * comportamiento R6— y es lo que evita que el editor deje de abrir mientras la
 * migración esté pendiente.
 */
export async function getEstadoItinerarios(cotizacionId: string): Promise<EstadoItinerarios> {
  const vacio: EstadoItinerarios = {
    ranuras: [],
    fijosConAlternativas: [],
    itinerarios: [],
    umbrales: UMBRALES_MARGEN_POR_DEFECTO,
    tablasAusentes: false,
  }

  const { supabase, error } = await getWorkspace()
  if (error) return vacio

  const ctx = await contextoDeCotizacion(supabase, cotizacionId)
  if (!ctx) return vacio

  const nombreDe = (id: string) => ctx.items.find(i => i.id === id)?.nombre ?? null

  const ranuras = ranurasCombinables(ctx.items).map(r => ({
    grupo: r.grupo,
    candidatos: r.candidatos.map(id => ({ id, nombre: nombreDe(id) })),
  }))

  // El supuesto permanente: en estos grupos aporta el primero por orden y nadie va a
  // elegir por ellos. Se nombra la opción que suma y las que no, porque «hay una
  // suposición» sin decir cuál no se puede corregir.
  const fijosConAlternativas = ranurasNoCombinables(ctx.items).map(r => ({
    grupo: r.grupo,
    aporta: nombreDe(r.candidatos[0]),
    fuera: r.candidatos.slice(1).map(id => nombreDe(id) ?? 'Sin nombre'),
  }))

  const filas = await leerItinerarios(supabase, cotizacionId)
  if (filas === null) {
    return { ...vacio, ranuras, fijosConAlternativas, umbrales: ctx.umbrales, tablasAusentes: true }
  }

  return {
    ranuras,
    fijosConAlternativas,
    umbrales: ctx.umbrales,
    tablasAusentes: false,
    itinerarios: filas.map(fila => calcularItinerario(ctx, fila)),
  }
}

// ── Escritura ────────────────────────────────────────────────────────────────

/**
 * T1 · propone el producto cartesiano de las opciones existentes, ya calculado.
 *
 * T2 · **nacen con `va_en_propuesta = false`.** Ninguna combinación llega al cliente
 * por omisión, ni siquiera la que más margen deja.
 *
 * No borra lo que ya está: solo agrega lo que falta. Regenerar después de sumar un
 * hotel tiene que conservar el nombre y la marca de los itinerarios que alguien ya
 * revisó — borrarlos y rehacerlos perdería ese trabajo en silencio.
 */
export async function generarCombinaciones(cotizacionId: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const ctx = await contextoDeCotizacion(supabase, cotizacionId)
  if (!ctx) return { success: false, error: 'Cotización no encontrada' }

  const { combinaciones, truncado, total } = combinacionesCartesianas(ctx.items)
  if (combinaciones.length === 0) {
    return {
      success: false,
      error: 'No hay opciones que combinar: agrega al menos dos alternativas de vuelo o de hotel. Tours y traslados no se combinan, entran igual en todos los itinerarios.',
    }
  }

  const existentes = await leerItinerarios(supabase, cotizacionId)
  if (existentes === null) return { success: false, error: ERROR_TABLAS_AUSENTES }

  // La huella de una combinación es su selección ordenada: regenerar no duplica lo
  // que ya existe, aunque alguien lo haya renombrado o reordenado.
  const yaEstan = new Set(existentes.map(i => huella(i.seleccion)))
  const nuevas = combinaciones.filter(sel => !yaEstan.has(huella(sel)))

  let orden = existentes.reduce((m, i) => Math.max(m, i.orden), 0)
  let creadas = 0
  for (const seleccion of nuevas) {
    orden += 1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: fila, error: errIns } = await (supabase as any)
      .from('cotizacion_itinerarios')
      .insert({
        workspace_id: workspaceId,
        cotizacion_id: cotizacionId,
        nombre: null,
        orden,
        va_en_propuesta: false,
        es_principal: false,
      })
      .select('id')
      .single()
    if (errIns || !fila) {
      return { success: false, error: errIns?.message ?? 'No se pudo crear el itinerario' }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: errVin } = await (supabase as any)
      .from('itinerario_opciones')
      .insert(seleccion.map(itemId => ({ itinerario_id: fila.id, item_id: itemId })))
    if (errVin) return { success: false, error: errVin.message }
    creadas += 1
  }

  revalidarCotizacion(ctx.negocioId, ctx.oportunidadId)
  return {
    success: true,
    creadas,
    yaExistian: combinaciones.length - nuevas.length,
    aviso: truncado
      ? `Son ${total} combinaciones posibles y se generaron las primeras ${TOPE_COMBINACIONES}. Reduce las alternativas de algún grupo para verlas todas.`
      : null,
  }
}

/**
 * T3 · cambiar una celda recalcula ESA fila. Las demás no se tocan.
 *
 * ⚠️ Si el itinerario estaba en la propuesta y el cambio lo deja bajo el piso, se
 * **desmarca y se dice por qué** (§2.6.5). Bloquear el cambio en su lugar sería peor:
 * dejaría a alguien sin poder corregir una combinación mala.
 */
export async function cambiarOpcionDeItinerario(itinerarioId: string, grupo: string, itemId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const cab = await leerCabecera(supabase, itinerarioId)
  if (!cab) return { success: false, error: 'Itinerario no encontrado' }

  const ctx = await contextoDeCotizacion(supabase, cab.cotizacionId)
  if (!ctx) return { success: false, error: 'Cotización no encontrada' }

  // Solo las combinables: un tour o un traslado no es una celda de esta tabla, así que
  // tampoco se cambia por aquí. Mandar un grupo que no abre columna es un cliente
  // desactualizado o una llamada directa, y en los dos casos la respuesta es la misma.
  const ranura = ranurasCombinables(ctx.items).find(r => r.grupo === normalizarGrupo(grupo))
  if (!ranura) {
    return { success: false, error: `El grupo «${grupo}» no es una columna de la tabla: solo vuelo y hotel se combinan` }
  }
  if (!ranura.candidatos.includes(itemId)) {
    return { success: false, error: 'Esa opción no pertenece a este grupo' }
  }

  // El borrado va acotado a los candidatos de ESA ranura: un `delete` por itinerario
  // se llevaría por delante las otras ranuras.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errDel } = await (supabase as any)
    .from('itinerario_opciones')
    .delete()
    .eq('itinerario_id', itinerarioId)
    .in('item_id', ranura.candidatos)
  if (errDel) return { success: false, error: errDel.message }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errIns } = await (supabase as any)
    .from('itinerario_opciones')
    .insert({ itinerario_id: itinerarioId, item_id: itemId })
  if (errIns) return { success: false, error: errIns.message }

  const desmarcados = await desmarcarLosQueYaNoPueden(supabase, cab.cotizacionId)
  revalidarCotizacion(ctx.negocioId, ctx.oportunidadId)
  return { success: true, desmarcados }
}

/**
 * §2.6.4 · el candado. Aquí el piso de margen RECHAZA.
 *
 * Dos condiciones, comprobadas con cifras recalculadas contra la base: el itinerario
 * tiene que estar completo (R2) y su margen real tiene que llegar al piso congelado
 * de la cotización.
 *
 * Desmarcar no pide nada: sacar algo de la propuesta siempre se puede.
 */
export async function marcarEnPropuesta(itinerarioId: string, vaEnPropuesta: boolean) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const cab = await leerCabecera(supabase, itinerarioId)
  if (!cab) return { success: false, error: 'Itinerario no encontrado' }

  const ctx = await contextoDeCotizacion(supabase, cab.cotizacionId)
  if (!ctx) return { success: false, error: 'Cotización no encontrada' }

  if (vaEnPropuesta) {
    const calculado = calcularItinerario(ctx, cab)
    if (calculado.bloqueo) return { success: false, error: calculado.bloqueo }
  }

  const patch: Record<string, unknown> = { va_en_propuesta: vaEnPropuesta }
  // T5 · el principal TIENE que ir en la propuesta. Sacarlo de la propuesta sin
  // soltar el principal dejaría `valor_total` con el precio de un itinerario que el
  // cliente no va a ver nunca.
  if (!vaEnPropuesta && cab.esPrincipal) patch.es_principal = false

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supabase as any)
    .from('cotizacion_itinerarios')
    .update(patch)
    .eq('id', itinerarioId)
  if (errUpd) return { success: false, error: errUpd.message }

  revalidarCotizacion(ctx.negocioId, ctx.oportunidadId)
  return { success: true, soltoPrincipal: patch.es_principal === false }
}

/**
 * T5 y T7 · exactamente un principal, y tiene que ir en la propuesta.
 *
 * T7 · cuando el cliente elige, se marca ese itinerario como principal y el negocio
 * sigue con ESE costeo: `recalcularTotales` pone su total en `cotizaciones.valor_total`.
 * Los demás quedan como historia de la cotización; no se borran.
 *
 * ⚠️ El principal pasa por el MISMO candado que `va_en_propuesta`. Es el que fija el
 * precio del negocio, así que dejarlo entrar por debajo del piso sería la puerta
 * trasera al control que este frente construye.
 */
export async function marcarPrincipal(itinerarioId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const cab = await leerCabecera(supabase, itinerarioId)
  if (!cab) return { success: false, error: 'Itinerario no encontrado' }

  const ctx = await contextoDeCotizacion(supabase, cab.cotizacionId)
  if (!ctx) return { success: false, error: 'Cotización no encontrada' }

  const calculado = calcularItinerario(ctx, cab)
  if (calculado.bloqueo) return { success: false, error: calculado.bloqueo }

  // Soltar el anterior ANTES de marcar el nuevo: el índice único parcial
  // `idx_itinerario_principal_unico` rechaza dos principales a la vez.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (supabase as any)
    .from('cotizacion_itinerarios')
    .update({ es_principal: false })
    .eq('cotizacion_id', cab.cotizacionId)
    .neq('id', itinerarioId)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supabase as any)
    .from('cotizacion_itinerarios')
    .update({ es_principal: true, va_en_propuesta: true })
    .eq('id', itinerarioId)
  if (errUpd) return { success: false, error: errUpd.message }

  revalidarCotizacion(ctx.negocioId, ctx.oportunidadId)
  return { success: true }
}

/** T6 · el nombre es libre y viaja al PDF. Vacío: el PDF numera. */
export async function renombrarItinerario(itinerarioId: string, nombre: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const limpio = nombre.trim()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supabase as any)
    .from('cotizacion_itinerarios')
    .update({ nombre: limpio === '' ? null : limpio })
    .eq('id', itinerarioId)
  if (errUpd) return { success: false, error: errUpd.message }
  return { success: true }
}

/** Borrar una fila de la tabla. Sus vínculos se van por `on delete cascade`. */
export async function eliminarItinerario(itinerarioId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const cab = await leerCabecera(supabase, itinerarioId)
  if (!cab) return { success: false, error: 'Itinerario no encontrado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errDel } = await (supabase as any)
    .from('cotizacion_itinerarios')
    .delete()
    .eq('id', itinerarioId)
  if (errDel) return { success: false, error: errDel.message }

  const ctx = await contextoDeCotizacion(supabase, cab.cotizacionId)
  revalidarCotizacion(ctx?.negocioId ?? null, ctx?.oportunidadId ?? null)
  return { success: true, eraPrincipal: cab.esPrincipal }
}

/**
 * Re-valida todos los itinerarios y desmarca los que ya no pueden ir a la propuesta.
 *
 * Se llama después de una edición que mueve costos o precios. Es pública porque quien
 * edita un ítem vive en `cotizacion-actions.ts`; lo que hace no depende de quién llame.
 */
export async function revalidarItinerarios(cotizacionId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, desmarcados: [] as Desmarcado[] }
  const desmarcados = await desmarcarLosQueYaNoPueden(supabase, cotizacionId)
  return { success: true, desmarcados }
}

// ── Opciones dentro del ítem (2a) ────────────────────────────────────────────

/**
 * Crea una ALTERNATIVA del ítem: misma ranura, costeo propio.
 *
 * ⚠️ La copia nace **vacía de costo**: sin rubros y con `subtotal` en 0. Una opción es
 * otro proveedor, no una variante del mismo precio — copiarle los rubros al titular
 * dejaría a WINGO costando lo que AVIANCA hasta que alguien se acordara de cambiarlo,
 * y un costo heredado que nadie tocó se ve idéntico a uno verificado.
 *
 * ⚠️ `margen_porcentaje: null`, NUNCA 0. `null` significa «usa el de la cotización»;
 * 0 significa «esta línea va a costo». Es la trampa que ya costó una copia entera
 * vendida a costo al duplicar cotizaciones, y entra aquí por la misma puerta.
 *
 * Si el titular no tenía grupo se le pone uno: sin ranura no hay entre qué elegir, y
 * dos ítems sueltos se sumarían los dos en vez de competir.
 */
export async function agregarOpcionAItem(itemId: string, nombre: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: titular, error: errLeer } = await (supabase as any)
    .from('items')
    .select('id, cotizacion_id, nombre, grupo, opcion_de, unidad, cantidad, es_ajuste')
    .eq('id', itemId)
    .maybeSingle()
  if (errLeer) return { success: false, error: errLeer.message }
  if (!titular) return { success: false, error: 'Ítem no encontrado' }
  if (titular.es_ajuste) return { success: false, error: 'El ítem de ajuste no admite opciones' }

  // Una opción de una opción sigue siendo opción del MISMO titular: la ranura es
  // plana. Anidarlas daría un árbol que la tabla de combinaciones no sabe dibujar.
  const titularReal: string = titular.opcion_de ?? titular.id

  let grupo = normalizarGrupo(titular.grupo)
  if (grupo === null) {
    grupo = grupoSugerido(titular.nombre)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: errGrupo } = await (supabase as any)
      .from('items')
      .update({ grupo })
      .eq('id', titularReal)
    if (errGrupo) return { success: false, error: errGrupo.message }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: ultimo } = await (supabase as any)
    .from('items')
    .select('orden')
    .eq('cotizacion_id', titular.cotizacion_id)
    .order('orden', { ascending: false })
    .limit(1)
  const orden = ((ultimo?.[0]?.orden as number | undefined) ?? 0) + 1

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: creado, error: errIns } = await (supabase as any)
    .from('items')
    .insert({
      cotizacion_id: titular.cotizacion_id,
      nombre: nombre.trim() || `${titular.nombre ?? 'Opción'} (alternativa)`,
      grupo,
      opcion_de: titularReal,
      unidad: titular.unidad ?? null,
      cantidad: titular.cantidad ?? 1,
      subtotal: 0,
      orden,
      margen_porcentaje: null,
      precio_venta: 0,
      precio_manual: false,
    })
    .select('id')
    .single()
  if (errIns) return { success: false, error: errIns.message }

  return { success: true, id: creado?.id as string | undefined, grupo }
}

/** El grupo y la unidad de una línea: los dos campos nuevos de 2a. */
export async function actualizarRanuraDeItem(
  itemId: string,
  updates: { grupo?: string | null; unidad?: string | null },
) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const patch: Record<string, unknown> = {}
  if (updates.grupo !== undefined) patch.grupo = normalizarGrupo(updates.grupo)
  if (updates.unidad !== undefined) {
    const limpia = (updates.unidad ?? '').trim()
    patch.unidad = limpia === '' ? null : limpia
  }
  if (Object.keys(patch).length === 0) return { success: true }

  // Una sugerencia FUERA DEL PRECIO deja de serlo si su grupo pasa a vuelo, a hotel o
  // a nada: `fueraDelPrecio` la ignoraría y la línea volvería a sumar sin que nadie
  // recalcule. Se pide primero devolverla al precio, que sí recalcula.
  if (updates.grupo !== undefined) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: actual } = await (supabase as any)
      .from('items')
      .select('*')
      .eq('id', itemId)
      .maybeSingle()
    if (
      actual?.entra_al_precio === false &&
      !puedeSerSugerido({ id: itemId, grupo: patch.grupo as string | null, es_ajuste: actual.es_ajuste ?? false })
    ) {
      return {
        success: false,
        error: 'Esta línea está fuera del precio. Márcala para que entre al precio antes de cambiarle el grupo.',
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supabase as any).from('items').update(patch).eq('id', itemId)
  if (errUpd) return { success: false, error: errUpd.message }
  return { success: true }
}

/**
 * El DÍA de una línea, el check de si una sugerencia se le muestra al cliente, y el
 * segundo interruptor: si la sugerencia ENTRA AL PRECIO.
 *
 * El día y el check son PRESENTACIÓN: no mueven un peso del total. `entra_al_precio`
 * sí es dinero, y por eso esta función recalcula los totales cuando lo cambia: una
 * server action exportada es un endpoint alcanzable sin la pantalla, y dejar
 * `valor_total` viejo hasta el próximo recálculo sería un total que miente.
 *
 * ⚠️ El guard lee el GRUPO de la base, no del navegador. Una server action exportada
 * es un endpoint alcanzable con cualquier id aunque ningún botón la invoque: si el
 * grupo llegara por parámetro, bastaría mandar `grupo: 'tour'` sobre el id de un vuelo
 * para meterlo al itinerario día por día y sacarlo de la tabla de combinaciones.
 *
 * ⚠️ Los dos guards del segundo interruptor escriben la misma regla que lee
 * `fueraDelPrecio`, para que la base nunca guarde una marca que la lectura ignora:
 *  - Sacar del precio exige una SUGERENCIA: grupo declarado no combinable y sin día.
 *    Un vuelo, un hotel o una línea sin grupo fuera del precio desaparecerían del
 *    documento sin sumar.
 *  - Asignarle día a una línea fuera del precio se rechaza. Con día entra al
 *    itinerario, o sea incluida: el total tendría que moverse solo por un cambio de
 *    presentación, y eso lo decide el interruptor, no el día.
 */
export async function actualizarDiaDeItem(
  itemId: string,
  updates: { dia_relativo?: number | null; mostrar_en_sugeridos?: boolean; entra_al_precio?: boolean },
) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const patch: Record<string, unknown> = {}

  if (updates.dia_relativo !== undefined) {
    const bruto = updates.dia_relativo
    if (bruto === null) {
      patch.dia_relativo = null
    } else {
      // Un 0, un negativo o un decimal no son un día del viaje. Se RECHAZAN aquí (a
      // diferencia de la lectura, que los trata como ausencia): el que escribe sí
      // puede fallar ruidosamente, y guardar un 0 dejaría una línea que la pantalla
      // ve sin día y la base ve con uno.
      if (!Number.isInteger(bruto) || bruto < 1) {
        return { success: false, error: 'El día tiene que ser un número entero desde 1.' }
      }
      patch.dia_relativo = bruto
    }
  }

  if (updates.mostrar_en_sugeridos !== undefined) {
    patch.mostrar_en_sugeridos = updates.mostrar_en_sugeridos === true
  }

  if (updates.entra_al_precio !== undefined) {
    patch.entra_al_precio = updates.entra_al_precio !== false
  }

  if (Object.keys(patch).length === 0) return { success: true }

  // El grupo y el ajuste, leídos de la base. RLS acota la lectura al workspace de la
  // sesión, así que un id ajeno no resuelve y la función corta aquí.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: item, error: errLee } = await (supabase as any)
    .from('items')
    .select('*')
    .eq('id', itemId)
    .maybeSingle()
  if (errLee) return { success: false, error: errLee.message }
  if (!item) return { success: false, error: 'La línea no existe o no es de este workspace.' }

  if (patch.dia_relativo !== undefined && patch.dia_relativo !== null) {
    if (!puedeLlevarDia({ id: itemId, grupo: item.grupo ?? null, es_ajuste: item.es_ajuste ?? false })) {
      // Un vuelo o un hotel se cruzan en la tabla de combinaciones: su sitio en el
      // documento lo decide el itinerario elegido, no un día. El ítem de cuadre es
      // precio, no un componente del viaje.
      return {
        success: false,
        error:
          item.es_ajuste === true
            ? 'La línea de cuadre no lleva día: es ajuste de precio, no un componente del viaje.'
            : 'Los vuelos y los hoteles no llevan día: se comparan en la tabla de combinaciones.',
      }
    }
  }

  // El estado en que quedaría la línea: lo guardado, con el patch encima. Los dos
  // guards del interruptor miran este estado y no las piezas sueltas, porque el día
  // y el interruptor pueden llegar en la misma llamada.
  const quedaria = {
    id: itemId,
    grupo: (item.grupo ?? null) as string | null,
    es_ajuste: (item.es_ajuste ?? false) as boolean,
    dia_relativo: (patch.dia_relativo !== undefined ? patch.dia_relativo : item.dia_relativo ?? null) as number | null,
    entra_al_precio: (patch.entra_al_precio !== undefined ? patch.entra_al_precio : item.entra_al_precio ?? null) as boolean | null,
  }

  const tocaElInterruptor = patch.entra_al_precio !== undefined || patch.dia_relativo !== undefined
  if (tocaElInterruptor && quedaria.entra_al_precio === false) {
    if (!puedeSerSugerido(quedaria)) {
      return {
        success: false,
        error:
          'Solo una sugerencia puede quedar fuera del precio: la línea tiene que declarar un grupo que no sea vuelo ni hotel.',
      }
    }
    if (diaDeItem(quedaria) !== null) {
      return {
        success: false,
        error:
          patch.entra_al_precio === false
            ? 'Una línea con día está en el itinerario, o sea incluida. Quítale el día antes de sacarla del precio.'
            : 'Esta línea está fuera del precio. Márcala para que entre al precio antes de asignarle un día.',
      }
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supabase as any).from('items').update(patch).eq('id', itemId)
  if (errUpd) return { success: false, error: errUpd.message }

  // El interruptor mueve plata: el total, el costo y el margen se rehacen aquí mismo.
  // Mismo patrón que el cargue de pantallazo, que también escribe algo que cambia la
  // cascada y recalcula en el servidor.
  const cambiaElPrecio =
    patch.entra_al_precio !== undefined && patch.entra_al_precio !== (item.entra_al_precio !== false)
  if (cambiaElPrecio && item.cotizacion_id) {
    await recalcularTotales(item.cotizacion_id as string)
  }
  return { success: true }
}

// ── Interno ──────────────────────────────────────────────────────────────────

const ERROR_TABLAS_AUSENTES =
  'Los itinerarios todavía no están disponibles en esta base: falta aplicar la migración 20260914200000_cotizacion_itinerarios.sql'

/** Huella estable de una selección, para no duplicar combinaciones al regenerar. */
function huella(seleccion: string[]): string {
  return [...seleccion].sort().join('|')
}

/**
 * Un grupo de arranque para un ítem que todavía no tiene ranura.
 *
 * Se deriva del nombre cuando se reconoce (vuelo, hotel, traslado, tour, seguro) y
 * cae en el propio nombre de la línea cuando no. Lo importante es que sea ÚNICO: un
 * genérico como «componente» juntaría dos ítems que no compiten entre sí y los
 * volvería alternativas del mismo slot, que es peor que no adivinar nada. Se edita en
 * la tabla.
 */
function grupoSugerido(nombre: string | null): string {
  const texto = (nombre ?? '').toLowerCase()
  const conocidos: [string, string][] = [
    ['vuelo', 'vuelo'],
    ['aére', 'vuelo'],
    ['aere', 'vuelo'],
    ['tiquete', 'vuelo'],
    ['hotel', 'hotel'],
    ['aloja', 'hotel'],
    ['traslado', 'traslado'],
    ['transfer', 'traslado'],
    ['tour', 'tour'],
    ['excursi', 'tour'],
    ['seguro', 'seguro'],
    ['asistencia', 'seguro'],
  ]
  for (const [fragmento, grupo] of conocidos) {
    if (texto.includes(fragmento)) return grupo
  }
  const limpio = (nombre ?? '').trim().toLowerCase().slice(0, 40)
  return limpio === '' ? 'componente' : limpio
}

function revalidarCotizacion(negocioId: string | null, oportunidadId: string | null) {
  if (negocioId) revalidatePath(`/negocios/${negocioId}`)
  if (oportunidadId) revalidatePath(`/pipeline/${oportunidadId}`)
}
