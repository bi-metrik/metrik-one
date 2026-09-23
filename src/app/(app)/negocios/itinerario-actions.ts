'use server'

import { revalidatePath } from 'next/cache'

import { getWorkspace } from '@/lib/actions/get-workspace'
import { diaDeItem, puedeLlevarDia, puedeSerSugerido } from '@/lib/cotizaciones/dia-relativo'
import { recalcularTotales } from '@/app/(app)/negocios/cotizacion-actions'
import { UMBRALES_MARGEN_POR_DEFECTO, type UmbralesMargen } from '@/lib/cotizaciones/convencion-margen'
import {
  normalizarGrupo,
  ranurasCombinables,
  ranurasNoCombinables,
} from '@/lib/cotizaciones/itinerarios'
import {
  choqueDeNombreDeTarifa,
  esRecomendada,
  motivoSinRecomendada,
  renombreDeRanura,
  tarifasQueFaltan,
} from '@/lib/cotizaciones/tarifas'
import { normalizarMotivo } from '@/lib/cotizaciones/motivo-combinacion'
import {
  etiquetaDeRanura,
  grupoDeInstancia,
  resolverRanura,
} from '@/lib/cotizaciones/ranuras-pantallazo'
import {
  calcularItinerario,
  contextoDeCotizacion,
  desmarcarLosQueYaNoPueden,
  leerCabecera,
  leerItinerarios,
  type Desmarcado,
  type ItinerarioCalculado,
} from '@/lib/cotizaciones/itinerarios-datos'
import { nombreDeAlternativa } from '@/lib/cotizaciones/nombre-linea'
import { revisarExcepcionTrasCambio } from '@/lib/cotizaciones/piso-salida-datos'
import { createServiceClient } from '@/lib/supabase/server'

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
  ranuras: {
    grupo: string
    /** Cómo se llama entera, de cara a quien cotiza: «Vuelo 2 · San Andrés a Providencia». */
    etiqueta: string
    /**
     * La parte FIJA del nombre: «Vuelo», «Vuelo 2». No se edita — la decide el catálogo
     * y el ordinal, y cambiarla a mano fundiría dos ranuras.
     */
    prefijo: string
    /** La parte que una persona escribió: «San Andrés a Providencia». `''` = sin nombre. */
    nombre: string
    /** `true` si el grupo resuelve a una ranura del catálogo y se le puede poner nombre. */
    renombrable: boolean
    candidatos: { id: string; nombre: string | null }[]
  }[]
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
  /**
   * Por qué la cotización no puede salir por la regla de la Recomendada
   * (`motivoSinRecomendada`): no existe, está repetida o no va en la propuesta. `null` =
   * todo en orden, o no hay tarifas. La pantalla lo dice donde se arman las tarifas; el
   * rechazo de verdad vive en «Enviar», «Aprobar» y el PDF.
   */
  recomendadaFalta: string | null
  /**
   * La tarifa que el cliente eligió al aprobar, solo mientras la cotización está
   * `aceptada`. `null` en cualquier otro caso.
   */
  aceptadaId: string | null
  /**
   * `true` cuando la base ya tiene las columnas del motivo (§3.3).
   *
   * Mismo criterio que `tablasAusentes` y por el mismo motivo: el deploy va antes que
   * el SQL, y ofrecer un control que va a devolver un `42703` enseña a ignorar los
   * errores de la pantalla. Sin tarifas la pregunta no aplica y vale `false`.
   */
  motivoDisponible: boolean
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
    motivoDisponible: false,
    recomendadaFalta: null,
    aceptadaId: null,
  }

  const { supabase, error } = await getWorkspace()
  if (error) return vacio

  const ctx = await contextoDeCotizacion(supabase, cotizacionId)
  if (!ctx) return vacio

  const nombreDe = (id: string) => ctx.items.find(i => i.id === id)?.nombre ?? null

  const ranuras = ranurasCombinables(ctx.items).map(r => {
    const inst = resolverRanura(r.grupo)
    return {
      grupo: r.grupo,
      etiqueta: etiquetaDeRanura(r.grupo),
      // El prefijo se arma con el MISMO criterio que `etiquetaDeRanura`: la instancia sin
      // nombre. Escribirlo a mano lo desincronizaría el día que el catálogo cambie una
      // etiqueta, y el síntoma sería un encabezado que dice otra cosa que el aviso.
      prefijo: inst ? etiquetaDeRanura(grupoDeInstancia(inst.definicion, { numero: inst.numero })) : r.grupo,
      nombre: inst?.nombre ?? '',
      renombrable: inst !== null,
      candidatos: r.candidatos.map(id => ({ id, nombre: nombreDe(id) })),
    }
  })

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
    recomendadaFalta: motivoSinRecomendada(filas),
    aceptadaId: ctx.estado === 'aceptada' ? ctx.tarifaAceptadaId ?? null : null,
    // `every` y no `some`: si una sola fila llegó sin las columnas, la base no las
    // tiene y el control no se puede ofrecer.
    motivoDisponible: filas.length > 0 && filas.every(f => f.traeColumnasDeMotivo),
    itinerarios: filas.map(fila => calcularItinerario(ctx, fila)),
  }
}

// ── Escritura ────────────────────────────────────────────────────────────────

/**
 * Crea las TRES tarifas con nombre: Económica, Recomendada, Premium.
 *
 * Reemplaza al generador del producto cartesiano (ver la nota en `itinerarios.ts`). Con
 * el viaje a Providencia —dos vuelos y un hotel, dos opciones cada uno— el producto eran
 * ocho filas y lo que se le manda al cliente son tres.
 *
 * ⚠️ **Nacen VACÍAS de selección, y es el hueco del motor (§3 del diseño).** Las tres se
 * arman a mano eligiendo una variante por ranura; cuando exista la propuesta automática,
 * es aquí donde escribirá la elección inicial. Nacer con una elección por defecto sería
 * peor que nacer vacías: una combinación que aparece elegida sin que nadie la eligiera es
 * indistinguible de una revisada.
 *
 * T2 · **nacen con `va_en_propuesta = false`.** Ninguna llega al cliente por omisión.
 *
 * No borra ni renombra lo que ya está. Una cotización que venía del enumerado cartesiano
 * conserva sus filas: quitarlas para dejar la tabla prolija perdería en silencio el
 * nombre y la marca de algo que alguien ya revisó.
 */
export async function armarTarifas(cotizacionId: string) {
  const { supabase, workspaceId, error } = await getWorkspace()
  if (error || !workspaceId) return { success: false, error: 'No autenticado' }

  const ctx = await contextoDeCotizacion(supabase, cotizacionId)
  if (!ctx) return { success: false, error: 'Cotización no encontrada' }

  // Sin ranuras que cruzar las tres tarifas serían idénticas entre sí: la misma línea
  // tres veces con el mismo precio. No es un error del usuario, es que todavía no hay
  // nada que elegir, y se dice cómo se llega a tenerlo.
  const ranuras = ranurasCombinables(ctx.items)
  if (ranuras.length === 0) {
    return {
      success: false,
      error:
        'Todavía no hay nada entre qué elegir: las tres tarifas saldrían iguales. ' +
        'Agrega otra opción a una línea de vuelo o de hotel («Agregar otra opción de vuelo»).',
    }
  }

  const existentes = await leerItinerarios(supabase, cotizacionId)
  if (existentes === null) return { success: false, error: ERROR_TABLAS_AUSENTES }

  const faltan = tarifasQueFaltan(existentes.map(i => i.nombre))

  let orden = existentes.reduce((m, i) => Math.max(m, i.orden), 0)
  let creadas = 0
  for (const nombre of faltan) {
    orden += 1
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error: errIns } = await (supabase as any)
      .from('cotizacion_itinerarios')
      .insert({
        workspace_id: workspaceId,
        cotizacion_id: cotizacionId,
        nombre,
        orden,
        va_en_propuesta: false,
        es_principal: false,
      })
    if (errIns) return { success: false, error: errIns.message }
    creadas += 1
  }

  revalidarCotizacion(ctx.negocioId, ctx.oportunidadId)
  return { success: true, creadas, yaExistian: 3 - faltan.length }
}

/**
 * Le pone NOMBRE a una ranura entera: «Vuelo 2» pasa a «San Andrés a Providencia».
 *
 * ⚠️⚠️ **Mueve TODAS las líneas de esa ranura, y por eso no es la edición del grupo de una
 * línea suelta.** Renombrar el grupo de una sola variante de una ranura con dos la parte
 * en dos ranuras de una variante cada una: las dos pasan a sumar, y el total **se duplica
 * sin que nada falle**. Es el peor error que este modelo puede cometer, así que el
 * renombre es una operación sobre la ranura o no es.
 *
 * El ORDINAL se conserva (`vuelo 2` → `vuelo 2: San Andrés a Providencia`): perderlo
 * haría que la siguiente ranura del tipo volviera a llamarse 2 y se fundiera con ésta.
 *
 * ⚠️ NO necesita el guard de `entra_al_precio` que sí tiene `actualizarRanuraDeItem`, y
 * conviene dejar dicho por qué: el renombre conserva el TIPO, así que `grupoCombinable`
 * devuelve lo mismo antes y después y `fueraDelPrecio` no puede cambiar de opinión sobre
 * ninguna de las líneas. Lo que ese guard protege es el cambio de grupo a otro tipo, que
 * aquí no puede ocurrir por construcción.
 */
export async function renombrarRanura(cotizacionId: string, grupo: string, nombre: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const actual = normalizarGrupo(grupo)
  if (actual === null) return { success: false, error: 'Falta la ranura que se va a renombrar' }

  // Las líneas de la cotización. Hacen falta para las dos cosas: decidir el grupo nuevo
  // (necesita saber qué ranuras ya existen) y saber a cuáles aplicar el cambio.
  const ctx = await contextoDeCotizacion(supabase, cotizacionId)
  if (!ctx) return { success: false, error: 'Cotización no encontrada' }

  const afectadas = ctx.items.filter(i => normalizarGrupo(i.grupo) === actual).map(i => i.id)
  if (afectadas.length === 0) return { success: false, error: 'Esa ranura no tiene líneas' }

  // La decisión vive en el helper puro. Aquí solo se ejecuta.
  const decision = renombreDeRanura(actual, nombre, ctx.items.map(i => i.grupo ?? null))
  if (!decision.ok) return { success: false, error: decision.detalle }
  if (decision.grupo === actual) return { success: true, grupo: actual, sinCambio: true }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supabase as any)
    .from('items')
    .update({ grupo: decision.grupo })
    .in('id', afectadas)
  if (errUpd) return { success: false, error: errUpd.message }

  revalidarCotizacion(ctx.negocioId, ctx.oportunidadId)
  return { success: true, grupo: decision.grupo, lineas: afectadas.length }
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
  await revisarExcepcionDelDueno(supabase, cab.cotizacionId)
  // Si la celda es de la Recomendada, el total del documento se movió.
  await recalcularTotales(cab.cotizacionId)
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

  await revisarExcepcionDelDueno(supabase, cab.cotizacionId)
  // Marcar o sacar la Recomendada decide si hay principal: el total se rehace aquí.
  const recalculo = await recalcularTotales(cab.cotizacionId)
  revalidarCotizacion(ctx.negocioId, ctx.oportunidadId)
  // El recálculo desmarca las tarifas que ya no pueden ir (§2.6.5) y lo devuelve con su
  // motivo. Aquí se botaba: si una tarifa salía de la propuesta al marcar otra, la pantalla
  // no lo decía. Se pasa tal cual para que la tabla lo avise, como ya hace al cambiar una celda.
  const desmarcados = 'desmarcados' in recalculo ? (recalculo.desmarcados ?? []) : []
  return { success: true, soltoPrincipal: patch.es_principal === false, desmarcados }
}

/**
 * La principal NO se elige: es la Recomendada (decisión de Mauricio, 2026-09-22).
 *
 * Hasta ese día esta acción dejaba poner la corona en cualquier tarifa, y el documento
 * decía «el total corresponde a la opción recomendada» con el TOTAL de la Económica. El
 * botón salió de la pantalla; esta acción queda porque una server action exportada es un
 * endpoint alcanzable aunque ningún botón la invoque, y **rechaza toda tarifa que no sea
 * la Recomendada**. Sobre la Recomendada equivale a marcarla para la propuesta: la regla
 * (`idDelPrincipal`) la vuelve principal sola.
 *
 * ⚠️ Pasa por el MISMO candado que `va_en_propuesta`: es la que fija el total del
 * documento, y dejarla entrar incompleta sería la puerta trasera al control.
 */
export async function marcarPrincipal(itinerarioId: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const cab = await leerCabecera(supabase, itinerarioId)
  if (!cab) return { success: false, error: 'Itinerario no encontrado' }

  if (!esRecomendada(cab.nombre)) {
    return {
      success: false,
      error: 'La principal es siempre la tarifa Recomendada: no se elige a mano. Si el cliente pide otra combinación, duplica la cotización y arma la Recomendada con lo que pidió.',
    }
  }

  const ctx = await contextoDeCotizacion(supabase, cab.cotizacionId)
  if (!ctx) return { success: false, error: 'Cotización no encontrada' }

  const calculado = calcularItinerario(ctx, cab)
  if (calculado.bloqueo) return { success: false, error: calculado.bloqueo }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supabase as any)
    .from('cotizacion_itinerarios')
    .update({ va_en_propuesta: true })
    .eq('id', itinerarioId)
  if (errUpd) return { success: false, error: errUpd.message }

  await revisarExcepcionDelDueno(supabase, cab.cotizacionId)
  await recalcularTotales(cab.cotizacionId)
  revalidarCotizacion(ctx.negocioId, ctx.oportunidadId)
  return { success: true }
}

/**
 * T6 · el nombre es libre y viaja al PDF. Vacío: el PDF numera.
 *
 * ⚠️ Desde el 2026-09-22 el nombre también decide cuál manda el total: la «Recomendada».
 * Por eso dos tarifas no pueden quedar con el mismo de los tres nombres
 * (`choqueDeNombreDeTarifa`), y renombrar recalcula: quitarle el nombre a la Recomendada
 * deja la cotización sin principal, y ponérselo a otra se lo da.
 */
export async function renombrarItinerario(itinerarioId: string, nombre: string) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const cab = await leerCabecera(supabase, itinerarioId)
  if (!cab) return { success: false, error: 'Itinerario no encontrado' }

  const limpio = nombre.trim()
  const hermanas = (await leerItinerarios(supabase, cab.cotizacionId)) ?? []
  const choque = choqueDeNombreDeTarifa(limpio, itinerarioId, hermanas)
  if (choque) return { success: false, error: choque }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supabase as any)
    .from('cotizacion_itinerarios')
    .update({ nombre: limpio === '' ? null : limpio })
    .eq('id', itinerarioId)
  if (errUpd) return { success: false, error: errUpd.message }

  await recalcularTotales(cab.cotizacionId)
  return { success: true }
}

/**
 * Por qué se eligió esta combinación (§3.3 del diseño de ranuras).
 *
 * ## Dónde se pide, y por qué aquí
 *
 * §3.2.1 R5: *«Se pide donde se elige, en la tabla, no en un modal al emitir. Un campo
 * obligatorio en el instante de más afán produce veinte motivos basura, que es peor que
 * veinte vacíos.»* Por eso esto es una acción suelta de la tabla y no un paso del PDF.
 *
 * ## Nunca bloquea, y se puede borrar
 *
 * Guardar el motivo no valida nada más: no mira el margen, no mira si la tarifa está
 * completa, no exige que vaya en la propuesta. Mandar los dos campos vacíos lo BORRA
 * —quien se equivocó de fila tiene cómo deshacerlo— y deja los dos en `null`, que es lo
 * mismo que nunca haberlo escrito.
 *
 * ⚠️ El código se valida contra la lista (`normalizarMotivo`): llega de un `select` del
 * navegador, o sea de un endpoint alcanzable, y una categoría inventada ensuciaría la
 * serie que §3.4 agrupa para escribir criterios.
 *
 * ⚠️ El `42703` de la columna ausente se traduce. El SQL de este frente está pendiente
 * y el deploy va antes: sin esto, quien le dé al selector vería el error crudo de
 * Postgres y no sabría que no es culpa suya.
 */
export async function guardarMotivoDeTarifa(
  itinerarioId: string,
  codigo: string | null,
  texto: string | null,
) {
  const { supabase, error } = await getWorkspace()
  if (error) return { success: false, error: 'No autenticado' }

  const motivo = normalizarMotivo(codigo, texto)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error: errUpd } = await (supabase as any)
    .from('cotizacion_itinerarios')
    .update({ motivo_codigo: motivo.codigo, motivo_texto: motivo.texto })
    .eq('id', itinerarioId)
  if (errUpd) {
    if (errUpd.code === '42703' || errUpd.code === 'PGRST204') {
      return {
        success: false,
        error:
          'El motivo todavía no se puede guardar en esta base: falta aplicar la migración '
          + 'del registro de decisiones. La tarifa y su precio funcionan igual.',
      }
    }
    return { success: false, error: errUpd.message }
  }
  return { success: true, motivo }
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
  await revisarExcepcionDelDueno(supabase, cab.cotizacionId)
  // Borrar la Recomendada deja la cotización sin principal: el total vuelve al supuesto.
  await recalcularTotales(cab.cotizacionId)
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
      // El relleno sale de `nombre-linea.ts`, donde también se reconoce: la lectura de un
      // pantallazo solo le pone nombre a una línea que no tiene uno propio.
      nombre: nombre.trim() || nombreDeAlternativa(titular.nombre),
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

/**
 * Cambiar qué tarifas van en la propuesta, o qué opción lleva cada una, cambia lo que el
 * dueño autorizó bajo el mínimo: si había una autorización vigente, aquí se pierde y se
 * anota, con quien hizo el cambio como autor. Sin autorización vigente es una consulta.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function revisarExcepcionDelDueno(supabase: any, cotizacionId: string): Promise<void> {
  // Nunca tumba la acción: corre después de un cambio que ya se guardó.
  try {
    const { workspaceId, staffId } = await getWorkspace()
    if (!workspaceId) return
    await revisarExcepcionTrasCambio(supabase, {
      servicio: createServiceClient,
      workspaceId,
      cotizacionId,
      staffId,
    })
  } catch (e) {
    console.error('[itinerarios] no se pudo revisar la excepción de margen:', e instanceof Error ? e.message : String(e))
  }
}

function revalidarCotizacion(negocioId: string | null, oportunidadId: string | null) {
  if (negocioId) revalidatePath(`/negocios/${negocioId}`)
  if (oportunidadId) revalidatePath(`/pipeline/${oportunidadId}`)
}
