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
  margenMedible,
  motivoDeRechazo,
  ranurasSinResolver,
  textoDeRechazo,
  type ItemConGrupo,
} from './itinerarios'
import { faltanLasTablasDeItinerarios } from './tolerar-itinerarios'
import { idDelPrincipal } from './tarifas'
import { costoDeRubrosConfirmados } from './rubros-sugeridos'
import { esBaseIvaLinea, type BaseIvaLinea } from '@/lib/fiscal/iva-cotizacion'
import {
  adjuntarAdicionales,
  faltaLaTablaDeAdicionales,
  type Adicional,
  type FilaAdicional,
} from './adicionales'

// El cliente tipado de Supabase obliga a arrastrar medio `database.ts` por cada
// `select`, y ninguna de estas tablas está en los tipos generados todavía.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Supabase = any

/**
 * Las columnas de la cabecera + su selección. Una sola forma para las dos lecturas.
 *
 * ⚠️ `*` y no la lista de columnas, a propósito y por el mismo motivo que los ítems:
 * `motivo_codigo` y `motivo_texto` los agrega una migración que todavía está
 * pendiente, y nombrarlas antes devolvería un **400 sobre toda la tabla** —o sea el
 * editor sin abrir— en vez de llegar `undefined`, que es exactamente el estado de una
 * tarifa sin motivo escrito.
 */
const SELECT_ITINERARIO = '*, itinerario_opciones(item_id)'

export interface FilaItinerario {
  id: string
  cotizacionId: string
  nombre: string | null
  orden: number
  vaEnPropuesta: boolean
  /**
   * ¿Esta tarifa manda sobre `valor_total` y el TOTAL del documento?
   *
   * ⚠️ DERIVADO, no leído de `es_principal`: es la Recomendada que va en la propuesta
   * (`idDelPrincipal`, decisión del 2026-09-22). La columna quedó informativa. Lo
   * resuelven `leerItinerarios` y `leerCabecera`, que ven a las hermanas; una fila suelta
   * sin sus hermanas no puede saberlo.
   */
  esPrincipal: boolean
  seleccion: string[]
  /** Por qué se eligió esta combinación (§3.3). Opcional, nunca bloquea. */
  motivoCodigo: string | null
  motivoTexto: string | null
  /**
   * `false` cuando la fila llegó SIN las columnas del motivo, o sea con la migración
   * pendiente.
   *
   * No es lo mismo que «nadie escribió un motivo»: con la columna ausente la pantalla
   * no puede ofrecer el control, porque guardar devolvería un `42703`. Es la misma
   * distinción que `tablasAusentes` hace un nivel más arriba.
   */
  traeColumnasDeMotivo: boolean
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
  /**
   * Los adicionales DE ESTA VARIANTE (`adicionales.ts`). Vacío en toda línea que no los
   * tenga, que es todo lo que existe hoy y todo lo que no sea de viaje.
   *
   * ⚠️ Cuelgan del ítem. La consecuencia de que cuelguen del ítem y no del grupo es
   * exactamente esto: `cascadaDeItinerario` filtra por los ítems que el itinerario
   * incluye, así que el adicional de la variante descartada **desaparece del total solo**,
   * sin una sola línea de código que lo saque.
   */
  adicionales: Adicional[]
  /**
   * La base del IVA que declara la línea (`items.base_iva`, `iva-cotizacion.ts`). `null`
   * = sigue al workspace. Llega `null` mientras la columna no exista: el `select('*')`
   * la trae `undefined`, y eso es exactamente «sigue al workspace».
   */
  base_iva?: BaseIvaLinea | null
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
  /**
   * ¿El piso se exige en la SALIDA (PDF, Enviar, Aprobar)? Solo en las líneas que
   * declaran el piso en su configuración Y tienen el gate `margen_sobre_piso` en alguna
   * etapa (`piso-salida-datos.ts`). Hoy: «Viaje a medida» de Trappvel.
   *
   * Donde es `true`, una tarifa bajo el piso SÍ se puede marcar para la propuesta: el
   * candado se mueve a la salida, donde el dueño puede autorizarla. Ausente o `false`,
   * todo sigue como antes: el candado está en marcar (R6).
   */
  pisoEnLaSalida?: boolean
  /**
   * El `config_extra` de la línea del negocio, crudo. Lo usa el IVA para reconocer el
   * recargo fijo (`recargo-linea.ts`), que es plata de la agencia aunque no tenga costo.
   * `null` sin negocio o sin línea.
   */
  configLinea?: unknown
  /** El estado de la cotización (`borrador`, `enviada`, `aceptada`…). */
  estado?: string | null
  /**
   * La tarifa que el cliente eligió al aprobar (`cotizaciones.tarifa_aceptada_id`).
   * `null` sin tarifas, sin aprobar, o con la migración pendiente: el `select('*')` la
   * trae `undefined` y eso es exactamente «nadie eligió».
   */
  tarifaAceptadaId?: string | null
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
  /**
   * Puede ir en la propuesta, pero está bajo el piso: solo donde el piso se exige en la
   * salida (`pisoEnLaSalida`). La pantalla lo dice; el PDF sale como borrador y «Enviar»
   * lo rechaza hasta que el dueño lo autorice. Ausente o `null` = nada que decir.
   */
  bajoPiso?: string | null
  /** Por qué se eligió esta combinación (§3.3). Se captura aquí, en la tabla. */
  motivoCodigo: string | null
  motivoTexto: string | null
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
  const idsDeItems = ((filas ?? []) as any[]).map(f => f.id as string)
  const filasAdicionales = await leerAdicionalesDeItems(supabase, idsDeItems)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sinAdicionales = ((filas ?? []) as any[]).map(fila => {
    // R-P1 · los rubros SUGERIDOS no entran al costo hasta que alguien confirme.
    const { numeroDeRubros, costoDeRubros } = costoDeRubrosConfirmados(fila.rubros)
    return {
      id: fila.id as string,
      nombre: (fila.nombre ?? null) as string | null,
      grupo: (fila.grupo ?? null) as string | null,
      opcion_de: (fila.opcion_de ?? null) as string | null,
      es_ajuste: fila.es_ajuste ?? false,
      orden: (fila.orden ?? 0) as number,
      // El segundo interruptor y su condicion del dia. Sin ellos el gate del piso y
      // el total del principal medirian con la sugerencia fuera del precio adentro.
      dia_relativo: (fila.dia_relativo ?? null) as number | null,
      entra_al_precio: (fila.entra_al_precio ?? null) as boolean | null,
      cantidad: fila.cantidad ?? 1,
      subtotal: fila.subtotal ?? 0,
      numeroDeRubros,
      costoDeRubros,
      descuento_porcentaje: fila.descuento_porcentaje ?? 0,
      margen_porcentaje: fila.margen_porcentaje ?? null,
      precio_venta: fila.precio_venta ?? 0,
      precio_manual: fila.precio_manual ?? false,
      base_iva: esBaseIvaLinea(fila.base_iva) ? fila.base_iva : null,
    }
  })

  // ⚠️⚠️ Cada línea recibe SUS adicionales, emparejados por id. Es la decisión del frente
  // y vive en un helper puro justo para que se la pueda ver fallar: emparejar por `grupo`
  // le cobraría a la tarifa que eligió LATAM la maleta que alguien cargó en Avianca.
  const items: ItemDeCotizacion[] = adjuntarAdicionales(sinAdicionales, filasAdicionales)

  // La política de la línea hace falta si la cotización no congeló los umbrales, y la
  // configuración de la línea, para saber si el piso se exige en la salida.
  let politicaLinea: UmbralesMargen = UMBRALES_MARGEN_POR_DEFECTO
  let pisoEnLaSalida = false
  let configLineaLeida: unknown = null
  const negocioId = (cot.negocio_id ?? null) as string | null
  if (negocioId) {
    const { data: negocio } = await supabase
      .from('negocios')
      .select('linea_id, lineas_negocio(config_extra)')
      .eq('id', negocioId)
      .maybeSingle()
    const linea = (negocio as { lineas_negocio?: unknown } | null)?.lineas_negocio
    const fila = Array.isArray(linea) ? linea[0] : linea
    const configLinea = (fila as { config_extra?: unknown } | null)?.config_extra
    configLineaLeida = configLinea ?? null
    if (cot.piso_margen_pct == null || cot.aviso_margen_pct == null) {
      const politica = politicaMargenDeLinea(configLinea)
      politicaLinea = { pisoPct: politica.pisoPct, avisoPct: politica.avisoPct }
    }
    pisoEnLaSalida = await lineaExigePisoEnLaSalida(
      supabase,
      (negocio as { linea_id?: string | null } | null)?.linea_id ?? null,
      configLinea,
    )
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
    pisoEnLaSalida,
    configLinea: configLineaLeida,
    estado: (cot.estado ?? null) as string | null,
    tarifaAceptadaId: (cot.tarifa_aceptada_id ?? null) as string | null,
  }
}

/**
 * ¿La línea exige el piso en la salida? Las dos condiciones de R6: declara el piso en su
 * configuración (`config_extra.margen.piso_pct`) y alguna de sus etapas tiene el gate
 * `margen_sobre_piso`.
 *
 * Si las etapas no se pueden leer, `false`: es el comportamiento de antes, con el candado
 * en marcar la tarifa. Encender la regla nueva por un fallo de lectura le cambiaría el
 * flujo a una línea que no la pidió.
 */
export async function lineaExigePisoEnLaSalida(
  supabase: Supabase,
  lineaId: string | null,
  configLinea: unknown,
): Promise<boolean> {
  if (!lineaId || !lineaDeclaraPiso(configLinea)) return false
  const { data, error } = await supabase
    .from('etapas_negocio')
    .select('config_extra')
    .eq('linea_id', lineaId)
  if (error || !Array.isArray(data)) return false
  return (data as { config_extra?: { gates?: unknown } | null }[]).some(e => {
    const gates = e.config_extra?.gates
    return Array.isArray(gates) && gates.includes('margen_sobre_piso')
  })
}

/** La línea escribió su piso. Sin él rigen los valores de fábrica, que nadie eligió. */
export function lineaDeclaraPiso(configLinea: unknown): boolean {
  const margen = (configLinea as { margen?: { piso_pct?: unknown } } | null | undefined)?.margen
  return !!margen && typeof margen === 'object' && margen.piso_pct !== null && margen.piso_pct !== undefined
}

/**
 * Los adicionales de un juego de líneas, agrupados por variante.
 *
 * ⚠️ **Consulta APARTE, no un embed en el `select` de los ítems.** Un
 * `select('*, item_adicionales(*)')` contra una base sin la tabla devuelve un **400 sobre
 * toda la consulta**: el editor de cotización dejaría de abrir mientras el SQL esté
 * pendiente, y el deploy va antes que el SQL. Aparte, lo peor que pasa es que no haya
 * adicionales, que es exactamente el estado de todo lo que existe hoy (R6).
 *
 * ⚠️ Un error que NO sea «la tabla no existe» se reporta por consola y **también** cae a
 * vacío. Silenciar un `42501` dejaría una línea con adicionales cobrando de menos y
 * indistinguible de una que no tiene ninguno — es el mismo criterio que
 * `leerItinerarios`.
 */
export async function leerAdicionalesDeItems(
  supabase: Supabase,
  itemIds: string[],
): Promise<FilaAdicional[]> {
  if (itemIds.length === 0) return []
  const { data, error } = await supabase
    .from('item_adicionales')
    .select('*')
    .in('item_id', itemIds)
  if (error) {
    if (!faltaLaTablaDeAdicionales(error)) {
      console.error('[adicionales] no se pudieron leer:', error.message)
    }
    return []
  }
  return (data ?? []) as FilaAdicional[]
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
  return conPrincipalPorRegla(((data ?? []) as any[]).map(aFila))
}

/**
 * Las filas con `esPrincipal` resuelto por la regla (`idDelPrincipal`), no por la columna.
 *
 * Es el ÚNICO sitio donde se decide: `valor_total` (`totalDelPrincipal`), el gate
 * (`cascadaVigente`), el PDF (`bloquesParaPDF`), la tabla y la copia leen las filas por
 * aquí. Si alguno leyera `es_principal` crudo, una marca vieja volvería a poner el total
 * del documento en la Económica.
 */
export function conPrincipalPorRegla(filas: FilaItinerario[]): FilaItinerario[] {
  const principal = idDelPrincipal(filas)
  return filas.map(f => ({ ...f, esPrincipal: f.id === principal }))
}

/**
 * Una cabecera con su selección, por id.
 *
 * Lee también a sus hermanas: sin ellas no se puede saber si es la principal (hace falta
 * saber si hay otra «Recomendada»). Son acciones de una tabla, no de cada tecla.
 */
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
  const propia = aFila(data)
  const hermanas = await leerItinerarios(supabase, propia.cotizacionId)
  return hermanas?.find(f => f.id === propia.id) ?? { ...propia, esPrincipal: false }
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
    // Donde el piso se exige en la salida, el margen es el de `margenMedible` —sin costo
    // tampoco hay margen—, el mismo que usa la salida: la tabla no puede dar por buena
    // una tarifa que el PDF va a marcar como borrador. En las demás líneas, como antes.
    margenRealPct: ctx.pisoEnLaSalida === true ? margenMedible(cascada) : cascada.margenRealPct,
    pisoPct: ctx.umbrales.pisoPct,
  })
  // Donde el piso se exige en la SALIDA, bajo el piso deja de impedir marcar la tarifa:
  // el candado pasa al PDF, a «Enviar» y a «Aprobar», donde el dueño puede autorizarla.
  // Si siguiera impidiendo marcarla, la autorización no tendría nada que autorizar —
  // la Económica al 3 % nunca llegaría a la propuesta—. Incompleta sigue bloqueando.
  const bajoPisoSinCandado = ctx.pisoEnLaSalida === true && motivo?.tipo === 'bajo_piso'
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
    bloqueo: motivo && !bajoPisoSinCandado ? textoDeRechazo(motivo) : null,
    bajoPiso: bajoPisoSinCandado && motivo
      ? `${textoDeRechazo(motivo)}. Sale como borrador y no se envía sin la autorización del dueño`
      : null,
    motivoCodigo: fila.motivoCodigo,
    motivoTexto: fila.motivoTexto,
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
    // Provisional: `conPrincipalPorRegla` lo reemplaza con las hermanas a la vista.
    esPrincipal: false,
    seleccion: ((data.itinerario_opciones ?? []) as { item_id: string }[]).map(o => o.item_id),
    motivoCodigo: (data.motivo_codigo ?? null) as string | null,
    motivoTexto: (data.motivo_texto ?? null) as string | null,
    // La PRESENCIA de la clave, no su valor: una tarifa sin motivo escrito llega con
    // `motivo_codigo: null`, y una base sin la migración llega sin la clave.
    traeColumnasDeMotivo: Object.hasOwn(data ?? {}, 'motivo_codigo'),
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
