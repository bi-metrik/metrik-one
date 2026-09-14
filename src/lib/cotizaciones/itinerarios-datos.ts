/**
 * Los itinerarios, leídos de la base y ya calculados.
 *
 * Vive aparte de las server actions por dos razones que no son de estilo:
 *
 *  · `recalcularTotales` (en `cotizacion-actions.ts`) necesita saber cuál itinerario
 *    es el principal para poner SU total en `cotizaciones.valor_total` (R5). Si eso
 *    viviera dentro de un archivo `'use server'`, importarlo desde otro cerraría un
 *    ciclo — y peor, un archivo `'use server'` solo puede exportar funciones async,
 *    así que ni siquiera podría compartir un tipo o una constante.
 *  · El cliente de Supabase entra por PARÁMETRO, así que todo esto se puede probar
 *    con un doble que escribe de verdad. Con un doble de solo lectura, «no se
 *    desmarcó» y «se desmarcó y no se ve» son indistinguibles.
 *
 * Nada de aquí se ejecuta sobre una cotización sin itinerarios: es la compatibilidad
 * R6 sostenida desde el dato, no desde un `if` en la pantalla.
 */

import { calcularCascada, type Cascada } from './totales'
import { type ConvencionMargen } from './precio-item'
import {
  politicaMargenDeLinea,
  umbralesDeCotizacion,
  UMBRALES_MARGEN_POR_DEFECTO,
  type UmbralesMargen,
} from './convencion-margen'
import {
  cascadaDeItinerario,
  itemsDelItinerario,
  itemsQueAportanAlTotal,
  motivoDeRechazo,
  ranurasSinResolver,
  textoDeRechazo,
  type ItemConGrupo,
} from './itinerarios'
import { faltanLasTablasDeItinerarios } from './tolerar-itinerarios'
import { costoDeRubrosConfirmados } from './rubros-sugeridos'

// El cliente tipado de Supabase obliga a arrastrar medio `database.ts` por cada
// `select`, y ninguna de estas tablas está en los tipos generados todavía.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

/** Las columnas de la cabecera + su selección. Una sola forma para las dos lecturas. */
const SELECT_ITINERARIO =
  'id, cotizacion_id, nombre, orden, va_en_propuesta, es_principal, itinerario_opciones(item_id)'

export interface FilaItinerario {
  id: string
  cotizacionId: string
  nombre: string | null
  orden: number
  vaEnPropuesta: boolean
  esPrincipal: boolean
  seleccion: string[]
}

export interface ItemDeCotizacion extends ItemConGrupo {
  id: string
  nombre: string | null
  cantidad: number | null
  subtotal: number | null
  numeroDeRubros: number
  costoDeRubros: number
  descuento_porcentaje: number | null
  margen_porcentaje: number | null
  precio_venta: number | null
  precio_manual: boolean | null
}

export interface ContextoCotizacion {
  items: ItemDeCotizacion[]
  params: {
    administrativosPct: number
    margenPct: number | null
    descuentoComercialPct: number | null
    convencionMargen: ConvencionMargen | null
  }
  umbrales: UmbralesMargen
  negocioId: string | null
  oportunidadId: string | null
}

export interface ItinerarioCalculado {
  id: string
  nombre: string | null
  orden: number
  vaEnPropuesta: boolean
  esPrincipal: boolean
  /** La selección VÁLIDA: lo elegido que todavía existe y sigue siendo candidato. */
  seleccion: string[]
  /** Grupos sin resolver (R2). Vacío = completo. */
  ranurasFaltantes: string[]
  costo: number
  precio: number
  margenRealPct: number | null
  /** Por qué NO puede ir en la propuesta. `null` = puede. */
  bloqueo: string | null
}

export interface Desmarcado {
  id: string
  nombre: string | null
  motivo: string
}

/**
 * Todo lo que hace falta para calcular un itinerario, leído de la BASE.
 *
 * Los parámetros de la cascada salen de la fila de `cotizaciones`, que los congeló al
 * nacer — igual que `recalcularTotales`. Los umbrales resuelven la misma precedencia
 * que el editor: manda lo congelado, y la política de la línea solo entra donde la
 * cotización no diga nada.
 *
 * ⚠️ `select('*')` a propósito en los ítems. Si la migración `20260914200000` no está
 * aplicada, `grupo`/`opcion_de`/`unidad` llegan `undefined` y todo cae en «sin
 * grupo», que es exactamente R6. Nombrar las columnas devolvería un 400 y dejaría el
 * editor sin abrir.
 */
export async function contextoDeCotizacion(
  supabase: Supabase,
  cotizacionId: string,
): Promise<ContextoCotizacion | null> {
  const { data: cot } = await supabase
    .from('cotizaciones')
    .select('*')
    .eq('id', cotizacionId)
    .maybeSingle()
  if (!cot) return null

  const { data: filas } = await supabase
    .from('items')
    .select('*, rubros(*)')
    .eq('cotizacion_id', cotizacionId)
    .order('orden')

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const items: ItemDeCotizacion[] = ((filas ?? []) as any[]).map(fila => {
    // R-P1 · los rubros SUGERIDOS no entran al costo hasta que alguien confirme.
    const { numeroDeRubros, costoDeRubros } = costoDeRubrosConfirmados(fila.rubros)
    return {
      id: fila.id as string,
      nombre: (fila.nombre ?? null) as string | null,
      grupo: (fila.grupo ?? null) as string | null,
      opcion_de: (fila.opcion_de ?? null) as string | null,
      es_ajuste: fila.es_ajuste ?? false,
      orden: (fila.orden ?? 0) as number,
      cantidad: fila.cantidad ?? 1,
      subtotal: fila.subtotal ?? 0,
      numeroDeRubros,
      costoDeRubros,
      descuento_porcentaje: fila.descuento_porcentaje ?? 0,
      margen_porcentaje: fila.margen_porcentaje ?? null,
      precio_venta: fila.precio_venta ?? 0,
      precio_manual: fila.precio_manual ?? false,
    }
  })

  // La política de la línea solo hace falta si la cotización no congeló los umbrales.
  let politicaLinea: UmbralesMargen = UMBRALES_MARGEN_POR_DEFECTO
  const negocioId = (cot.negocio_id ?? null) as string | null
  if (negocioId && (cot.piso_margen_pct == null || cot.aviso_margen_pct == null)) {
    const { data: negocio } = await supabase
      .from('negocios')
      .select('lineas_negocio(config_extra)')
      .eq('id', negocioId)
      .maybeSingle()
    const linea = (negocio as { lineas_negocio?: unknown } | null)?.lineas_negocio
    const fila = Array.isArray(linea) ? linea[0] : linea
    const politica = politicaMargenDeLinea((fila as { config_extra?: unknown } | null)?.config_extra)
    politicaLinea = { pisoPct: politica.pisoPct, avisoPct: politica.avisoPct }
  }

  return {
    items,
    params: {
      administrativosPct: (Number(cot.aiu_admin_pct) || 0) + (Number(cot.aiu_imprevistos_pct) || 0),
      margenPct: cot.margen_porcentaje ?? cot.margen_default_pct ?? null,
      descuentoComercialPct: cot.descuento_porcentaje ?? null,
      convencionMargen: (cot.convencion_margen ?? null) as ConvencionMargen | null,
    },
    umbrales: umbralesDeCotizacion(
      { pisoPct: cot.piso_margen_pct, avisoPct: cot.aviso_margen_pct },
      politicaLinea,
    ),
    negocioId,
    oportunidadId: (cot.oportunidad_id ?? null) as string | null,
  }
}

/**
 * Las filas de itinerario de una cotización, con su selección.
 *
 * ⚠️ `null` significa **«no se pudieron leer»**, y no «no hay». Los dos casos que
 * llegan aquí —la migración sin aplicar y un fallo de permisos— se tratan igual del
 * lado del llamador (no hay itinerarios que mostrar) pero solo el segundo se reporta
 * por consola: silenciar un 42501 dejaría una pantalla vacía indistinguible de una
 * cotización sin combinaciones.
 */
export async function leerItinerarios(
  supabase: Supabase,
  cotizacionId: string,
): Promise<FilaItinerario[] | null> {
  const { data, error } = await supabase
    .from('cotizacion_itinerarios')
    .select(SELECT_ITINERARIO)
    .eq('cotizacion_id', cotizacionId)
    .order('orden')

  if (error) {
    if (!faltanLasTablasDeItinerarios(error)) {
      console.error('[itinerarios] no se pudieron leer:', error.message)
    }
    return null
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).map(aFila)
}

/** Una cabecera con su selección, por id. */
export async function leerCabecera(
  supabase: Supabase,
  itinerarioId: string,
): Promise<FilaItinerario | null> {
  const { data, error } = await supabase
    .from('cotizacion_itinerarios')
    .select(SELECT_ITINERARIO)
    .eq('id', itinerarioId)
    .maybeSingle()
  if (error || !data) return null
  return aFila(data)
}

/**
 * Costo, precio, margen y veredicto de UN itinerario. Todo derivado, nada guardado.
 *
 * Guardar el total de cada itinerario sería una segunda cifra del mismo dinero que se
 * desincroniza al primer cambio de rubro, y la que la pantalla enseñe no tendría por
 * qué ser la que el candado del piso usó para decidir.
 */
export function calcularItinerario(ctx: ContextoCotizacion, fila: FilaItinerario): ItinerarioCalculado {
  const faltantes = ranurasSinResolver(ctx.items, fila.seleccion)
  const cascada: Cascada = cascadaDeItinerario(ctx.items, fila.seleccion, ctx.params)
  const motivo = motivoDeRechazo({
    ranurasFaltantes: faltantes,
    margenRealPct: cascada.margenRealPct,
    pisoPct: ctx.umbrales.pisoPct,
  })
  // La selección que la pantalla pinta en los desplegables: lo elegido que todavía
  // existe. Un id de un ítem borrado no se devuelve — dejaría una celda apuntando a
  // una opción que no está en su lista.
  const compuesto = new Set(itemsDelItinerario(ctx.items, fila.seleccion))
  return {
    id: fila.id,
    nombre: fila.nombre,
    orden: fila.orden,
    vaEnPropuesta: fila.vaEnPropuesta,
    esPrincipal: fila.esPrincipal,
    seleccion: fila.seleccion.filter(id => compuesto.has(id)),
    ranurasFaltantes: faltantes,
    costo: cascada.costoDeVenta,
    precio: cascada.precioVenta,
    margenRealPct: cascada.margenRealPct,
    bloqueo: motivo ? textoDeRechazo(motivo) : null,
  }
}

/**
 * La cascada VIGENTE de una cotización: la misma cifra que el comercial tiene delante.
 *
 * Con itinerario principal sale de ÉL (R5). Sin principal, de lo que aporta al total
 * (R-A1: cada ranura una sola vez). Es exactamente la regla que aplica el pie del
 * editor, escrita una vez: si el gate del piso midiera por su cuenta, podría frenar un
 * avance citando un margen que la pantalla no muestra en ninguna parte — y contra eso
 * el usuario no tiene nada que hacer.
 *
 * ⚠️ El ítem de cuadre (`es_ajuste`) entra siempre. Es precio real de la cotización,
 * aunque no salga de ninguna ranura; dejarlo fuera subiría o bajaría el margen contra
 * el que se decide.
 */
export function cascadaVigente(ctx: ContextoCotizacion, filas: FilaItinerario[] | null): Cascada {
  // ⚠️ `esPrincipal`, no `itinerarioPrincipal`: ese helper lee la columna CRUDA
  // (`es_principal`) y su tipo la declara opcional, así que pasarle una `FilaItinerario`
  // compila y devuelve `null` SIEMPRE. El síntoma es que el gate mide la suma por
  // supuesto en vez del itinerario elegido — o sea deja avanzar una combinación al
  // 3,1% porque la alternativa cara aporta al total. Lo cazó el doble, no el tipo.
  const principal = filas?.find(f => f.esPrincipal) ?? null
  const aportan = new Set(
    principal
      ? itemsDelItinerario(ctx.items, principal.seleccion)
      : itemsQueAportanAlTotal(ctx.items),
  )
  return calcularCascada(
    ctx.items.filter(i => aportan.has(i.id) || i.es_ajuste === true),
    ctx.params,
  )
}

/**
 * El total del itinerario PRINCIPAL, o `null` si no hay ninguno (R5).
 *
 * `null` es lo que hace que R6 se sostenga: `recalcularTotales` cae a sumar todos los
 * ítems, que es lo que hacía antes de que los itinerarios existieran. Devolver «el
 * primero» en su lugar le cambiaría el precio a la cotización sin que nadie lo haya
 * decidido.
 */
export async function totalDelPrincipal(
  supabase: Supabase,
  cotizacionId: string,
  ctx: ContextoCotizacion,
  /** Las filas ya leídas, si quien llama las tiene. Evita releerlas. */
  filasYaLeidas?: FilaItinerario[] | null,
): Promise<{ precioVenta: number; costoDirecto: number; itinerarioId: string } | null> {
  const filas = filasYaLeidas !== undefined
    ? filasYaLeidas
    : await leerItinerarios(supabase, cotizacionId)
  if (filas === null || filas.length === 0) return null
  const principal = filas.find(f => f.esPrincipal)
  if (!principal) return null
  const cascada = cascadaDeItinerario(ctx.items, principal.seleccion, ctx.params)
  return {
    precioVenta: cascada.precioVenta,
    costoDirecto: cascada.costoDirecto,
    itinerarioId: principal.id,
  }
}

/**
 * Desmarca los itinerarios que están en la propuesta y ya no pueden estarlo (§2.6.5).
 *
 * Se llama después de cualquier edición que mueva costos o precios. *«Ninguna edición
 * puede dejar un itinerario por debajo del piso duro y marcado para propuesta.»*
 *
 * ⚠️ El principal se suelta también. Dejarlo apuntando a un itinerario que salió de la
 * propuesta le dejaría a `cotizaciones.valor_total` un precio que el cliente no va a
 * ver, que es peor que no tener principal.
 *
 * Devuelve **a quiénes** desmarcó y por qué, no cuántos: «se quitó Económica porque
 * quedó al 3,1%» es accionable, «se quitó 1» no.
 */
export async function desmarcarLosQueYaNoPueden(
  supabase: Supabase,
  cotizacionId: string,
  /**
   * El contexto y las filas ya leídos, si quien llama los tiene.
   *
   * ⚠️ No es una micro-optimización: `recalcularTotales` corre en cada tecla del
   * editor, y sin esto esta función volvía a pedir la cotización, sus ítems con
   * rubros y sus itinerarios — cuatro idas y vueltas más por recálculo, en la
   * pantalla más pesada del producto.
   */
  yaLeidos?: { ctx: ContextoCotizacion; filas: FilaItinerario[] | null },
): Promise<Desmarcado[]> {
  const ctx = yaLeidos?.ctx ?? (await contextoDeCotizacion(supabase, cotizacionId))
  if (!ctx) return []
  const filas = yaLeidos !== undefined
    ? yaLeidos.filas
    : await leerItinerarios(supabase, cotizacionId)
  if (filas === null) return []

  const desmarcados: Desmarcado[] = []
  for (const fila of filas) {
    if (!fila.vaEnPropuesta) continue
    const calculado = calcularItinerario(ctx, fila)
    if (!calculado.bloqueo) continue
    await supabase
      .from('cotizacion_itinerarios')
      .update({ va_en_propuesta: false, es_principal: false })
      .eq('id', fila.id)
    desmarcados.push({ id: fila.id, nombre: fila.nombre, motivo: calculado.bloqueo })
  }
  return desmarcados
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function aFila(data: any): FilaItinerario {
  return {
    id: data.id as string,
    cotizacionId: data.cotizacion_id as string,
    nombre: (data.nombre ?? null) as string | null,
    orden: (data.orden ?? 0) as number,
    vaEnPropuesta: data.va_en_propuesta === true,
    esPrincipal: data.es_principal === true,
    seleccion: ((data.itinerario_opciones ?? []) as { item_id: string }[]).map(o => o.item_id),
  }
}

/**
 * Los ítems que el PDF imprime por cada itinerario que va en la propuesta (R7).
 *
 * Devuelve `null` cuando no hay itinerarios o ninguno va en la propuesta: ahí el PDF
 * imprime como hoy, la lista plana de ítems. Es el mismo corte que sostiene R6 y por
 * eso vive aquí y no en la plantilla — una plantilla que decidiera esto tendría que
 * repetir la regla, y hay más de una plantilla.
 */
export async function bloquesParaPDF(
  supabase: Supabase,
  cotizacionId: string,
): Promise<{ nombre: string | null; orden: number; esPrincipal: boolean; itemIds: string[]; precio: number }[] | null> {
  const ctx = await contextoDeCotizacion(supabase, cotizacionId)
  if (!ctx) return null
  const filas = await leerItinerarios(supabase, cotizacionId)
  if (filas === null) return null

  const enPropuesta = filas.filter(f => f.vaEnPropuesta)
  if (enPropuesta.length === 0) return null

  // El principal primero (R7), y el resto por su orden.
  const ordenadas = [...enPropuesta].sort((a, b) => {
    if (a.esPrincipal !== b.esPrincipal) return a.esPrincipal ? -1 : 1
    return a.orden - b.orden
  })

  return ordenadas.map(fila => ({
    nombre: fila.nombre,
    orden: fila.orden,
    esPrincipal: fila.esPrincipal,
    itemIds: itemsDelItinerario(ctx.items, fila.seleccion),
    precio: cascadaDeItinerario(ctx.items, fila.seleccion, ctx.params).precioVenta,
  }))
}
