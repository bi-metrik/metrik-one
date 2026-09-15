/**
 * El DÍA de una línea: un solo interruptor para dos superficies del documento.
 *
 * Decisión de Mauricio del 2026-09-14, textual:
 *
 *   «deben vivir superpuestas, solo que si es itinerario debe darme la opción de
 *    poder asignarle un día dentro de las fechas del viaje. En caso de que no tenga
 *    fecha asignada entra al paquete de sugerido.»
 *
 * Y sobre cómo se guarda, también textual: *«día relativo, que el itinerario se arma
 * antes de fijar fechas»*. Por eso `items.dia_relativo` es un ENTERO (día 1, día 2) y
 * no una fecha de calendario: en un circuito tipo Perú el itinerario se arma semanas
 * antes de que la salida tenga fecha, y una fecha obligaría a inventarla o a dejar el
 * día vacío hasta el final, que es justo cuando ya no sirve para armar nada.
 *
 * ## El itinerario día por día y los sugeridos NO son dos listas
 *
 * Son la misma lista de `items`, y el día decide en qué sección del PDF sale cada uno.
 * Nadie mantiene dos catálogos, y no hay un segundo desplegable de «tipo de sección»:
 * eso sería una segunda fuente para la misma pregunta, y el día que se separen, una
 * línea saldría en las dos partes del documento sin que nada falle.
 *
 * ## Tres reglas que NO son negociables, y por qué
 *
 * **1 · El agrupamiento por día es OPCIONAL.** Si ninguna línea lleva día, la
 * cotización NO se agrupa: ni sección de itinerario ni sección de sugeridos. El PDF
 * sale exactamente como hoy. Es la regla de la reunión del 14 y además es lo que
 * protege a Termotech, Arca y WMC, que cotizan bombas y no viajes. Medido el
 * 2026-09-14 contra producción: **0 de 20 cotizaciones** tienen un solo día asignado,
 * así que hoy este módulo devuelve «nada que agrupar» para toda la base.
 *
 * **2 · La caída a «sugerido» NO es universal.** Un vuelo o un hotel sin día no puede
 * imprimirse como «actividad adicional no incluida»: un vuelo es siempre parte del
 * viaje, y aparecería como no incluido mientras el cliente lo está pagando. La
 * división se toma de `RANURAS_COMBINABLES` —la misma constante que decide qué abre
 * columna en la tabla de combinaciones— y no de una lista nueva: una segunda lista se
 * desincroniza el día que se agregue un sinónimo, y el síntoma sería un vuelo cayendo
 * a «no incluidas» sin que nada falle.
 *
 * **3 · Una línea sin grupo NUNCA cae a sugerida.** Esta es la asimetría que sostiene
 * todo lo demás y conviene decirla completa, porque es la trampa que estuvo cerca:
 * `grupoCombinable(null)` devuelve `false`, así que un criterio escrito solo con esa
 * función habría barrido **todas** las líneas sin grupo a «no incluidas» — y sin grupo
 * están las 37 líneas de Termotech, Arca, WMC y Clarity Express, más el seguro y el
 * fee de cualquier viaje. El grupo es la DECLARACIÓN de que la línea es un componente
 * de un tipo; sin esa declaración, la línea imprime donde imprime hoy.
 *
 * La asimetría resultante es deliberada y va en la dirección segura: una línea sin
 * grupo **sí** puede llevar día (se la mete al itinerario a propósito) pero **no**
 * puede caer a sugerida (nadie la saca del precio por omisión). Meter algo de más al
 * itinerario se ve; sacar algo del documento sin querer, no.
 *
 * ## Lo que este módulo NO decide: el precio
 *
 * El día es PRESENTACIÓN. Asignarlo o quitarlo no mueve un peso del total: quien
 * decide qué aporta sigue siendo `itemsQueAportanAlTotal`, y este archivo no lo toca.
 *
 * Eso deja viva una contradicción, y es el punto de plata del frente: una línea sin
 * día, con grupo no combinable y con precio cargado se imprime como «no incluida»
 * mientras suma al total que el cliente paga. No se arregla sola ni se bloquea en
 * silencio — se avisa con nombre propio (`avisoSugeridosQueCobran`), antes de generar
 * el PDF, donde la comercial mira.
 */

import { grupoCombinable } from './ranuras-pantallazo'

/** Lo mínimo que hace falta de una línea para saber en qué sección del PDF sale. */
export interface ItemConDia {
  id: string
  /** Ranura a la que pertenece. `null` = componente suelto sin declarar. */
  grupo?: string | null
  /**
   * Día del viaje, relativo a la salida: 1 es el primer día. `null` = sin día.
   *
   * ⚠️ `undefined` y `null` significan lo MISMO aquí, y no es casualidad: mientras la
   * columna no esté aplicada toda lectura devuelve `undefined`, y ese caso tiene que
   * comportarse como «sin día» — que es exactamente el comportamiento de hoy.
   */
  dia_relativo?: number | null
  /**
   * ¿Esta sugerencia se le muestra al cliente en el PDF?
   *
   * Solo aplica a las líneas que caen a sugeridas. Ausente cuenta como **sí**: es lo
   * que llega de toda consulta anterior a la columna, y al revés una lectura vieja
   * dejaría el paquete de sugeridos vacío sin que nadie supiera por qué.
   */
  mostrar_en_sugeridos?: boolean | null
  es_ajuste?: boolean | null
  orden?: number | null
}

/** Un día del itinerario, con las líneas que le tocan. */
export interface DiaDelItinerario {
  dia: number
  itemIds: string[]
}

/** Las líneas ordenadas como se leen: por `orden`, y el id desempata. */
function ordenados<T extends { id: string; orden?: number | null }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const oa = a.orden ?? 0
    const ob = b.orden ?? 0
    if (oa !== ob) return oa - ob
    return a.id.localeCompare(b.id)
  })
}

/**
 * El día de una línea, normalizado: entero positivo o `null`.
 *
 * Un 0, un negativo o un decimal no son un día del viaje. Se tratan como ausencia en
 * vez de rechazarse, porque este módulo es el que LEE: el que impide escribirlos es el
 * guard de la server action, y un dato viejo o tocado por SQL no puede tumbar el PDF.
 */
export function diaDeItem(item: ItemConDia): number | null {
  const bruto = item.dia_relativo
  if (bruto === null || bruto === undefined) return null
  if (!Number.isFinite(bruto)) return null
  const n = Math.trunc(bruto)
  if (n !== bruto) return null
  return n >= 1 ? n : null
}

/**
 * ¿Esta línea puede llevar día?
 *
 * Todas menos las combinables (vuelo y hotel) y el ítem de cuadre. Los vuelos y
 * hoteles se cruzan en la tabla de combinaciones (Regla 1 de la reunión del 14): su
 * sitio en el documento lo decide el itinerario elegido, no un día. Y el ítem de
 * ajuste es cuadre de precio, no un componente del viaje.
 */
export function puedeLlevarDia(item: ItemConDia): boolean {
  if (item.es_ajuste === true) return false
  return !grupoCombinable(item.grupo)
}

/**
 * ¿Esta línea puede caer al paquete de sugeridos si se queda sin día?
 *
 * Más estrecho que `puedeLlevarDia` a propósito (regla 3 del encabezado): además de no
 * ser combinable, tiene que DECLARAR un grupo. Sin grupo no hay declaración de que la
 * línea sea un componente ofrecible, y sacarla del documento como «no incluida» sería
 * una afirmación que nadie hizo.
 */
export function puedeSerSugerido(item: ItemConDia): boolean {
  if (item.es_ajuste === true) return false
  const grupo = (item.grupo ?? '').trim()
  if (grupo === '') return false
  return !grupoCombinable(grupo)
}

/**
 * ¿La cotización está organizada por días?
 *
 * Basta UNA línea con día. Es el interruptor entero del frente: mientras devuelva
 * `false`, ni el itinerario ni los sugeridos existen y el documento es el de hoy.
 */
export function hayDiasAsignados(items: ItemConDia[]): boolean {
  return items.some(i => diaDeItem(i) !== null)
}

/**
 * Los días del itinerario, en orden, con sus líneas.
 *
 * Vacío cuando nadie asignó días. Los días se listan **tal como fueron asignados**: si
 * hay día 1 y día 3 y ninguno día 2, se imprimen 1 y 3. Rellenar el hueco inventaría
 * un día vacío en el documento del cliente, y saltarlo renumerando mentiría sobre lo
 * que alguien escribió.
 */
export function diasDelItinerario(items: ItemConDia[]): DiaDelItinerario[] {
  const porDia = new Map<number, string[]>()
  for (const item of ordenados(items)) {
    const dia = diaDeItem(item)
    if (dia === null) continue
    const lista = porDia.get(dia) ?? []
    lista.push(item.id)
    porDia.set(dia, lista)
  }
  return [...porDia.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dia, itemIds]) => ({ dia, itemIds }))
}

/**
 * Las líneas que caen al paquete de sugeridos: «actividades adicionales no incluidas».
 *
 * SOLO si la cotización está organizada por días. Sin un solo día asignado devuelve
 * vacío aunque haya diez tours cargados — porque entonces no es una cotización con
 * itinerario, es la lista plana de siempre, y sus tours están incluidos.
 *
 * ⚠️ Incluye las que tienen el check apagado: quien decide si se imprimen es el PDF,
 * no este helper. Separarlo importa porque el AVISO de dinero tiene que ver también
 * las ocultas — una línea que el cliente no ve y sí paga es peor, no mejor.
 */
export function itemsSugeridos(items: ItemConDia[]): string[] {
  if (!hayDiasAsignados(items)) return []
  return ordenados(items)
    .filter(i => diaDeItem(i) === null && puedeSerSugerido(i))
    .map(i => i.id)
}

/** De los sugeridos, los que el PDF sí imprime (el check encendido, o ausente). */
export function sugeridosVisibles(items: ItemConDia[]): string[] {
  const porId = new Map(items.map(i => [i.id, i]))
  return itemsSugeridos(items).filter(id => porId.get(id)?.mostrar_en_sugeridos !== false)
}

/**
 * Las líneas que imprimen donde imprimen hoy: ni día ni sugerencia.
 *
 * Son los vuelos y hoteles sin día (regla 2), las líneas sin grupo, y todo lo demás
 * cuando la cotización no usa días. El ítem de cuadre entra siempre aquí.
 */
export function itemsSinSeccionPropia(items: ItemConDia[]): string[] {
  const conDia = new Set(diasDelItinerario(items).flatMap(d => d.itemIds))
  const sugeridos = new Set(itemsSugeridos(items))
  return ordenados(items)
    .filter(i => !conDia.has(i.id) && !sugeridos.has(i.id))
    .map(i => i.id)
}

// ── El aviso de dinero ───────────────────────────────────────────────────────

/** Una línea que se imprimiría como «no incluida» mientras el cliente la paga. */
export interface SugeridoQueCobra {
  id: string
  /** Lo que la línea suma al total, ya con cantidad. */
  precioLinea: number
  /** ¿Además está oculta del documento? Entonces el cliente ni la ve. */
  oculta: boolean
}

/** Lo que hace falta de una línea para saber cuánto cobra. */
export interface ItemConPrecio extends ItemConDia {
  precio_venta?: number | null
  cantidad?: number | null
}

/**
 * El aviso obligatorio: sugerencias que están sumando al total.
 *
 * El supuesto que gobierna este frente es **asignar día es incluirlo; dejarlo sin día
 * es ofrecerlo como extra**. Bajo ese supuesto, una línea sin día que aporta al total
 * es una contradicción: el documento dice «no incluida» y la factura la cobra.
 *
 * Deliberadamente NO se arregla sola y NO bloquea. Descontarla del total le cambiaría
 * el precio a una cotización que alguien ya revisó, y bloquear la generación del PDF
 * dejaría a la comercial sin saber qué mover. Se nombra, con su plata, y se ofrecen
 * las dos salidas (asignarle día, o quitarle el precio).
 *
 * `aportanAlTotal` entra por parámetro y sale de `itemsQueAportanAlTotal`: reimplementar
 * aquí quién aporta crearía una segunda regla del mismo dinero, que es el defecto que
 * este producto ya pagó dos veces.
 */
export function avisoSugeridosQueCobran(
  items: ItemConPrecio[],
  aportanAlTotal: Iterable<string>,
): SugeridoQueCobra[] {
  const aportan = new Set(aportanAlTotal)
  const porId = new Map(items.map(i => [i.id, i]))
  return itemsSugeridos(items)
    .filter(id => aportan.has(id))
    .map(id => {
      const item = porId.get(id)
      const precio = Number(item?.precio_venta) || 0
      const cantidad = Number(item?.cantidad) || 1
      return {
        id,
        precioLinea: Math.round(precio * cantidad),
        oculta: item?.mostrar_en_sugeridos === false,
      }
    })
    .filter(s => s.precioLinea !== 0)
}

/**
 * Cómo se rotula un día de cara al cliente.
 *
 * «Día 1», no una fecha: el itinerario se arma antes de que la salida esté fijada, y
 * escribir una fecha derivada de una salida que todavía no existe sería inventarla.
 */
export function etiquetaDeDia(dia: number): string {
  return `Día ${dia}`
}
