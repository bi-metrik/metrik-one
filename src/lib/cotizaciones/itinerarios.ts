/**
 * Itinerarios: combinar opciones de una cotización sin duplicarla N veces.
 *
 * ## El problema que resuelve
 *
 * Una agencia cotiza 3 vuelos × 3 hoteles + un traslado fijo. Son nueve precios, y
 * hoy salen de nueve cotizaciones armadas a mano, celda por celda. Medido sobre un
 * caso real (mismo hotel, mismas fechas, dos aerolíneas): AVIANCA deja 13,0% de
 * margen y WINGO 3,1%. Esa diferencia no se ve en ninguna parte.
 *
 * ## Los dos niveles
 *
 *  · **Opción** — una alternativa dentro de un componente (Wingo o Avianca). Es un
 *    `item` con `opcion_de` apuntando al titular y el MISMO `grupo`.
 *  · **Itinerario** — una combinación completa (Wingo + Hard Rock + traslado) con su
 *    propio total y su propio margen.
 *
 * ## La RANURA es el `grupo`, no el titular
 *
 * Decisión de modelo, y no es cosmética. Se podría haber hecho que la ranura fuera el
 * ítem titular y sus opciones colgaran de él; se eligió el `grupo` porque:
 *
 *  · La tabla de combinaciones tiene una COLUMNA por grupo, y una celda elige entre
 *    "las opciones de ese grupo". Si la ranura fuera el titular, dos titulares con el
 *    mismo grupo darían dos columnas para la misma decisión.
 *  · `grupo` es además lo que agrupa la presentación (`vuelo`/`hotel` o `dia-1`/`dia-2`,
 *    §2.5 del diseño). Un solo campo para las dos cosas no se puede desincronizar.
 *
 * `opcion_de` se conserva porque dice DE QUIÉN es alternativa cada opción —que es lo
 * que permite copiarla, ordenarla y borrar el titular arrastrando las suyas— pero no
 * es lo que define la ranura.
 *
 * ## R6 — compatibilidad, la restricción que manda sobre todas
 *
 * Una cotización SIN itinerarios se comporta EXACTAMENTE como hoy: suma todos sus
 * ítems. Termotech, Arca, WMC y las cotizaciones que ya existen no pueden cambiar de
 * precio ni de comportamiento. Todo lo de este archivo es aditivo: sin una fila en
 * `cotizacion_itinerarios`, nada de aquí se ejecuta.
 */

import { calcularCascada, type Cascada, type ItemParaCascada, type ParametrosCascada } from './totales'
import { nivelDeMargen } from './convencion-margen'
import { grupoCombinable } from './ranuras-pantallazo'
import { fueraDelPrecio } from './dia-relativo'

/** Lo mínimo que hace falta de un ítem para saber en qué ranura vive. */
export interface ItemConGrupo {
  id: string
  /** Ranura a la que pertenece. `null` = componente suelto, entra en todo itinerario. */
  grupo?: string | null
  /** Titular del que es alternativa. `null` = es el titular. */
  opcion_de?: string | null
  es_ajuste?: boolean | null
  orden?: number | null
  /**
   * El segundo interruptor y el día, que es una de sus condiciones. Los dos son
   * necesarios para `fueraDelPrecio`: sin el día, una línea con día y marcada fuera
   * del precio saldría del total mientras se imprime en el itinerario.
   *
   * ⚠️ Quien arme un `ItemConGrupo` desde una fila TIENE que pasar los dos. Omitirlos
   * compila (son opcionales, por las lecturas anteriores a la columna) y deja la
   * sugerencia sumando al total. Lo delata el aviso rojo, que se alimenta del mismo
   * juego de ids.
   */
  dia_relativo?: number | null
  entra_al_precio?: boolean | null
}

/**
 * ¿La línea compite por el total? No compiten el cuadre ni una sugerencia fuera del
 * precio.
 *
 * ⚠️ La sugerencia fuera del precio sale ANTES de armar las ranuras, no después. Si
 * entrara como candidata, dos tours en el mismo grupo (uno cobrado y uno ofrecido)
 * formarían una ranura con alternativas, el supuesto tomaría el primero por `orden`, y
 * si el primero es el ofrecido el total se quedaría SIN ninguno de los dos.
 */
function compitePorElTotal(item: ItemConGrupo): boolean {
  if (item.es_ajuste === true) return false
  return !fueraDelPrecio(item)
}

/** Una ranura de la cotización, con sus candidatos ya resueltos. */
export interface Ranura {
  grupo: string
  /** Ids de los ítems que compiten por esta ranura, en orden estable. */
  candidatos: string[]
  /**
   * ¿Abre columna en la tabla de combinaciones?
   *
   * Solo vuelo y hotel (ver `RANURAS_COMBINABLES`). Las demás tienen alternativas y no
   * se cruzan: una de ellas aporta y las otras quedan fuera del total.
   */
  combinable: boolean
}

/**
 * Las ranuras que un itinerario tiene que RESOLVER: las que tienen alternativas.
 *
 * Un grupo con un solo candidato NO es una decisión, es un componente fijo: entra en
 * todos los itinerarios solo (R3) y no ocupa una columna en la tabla. Enumerarlo
 * obligaría a teclear la misma celda en las nueve filas, que es justo el trabajo que
 * este frente viene a quitar.
 *
 * ⚠️ El ítem de ajuste NUNCA es candidato: es cuadre de precio, no un componente que
 * alguien pueda elegir. Dejarlo entrar lo volvería una columna de la tabla.
 */
export function ranurasConAlternativas(items: ItemConGrupo[]): Ranura[] {
  const porGrupo = new Map<string, string[]>()
  for (const item of ordenados(items)) {
    if (!compitePorElTotal(item)) continue
    const grupo = normalizarGrupo(item.grupo)
    if (grupo === null) continue
    const lista = porGrupo.get(grupo) ?? []
    lista.push(item.id)
    porGrupo.set(grupo, lista)
  }
  return [...porGrupo.entries()]
    .filter(([, candidatos]) => candidatos.length > 1)
    .map(([grupo, candidatos]) => ({ grupo, candidatos, combinable: grupoCombinable(grupo) }))
}

/**
 * Las ranuras que SE CRUZAN entre sí: las columnas de la tabla y el producto (T1).
 *
 * Solo vuelo y hotel, por decisión de la reunión del 2026-09-14. El argumento está en
 * `RANURAS_COMBINABLES`; aquí lo que importa es la consecuencia: estas son las únicas
 * que un itinerario tiene que RESOLVER y las únicas que multiplican.
 */
export function ranurasCombinables(items: ItemConGrupo[]): Ranura[] {
  return ranurasConAlternativas(items).filter(r => r.combinable)
}

/**
 * Las ranuras con alternativas que NO se cruzan: tours, traslados, planes, lo propio.
 *
 * Siguen existiendo —nada se borra— y siguen sumando, pero **una sola vez**: la regla
 * de sumarlas todas convertiría dos traslados alternativos en dos traslados cobrados.
 * Cuál aporta lo decide `itemsDelItinerario` y se ANUNCIA como supuesto, igual que la
 * ranura combinable que nadie ha resuelto todavía.
 */
export function ranurasNoCombinables(items: ItemConGrupo[]): Ranura[] {
  return ranurasConAlternativas(items).filter(r => !r.combinable)
}

/**
 * Los ítems que entran en TODO itinerario sin que nadie los elija (R3).
 *
 * Son dos familias y por la misma razón —no hay nada que decidir—: el componente sin
 * grupo (un seguro, un fee) y el grupo con un solo candidato (el traslado único).
 *
 * ⚠️ Un grupo NO combinable CON alternativas (dos tours cargados en la misma ranura)
 * NO es fijo: entra uno solo, y cuál lo resuelve `itemsDelItinerario`. Meterlo aquí
 * sumaría los dos.
 */
export function itemsFijos(items: ItemConGrupo[]): string[] {
  const conAlternativas = new Set(ranurasConAlternativas(items).map(r => r.grupo))
  return ordenados(items)
    .filter(compitePorElTotal)
    .filter(item => {
      const grupo = normalizarGrupo(item.grupo)
      return grupo === null || !conAlternativas.has(grupo)
    })
    .map(item => item.id)
}

/**
 * ¿Qué ranuras le faltan a esta selección para ser un itinerario completo? (R2)
 *
 * Devuelve los GRUPOS sin resolver, no un booleano: la pantalla tiene que poder decir
 * *cuál* falta. Un itinerario incompleto no puede marcarse `va_en_propuesta`, y
 * "incompleto" sin decir de qué es un bloqueo que el usuario no puede levantar.
 *
 * Una selección que nombra DOS opciones del mismo grupo también está mal formada, y
 * cuenta como "sin resolver": el total sumaría los dos vuelos.
 */
export function ranurasSinResolver(items: ItemConGrupo[], seleccion: string[]): string[] {
  const elegidos = new Set(seleccion)
  // Solo las COMBINABLES. Un tour con dos alternativas no deja incompleto a nadie: no
  // es una decisión del itinerario, entra igual en todos. Exigirlo dejaría cada
  // itinerario bloqueado por una columna que la tabla ya no dibuja — o sea un bloqueo
  // que el usuario no tiene desde dónde levantar, que es la trampa que este repo ya
  // pagó con el aviso de recaudo sin salida.
  return ranurasCombinables(items)
    .filter(r => r.candidatos.filter(id => elegidos.has(id)).length !== 1)
    .map(r => r.grupo)
}

/** Un itinerario está completo cuando no le falta ninguna ranura (R2). */
export function itinerarioCompleto(items: ItemConGrupo[], seleccion: string[]): boolean {
  return ranurasSinResolver(items, seleccion).length === 0
}

/**
 * Los ids de los ítems que componen un itinerario: los fijos más lo elegido.
 *
 * El orden respeta el de la cotización, para que la tabla y el PDF listen los
 * componentes como quien cotiza los escribió, no como quien los seleccionó.
 *
 * ⚠️ Una selección que apunte a un ítem que ya no existe (lo borraron) se ignora en
 * vez de romper: el itinerario queda incompleto y la pantalla lo dice, que es la
 * lectura honesta. Reventar aquí dejaría la cotización entera sin poder abrirse.
 */
export function itemsDelItinerario(items: ItemConGrupo[], seleccion: string[]): string[] {
  const elegidos = new Set(seleccion)
  const ranuras = ranurasConAlternativas(items)

  // Qué ítem aporta por cada ranura con alternativas. Para la COMBINABLE manda la
  // selección y punto: si no eligieron, no entra nadie y el itinerario sale incompleto.
  // Para la NO combinable siempre entra exactamente uno — el que la selección nombre
  // si lo nombra (así una combinación ya guardada conserva su traslado y su total no
  // se mueve), y si no, el primero por orden.
  const aporta = new Set<string>()
  for (const ranura of ranuras) {
    if (ranura.combinable) {
      for (const id of ranura.candidatos) if (elegidos.has(id)) aporta.add(id)
      continue
    }
    // ⚠️ `find`, no `filter`: una selección que nombra DOS candidatos del mismo grupo
    // no combinable cobraría los dos. El orden de `candidatos` ya es estable.
    const nombrado = ranura.candidatos.find(id => elegidos.has(id))
    aporta.add(nombrado ?? ranura.candidatos[0])
  }

  const conAlternativas = new Set(ranuras.map(r => r.grupo))
  return ordenados(items)
    // Sin esto, una sugerencia fuera del precio y sin grupo con alternativas pasaría
    // el filtro de abajo como «componente fijo» y sumaría al total.
    .filter(compitePorElTotal)
    .filter(item => {
      const grupo = normalizarGrupo(item.grupo)
      if (grupo === null || !conAlternativas.has(grupo)) return true
      return aporta.has(item.id)
    })
    .map(item => item.id)
}

// ── Qué aporta al total cuando nadie eligió todavía (R-A1) ───────────────────

/**
 * Una ranura resuelta por SUPUESTO: nadie eligió, y el total toma un candidato.
 *
 * Existe para que la pantalla pueda decir *cuál* tomó y *cuáles* dejó fuera. Un aviso
 * que dice «hay una suposición» sin nombrarla no se puede corregir.
 */
export interface RanuraSupuesta {
  grupo: string
  /** El candidato que aporta al total. */
  elegido: string
  /** Los que quedan fuera del total mientras nadie decida. */
  descartados: string[]
  /**
   * ¿El supuesto se puede levantar armando una combinación?
   *
   * `true` en vuelo y hotel: el supuesto dura hasta que alguien marque un itinerario
   * principal. `false` en tour, traslado y demás: ahí el supuesto es **permanente**,
   * porque esas ranuras no entran a la tabla y nadie va a elegir por ellas nunca. La
   * pantalla tiene que decirlo distinto — «arma las combinaciones» sobre un traslado
   * manda a un botón que no lo va a resolver.
   */
  combinable: boolean
}

/**
 * Cómo se resuelve una ranura con alternativas cuando NO hay itinerario principal.
 *
 * ## La regla
 *
 * *«Un ítem con opciones alternativas aporta UNA sola vez al total.»* Cuando hay un
 * itinerario principal, quién aporta lo dice él (R5). Cuando no —la cotización recién
 * armada, dos capturas pegadas en la misma ranura y ninguna combinación construida—
 * aporta el **primer candidato por `orden`**, y se declara como supuesto.
 *
 * ## Por qué el primero y no «ninguno»
 *
 * Las dos alternativas cumplen la regla dura (nunca sumar dos). Se eligió ésta porque
 * los errores que producen no son simétricos:
 *
 *  · **No sumar ninguna** deja el total por DEBAJO del real: la cotización sale sin el
 *    vuelo. Es un documento coherente consigo mismo al que le falta un componente
 *    entero, y el precio que se manda es demasiado bajo. Ésa es exactamente la
 *    dirección que pierde plata y la que este motor existe para evitar (viajes
 *    cerrados al 3,1%, uno con pérdida de -6,5%).
 *  · **Tomar el primero** deja un total completo, con sus líneas cuadrando contra él, y
 *    la única forma de equivocarse es elegir la aerolínea que no era — que se ve en la
 *    propia línea, con su nombre y su precio.
 *
 * ⚠️ NO contradice a `itinerarioPrincipal`, que sigue devolviendo `null` en vez de
 * elegir. Esa pregunta es *«cuál de las combinaciones que alguien construyó fija el
 * precio»*, y ahí la decisión existe y está sin tomar. Aquí no hay combinaciones: hay
 * una ranura que nadie ha mirado, y el supuesto es explícito y reversible.
 *
 * El supuesto se ANUNCIA: quien lo consuma tiene que decirlo.
 *
 * ⚠️ `seleccionSupuesta` DERIVA de `ranurasPorSupuesto` y no al revés. Escritas por
 * separado, las dos tomaban `candidatos[0]` cada una por su cuenta: el día que la
 * regla cambiara, la pantalla anunciaría un supuesto y el total usaría otro. Se vio
 * mutando `seleccionSupuesta` y comprobando que la prueba del aviso seguía en verde.
 */
export function ranurasPorSupuesto(items: ItemConGrupo[]): RanuraSupuesta[] {
  return ranurasConAlternativas(items).map(r => ({
    grupo: r.grupo,
    elegido: r.candidatos[0],
    descartados: r.candidatos.slice(1),
    combinable: r.combinable,
  }))
}

/** Los ids que el total toma por supuesto: uno por ranura. Ver `ranurasPorSupuesto`. */
export function seleccionSupuesta(items: ItemConGrupo[]): string[] {
  return ranurasPorSupuesto(items).map(r => r.elegido)
}

/**
 * Los ítems que aportan al TOTAL de la cotización, sin itinerario principal (R-A1).
 *
 * Los fijos más un candidato por ranura. Es lo que tienen que usar el total en
 * pantalla, `recalcularTotales` y el PDF: si cada uno resolviera esto por su cuenta,
 * el documento del cliente y la pantalla dirían precios distintos del mismo viaje.
 *
 * ⚠️ El ítem de ajuste queda fuera, igual que en `itemsDelItinerario`: es cuadre de
 * precio y su rama vive aparte, antes de llegar aquí.
 */
export function itemsQueAportanAlTotal(items: ItemConGrupo[]): string[] {
  return itemsDelItinerario(items, seleccionSupuesta(items))
}

/**
 * El producto cartesiano de las ranuras: todas las combinaciones posibles (T1).
 *
 * Cada elemento es la selección de UN itinerario. Nadie teclea una combinación a mano.
 *
 * ⚠️ Tope duro de combinaciones. 3×3 son nueve y es el caso real; 6 ranuras de 4
 * opciones son 4.096 filas, y eso no es una tabla que alguien vaya a revisar: es una
 * pantalla colgada y 4.096 inserts. Al pasarse, se devuelve lo que cabe y el llamador
 * avisa — cortar en silencio dejaría combinaciones ausentes que nadie sabría buscar.
 */
export const TOPE_COMBINACIONES = 60

export interface Cartesiano {
  combinaciones: string[][]
  /** `true` si el producto completo no cabía en el tope. */
  truncado: boolean
  /** Cuántas combinaciones habría sin el tope. */
  total: number
}

export function combinacionesCartesianas(items: ItemConGrupo[]): Cartesiano {
  // Solo vuelo y hotel (decisión del 2026-09-14). Con tres vuelos, tres hoteles y dos
  // traslados con alternativas esto devuelve 9 y no 18: el traslado entra en las nueve
  // sin ocupar una columna. El tope sigue vigente porque el producto lo sigue siendo —
  // seis destinos con vuelo y hotel propios lo alcanzan.
  const ranuras = ranurasCombinables(items)
  if (ranuras.length === 0) return { combinaciones: [], truncado: false, total: 0 }

  const total = ranuras.reduce((n, r) => n * r.candidatos.length, 1)

  let combinaciones: string[][] = [[]]
  for (const ranura of ranuras) {
    const siguiente: string[][] = []
    for (const parcial of combinaciones) {
      for (const candidato of ranura.candidatos) {
        if (siguiente.length >= TOPE_COMBINACIONES) break
        siguiente.push([...parcial, candidato])
      }
      if (siguiente.length >= TOPE_COMBINACIONES) break
    }
    combinaciones = siguiente
  }

  return { combinaciones, truncado: total > TOPE_COMBINACIONES, total }
}

/**
 * La cascada de UN itinerario: la misma aritmética, sobre el subconjunto de ítems.
 *
 * `calcularCascada` no se reimplementa ni se copia. Un itinerario es una cotización
 * con menos líneas: si el total por itinerario tuviera su propia fórmula, el día que
 * una cambie habría dos definiciones de margen en la misma pantalla — que es
 * exactamente lo que `margenRealDeLinea` existe para evitar un nivel más abajo.
 */
export function cascadaDeItinerario<T extends ItemConGrupo & ItemParaCascada>(
  items: T[],
  seleccion: string[],
  params: ParametrosCascada,
): Cascada {
  const incluidos = new Set(itemsDelItinerario(items, seleccion))
  return calcularCascada(items.filter(i => incluidos.has(i.id)), params)
}

// ── El piso de margen: aquí sí bloquea ───────────────────────────────────────

/** Por qué un itinerario no puede salir en la propuesta. `null` = sí puede. */
export type MotivoRechazo =
  | { tipo: 'incompleto'; grupos: string[] }
  | { tipo: 'bajo_piso'; margenRealPct: number | null; pisoPct: number }

/**
 * ¿Este itinerario puede marcarse `va_en_propuesta = true`?
 *
 * Dos candados, y el orden importa: primero la completitud (R2) y después el margen
 * (§2.6.4). Un itinerario incompleto tiene un margen que no significa nada —le faltan
 * componentes—, así que reportar "bajo el piso" ahí mandaría a subir un precio cuando
 * lo que falta es elegir el hotel.
 *
 * ⚠️ **Esto es una validación de SERVIDOR, no un aviso de pantalla.** Es la diferencia
 * con el aviso ámbar: la pantalla se puede saltar —una server action exportada es un
 * endpoint alcanzable aunque ningún botón la invoque— y lo que este candado protege es
 * que no salga al cliente una propuesta por debajo del piso.
 *
 * ⚠️ Un margen que NO se puede medir (`null`: sin precio o sin costo) **no pasa**. Es
 * deliberado y es el lado seguro: un itinerario sin costo cargado se ve idéntico a uno
 * regalado, y dejarlo salir por no poder juzgarlo convierte el candado en decorado.
 */
export function motivoDeRechazo(args: {
  ranurasFaltantes: string[]
  margenRealPct: number | null
  pisoPct: number
}): MotivoRechazo | null {
  if (args.ranurasFaltantes.length > 0) {
    return { tipo: 'incompleto', grupos: args.ranurasFaltantes }
  }
  const nivel = nivelDeMargen(args.margenRealPct, { pisoPct: args.pisoPct, avisoPct: args.pisoPct })
  if (nivel === 'bajo_piso' || nivel === 'sin_dato') {
    return { tipo: 'bajo_piso', margenRealPct: args.margenRealPct, pisoPct: args.pisoPct }
  }
  return null
}

/** El motivo, dicho como se le dice a una persona. */
export function textoDeRechazo(motivo: MotivoRechazo): string {
  if (motivo.tipo === 'incompleto') {
    const lista = motivo.grupos.join(', ')
    return motivo.grupos.length === 1
      ? `Falta elegir ${lista}: un itinerario incompleto no puede ir en la propuesta`
      : `Faltan por elegir: ${lista}. Un itinerario incompleto no puede ir en la propuesta`
  }
  const piso = formatoPct(motivo.pisoPct)
  if (motivo.margenRealPct === null) {
    return `Este itinerario todavía no tiene margen medible (sin costo o sin precio) y el piso es ${piso}`
  }
  return `Margen ${formatoPct(motivo.margenRealPct)}, por debajo del piso de ${piso}`
}

/**
 * Un itinerario que YA estaba en la propuesta y dejó de poder estarlo.
 *
 * Se usa después de editar una opción: el itinerario se desmarca y se dice por qué
 * (§2.6.5, "ninguna edición puede dejar un itinerario por debajo del piso duro y
 * marcado para propuesta"). Devolver la lista y no solo el conteo es lo que permite
 * nombrarlos: "se quitó Económica de la propuesta" es accionable, "se quitó 1" no.
 */
export interface DesmarcadoPorEdicion {
  id: string
  nombre: string | null
  motivo: MotivoRechazo
}

// ── Auxiliares ───────────────────────────────────────────────────────────────

/**
 * El grupo, normalizado: vacío y espacios en blanco valen `null`.
 *
 * ⚠️ `''` y `null` tienen que significar lo mismo, o el mismo componente suelto se
 * comporta distinto según si alguien escribió y borró el campo. Es la misma trampa
 * que costó el `??` que no atrapaba la cadena vacía en el nombre de la variante.
 */
export function normalizarGrupo(grupo: string | null | undefined): string | null {
  if (grupo === null || grupo === undefined) return null
  const limpio = grupo.trim()
  return limpio === '' ? null : limpio
}

/** Orden estable: por `orden` y, a igualdad, por id, para que no dependa del azar. */
function ordenados<T extends ItemConGrupo>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const oa = a.orden ?? 0
    const ob = b.orden ?? 0
    if (oa !== ob) return oa - ob
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })
}

function formatoPct(pct: number): string {
  return `${pct.toFixed(1).replace('.', ',')}%`
}

/** Cómo se llama un itinerario sin nombre en el PDF y en la tabla (T6). */
export function nombreDeItinerario(nombre: string | null | undefined, posicion: number): string {
  const limpio = (nombre ?? '').trim()
  return limpio === '' ? `Opción ${posicion}` : limpio
}

/**
 * Cómo se titula un bloque del PDF (R7).
 *
 * ⚠️ La marca del principal NO se agrega si el nombre ya la dice. Quien cotiza llama
 * «Recomendada» a la que recomienda —es el ejemplo del propio diseño— y pegarle el
 * sufijo imprimía **«RECOMENDADA · RECOMENDADA»** en el documento que ve el cliente.
 * Se vio mirando el PDF renderizado, no en una prueba.
 *
 * La comparación va sin tildes y en minúsculas porque el nombre es texto libre:
 * «Recomendada», «RECOMENDADA» y «La recomendada» tienen que contar igual.
 */
export function tituloDeBloquePDF(
  nombre: string | null | undefined,
  esPrincipal: boolean,
  posicion: number,
): string {
  const base = nombreDeItinerario(nombre, posicion)
  const yaLoDice = base
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .includes('recomend')
  return esPrincipal && !yaLoDice ? `${base} · recomendada` : base
}

/**
 * Cuál itinerario manda sobre `cotizaciones.valor_total` (R5).
 *
 * El principal. Si no hay ninguno marcado —una cotización a medio armar, o alguien
 * borró el que lo era— devuelve `null` y el llamador cae al comportamiento de
 * siempre: sumar todos los ítems. Elegir "el primero" en su lugar le cambiaría el
 * precio a la cotización sin que nadie lo haya decidido.
 */
export function itinerarioPrincipal<T extends { id: string; es_principal?: boolean | null }>(
  itinerarios: T[],
): T | null {
  return itinerarios.find(i => i.es_principal === true) ?? null
}
