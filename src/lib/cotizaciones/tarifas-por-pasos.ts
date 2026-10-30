/**
 * TODA OPCIÓN EN TARIFAS (pieza C2 de la cotización integrada): qué escribe la forma por pasos
 * en las tarifas después de cada acción. Puro: recibe el antes y el después y devuelve el plan
 * de escrituras. Lo ejecuta `por-pasos-actions.ts`, solo con el interruptor encendido.
 *
 * ## El principio
 *
 * Nada de aquí cambia cómo se LEE una tarifa. El total, el PDF, el IVA y la aprobación siguen
 * pasando por `itemsDelItinerario` e `idDelPrincipal`, encendido o apagado (nota técnica de
 * Max §0). Lo que la forma nueva hace es dejar el DATO de modo que esa lectura dé lo que la
 * pantalla nueva promete:
 *
 *  1. **Cada servicio con opciones tiene su elección en cada tarifa**, vuelo, hotel, traslado o
 *     actividad, sin distinción (decisión 3 del diseño). Ninguna tarifa queda incompleta
 *     (riesgo R1, criterio P1).
 *  2. **La Recomendada siempre va** (decisión E): `va_en_propuesta = true` escrito como dato,
 *     nunca como regla de lectura.
 *  3. **Propuesta de ONE (decisión A)** para lo que se pega: Económica = la opción más barata,
 *     Recomendada = la intermedia por precio en vuelos y hoteles (`indiceRecomendada`, decisión
 *     de Mauricio 2026-10-29) y la primera que se pegó en traslados y actividades, Premium = la
 *     más cara. Mientras la asesora no
 *     cambie la elección de una tarifa, la propuesta se rehace cuando el servicio gana o pierde
 *     opciones (es lo que hace el prototipo: la elección por defecto es «viva»).
 *  4. **Al escribir se guarda lo que hoy cuenta** (criterio N8): en un traslado o actividad que
 *     una tarifa vieja no nombra, cuenta la primera por orden, y eso es lo que se guarda, no la
 *     propuesta de ONE. Abrir no escribe; la Económica no cambia de precio por abrirla.
 *  5. **Una tarifa idéntica a otra no se manda** (decisión C, criterio P8).
 *  6. **Si las únicas opciones son de traslados o actividades**, no se crean Económica ni
 *     Premium (decisión Max 4, criterio P9): la elección queda en la Recomendada.
 *
 * El candado del margen mínimo no se toca aquí: una tarifa bajo el mínimo NO sale sola de la
 * propuesta (decisión L). En la línea de viaje el piso se exige en la salida
 * (`pisoEnLaSalida`) y el recálculo solo desmarca lo incompleto, que con (1) no ocurre.
 */

import {
  itemsDelItinerario,
  itemsFijos,
  ranurasConAlternativas,
  type ItemConGrupo,
} from './itinerarios'
import { cabeConLosHoteles, hotelesAsociados, opcionParaLosHoteles } from './va-con-hotel'
import { claveTarifa, esIntermedia, esRecomendada, NOMBRES_TARIFA, recomendadaDe, TARIFA_INTERMEDIA, type NombreTarifa } from './tarifas'
import { ranuraDeGrupo } from './ranuras-pantallazo'
import { indiceRecomendada } from './recomendada-por-precio'

/** Una tarifa como la ve el plan. */
export interface TarifaDelPlan {
  id: string
  nombre: string | null
  orden: number
  vaEnPropuesta: boolean
  seleccion: string[]
}

/** La cotización en un instante: sus líneas (con su costo, para la propuesta) y sus tarifas. */
export interface EstadoDeTarifas {
  items: (ItemConGrupo & { costo?: number | null })[]
  tarifas: TarifaDelPlan[]
}

export interface TarifaNueva {
  /**
   * Una de las tres, o `null` (la plantilla la numera «Opción N»): la de cada paquete de bloqueo que
   * no es la Recomendada (D5, `planDeTarifasDeBloqueo`).
   */
  nombre: NombreTarifa | typeof TARIFA_INTERMEDIA | null
  orden: number
  vaEnPropuesta: boolean
  seleccion: string[]
}

export interface CambioDeSeleccion {
  itinerarioId: string
  quitar: string[]
  poner: string[]
}

export interface PlanDeTarifas {
  crear: TarifaNueva[]
  seleccion: CambioDeSeleccion[]
  marcas: { itinerarioId: string; vaEnPropuesta: boolean }[]
  /** Premium ⇄ Intermedia (`repartoPorPrecio`). Ausente = ningún nombre cambia. */
  nombres?: { itinerarioId: string; nombre: string }[]
}

const vacio = (): PlanDeTarifas => ({ crear: [], seleccion: [], marcas: [] })

export function planVacio(p: PlanDeTarifas): boolean {
  return p.crear.length === 0 && p.seleccion.length === 0 && p.marcas.length === 0 && (p.nombres?.length ?? 0) === 0
}

/** ¿Con qué nombre del catálogo coincide esta tarifa? `null` = tarifa extra o sin nombre. */
function nombreCanonico(nombre: string | null): NombreTarifa | null {
  const k = claveTarifa(nombre)
  return NOMBRES_TARIFA.find(n => claveTarifa(n) === k) ?? null
}

/**
 * La propuesta de ONE para UNA tarifa en UN servicio (decisión A). Los candidatos vienen por
 * `orden`, así que el primero es «la primera que se pegó». Una opción sin costo no compite por
 * más barata ni por más cara: si ninguna tiene costo, todas proponen la primera.
 *
 * La Recomendada, en un vuelo u hotel (`combinable`), es la intermedia por precio
 * (`indiceRecomendada`, decisión de Mauricio 2026-10-29). En un traslado o una actividad sigue
 * siendo la primera pegada: ahí la Recomendada suele ser la ÚNICA tarifa (P9) y escoger por
 * precio subiría el total solo por pegar una opción más cara (una lancha privada).
 */
export function propuestaDeOne(
  nombre: string | null,
  candidatos: readonly string[],
  costoDe: (id: string) => number | null,
  combinable = true,
): string {
  const canon = nombreCanonico(nombre)
  if (candidatos.length === 0) throw new Error('propuestaDeOne: servicio sin candidatos')
  if (canon === 'Recomendada' && combinable) {
    const conCosto = candidatos
      .map((id, orden) => ({ id, orden, costo: costoDe(id) }))
      .filter((c): c is { id: string; orden: number; costo: number } => c.costo !== null && c.costo > 0)
      .sort((a, b) => (a.costo - b.costo) || (a.orden - b.orden))
    if (conCosto.length === 0) return candidatos[0]
    return conCosto[indiceRecomendada(conCosto.map(c => c.costo))].id
  }
  if (canon !== 'Económica' && canon !== 'Premium') return candidatos[0]
  const conCosto = candidatos
    .map((id, orden) => ({ id, orden, costo: costoDe(id) }))
    .filter((c): c is { id: string; orden: number; costo: number } => c.costo !== null && c.costo > 0)
  if (conCosto.length === 0) return candidatos[0]
  const orden = [...conCosto].sort((a, b) => (a.costo - b.costo) || (a.orden - b.orden))
  if (canon === 'Económica') return orden[0].id
  const max = orden[orden.length - 1].costo
  // La más cara; a igual costo, la primera que se pegó.
  return orden.find(c => c.costo === max)!.id
}

/** La «firma» de una tarifa: qué líneas suma. Dos tarifas con la misma firma son idénticas. */
export function firmaDeTarifa(items: ItemConGrupo[], seleccion: readonly string[]): string {
  return [...itemsDelItinerario(items, [...seleccion])].sort().join('|')
}

/** ¿Hay algún vuelo u hotel con opciones? Sin eso, no hay Económica ni Premium (decisión Max 4). */
export function hayCombinablesConOpciones(items: ItemConGrupo[]): boolean {
  return ranurasConAlternativas(items).some(r => r.combinable)
}

/**
 * La opción que CUENTA hoy en una tarifa para un servicio: la que nombra (la primera por
 * orden si nombra varias, que es la que la lectura toma en un traslado o actividad) y, si no
 * nombra ninguna en un servicio que no se cruza, la primera por orden (el supuesto de hoy).
 * `null` en un vuelo u hotel que la tarifa no nombra: hoy esa tarifa está incompleta.
 */
function laQueCuenta(
  candidatos: readonly string[],
  combinable: boolean,
  seleccion: ReadonlySet<string>,
): string | null {
  const nombrada = candidatos.find(id => seleccion.has(id))
  if (nombrada) return nombrada
  return combinable ? null : candidatos[0] ?? null
}

/**
 * El plan de escrituras. `antes` es la cotización antes de la acción (para saber qué contaba y
 * qué proponía ONE); sin `antes`, la acción no cambió las opciones de ningún servicio.
 */
export function planDeTarifas(args: {
  antes: EstadoDeTarifas | null
  despues: EstadoDeTarifas
  costoDe: (id: string) => number | null
  /** Para la propuesta de ANTES (el costo de una opción ya borrada). Por defecto, `costoDe`. */
  costoAntesDe?: (id: string) => number | null
}): PlanDeTarifas {
  const { despues, costoDe } = args
  const antes = args.antes ?? despues
  const costoAntesDe = args.costoAntesDe ?? costoDe
  const plan = vacio()

  const ranuras = ranurasConAlternativas(despues.items)
  // Viaje en bloqueo con varios paquetes (D5 de Mauricio, 2026-10-29): una tarifa por paquete.
  const paquetes = ranuras.find(r => esRanuraDePaquete(r.grupo))
  if (paquetes) return planDeTarifasDeBloqueo(despues, paquetes.candidatos, args.antes)
  const ranurasAntes = new Map(ranurasConAlternativas(antes.items).map(r => [r.grupo, r]))
  const hayCombinables = ranuras.some(r => r.combinable)

  // ── Qué tarifas tienen que existir ──
  // La Recomendada, siempre que haya algo que escoger. La Económica y la Premium nacen cuando
  // aparece el primer vuelo u hotel con opciones (o la cotización no tiene ninguna tarifa): una
  // que alguien eliminó a propósito no vuelve sola en la acción siguiente.
  const existentes = despues.tarifas
  const hayCombinablesAntes = ranurasConAlternativas(antes.items).some(r => r.combinable)
  const conEconomicaYPremium = hayCombinables && (existentes.length === 0 || !hayCombinablesAntes)
  const necesarias: NombreTarifa[] = ranuras.length === 0 ? [] : conEconomicaYPremium ? [...NOMBRES_TARIFA] : ['Recomendada']
  const yaEsta = new Set(existentes.map(t => claveTarifa(t.nombre)))
  // La Intermedia ocupa el lugar de la Premium (`repartoPorPrecio`).
  if (existentes.some(t => esIntermedia(t.nombre))) yaEsta.add(claveTarifa('Premium'))
  let orden = existentes.reduce((m, t) => Math.max(m, t.orden), 0)
  const porCrear = necesarias.filter(n => !yaEsta.has(claveTarifa(n)))

  // Las tarifas sobre las que se decide: las que ya están y las que se van a crear.
  type Trabajo = { id: string | null; nombre: string | null; orden: number; vaAntes: boolean; seleccionActual: Set<string>; seleccionAntes: Set<string>; nueva: boolean }
  const antesPorId = new Map(antes.tarifas.map(t => [t.id, t]))
  const trabajo: Trabajo[] = [
    ...existentes.map(t => ({
      id: t.id,
      nombre: t.nombre,
      orden: t.orden,
      vaAntes: t.vaEnPropuesta,
      seleccionActual: new Set(t.seleccion),
      seleccionAntes: new Set(antesPorId.get(t.id)?.seleccion ?? t.seleccion),
      nueva: !antesPorId.has(t.id),
    })),
    ...porCrear.map(nombre => ({
      id: null,
      nombre,
      orden: ++orden,
      vaAntes: false,
      seleccionActual: new Set<string>(),
      seleccionAntes: new Set<string>(),
      nueva: true,
    })),
  ]

  // ── La elección de cada tarifa en cada servicio con opciones ──
  const todosLosCandidatos = new Set(ranuras.flatMap(r => r.candidatos))
  const candidatosAntes = new Set([...ranurasAntes.values()].flatMap(r => r.candidatos))
  const seleccionFinal = new Map<Trabajo, string[]>()
  // El traslado que va con un hotel (reunión del 2026-10-22, `va-con-hotel.ts`). Sin asociaciones,
  // vacío: el plan es exactamente el de siempre.
  const asociados = hotelesAsociados(despues.items)
  const asociadosAntes = hotelesAsociados(antes.items)
  const fijosGenerales = asociados.size === 0 ? [] : itemsFijos(despues.items).filter(id => !asociados.has(id))
  for (const t of trabajo) {
    const elegidas: string[] = []
    /** Lo que eligió el plan en cada servicio, y si fue la propuesta de ONE (no una elección). */
    const porServicio: { r: (typeof ranuras)[number]; elegida: string; propuesta: boolean }[] = []
    for (const r of ranuras) {
      const propuestaAhora = propuestaDeOne(t.nombre, r.candidatos, costoDe, r.combinable)
      const previa = ranurasAntes.get(r.grupo)
      // Un servicio que antes no tenía opciones (o no existía): no había nada escogido. Propone ONE.
      if (!previa) { elegidas.push(propuestaAhora); porServicio.push({ r, elegida: propuestaAhora, propuesta: true }); continue }
      const candAntes = previa.candidatos
      const cambiaron = candAntes.length !== r.candidatos.length || candAntes.some(id => !r.candidatos.includes(id))
      // Lo que cuenta: lo que la tarifa nombra ahora. Si no nombra nada: si nombraba una opción
      // que ya no está (la borraron), propone ONE; si nunca nombró nada en un servicio que no se
      // cruza, cuenta la primera por orden (lo implícito de hoy, criterio N8) y eso se guarda.
      let contaba: string | null = r.candidatos.find(id => t.seleccionActual.has(id)) ?? null
      if (contaba === null) {
        const nombrabaAntes = candAntes.some(id => t.seleccionAntes.has(id))
        // Una tarifa que nace ahora no tenía nada «implícito» que conservar: propone ONE.
        contaba = nombrabaAntes || previa.combinable || t.nueva ? null : laQueCuenta(candAntes, false, t.seleccionAntes)
        if (contaba !== null && !r.candidatos.includes(contaba)) contaba = null
      }
      let elegida: string
      let propuesta = false
      if (contaba === null) {
        elegida = propuestaAhora
        propuesta = true
      } else if (cambiaron && propuestaDeOne(t.nombre, candAntes, costoAntesDe, previa.combinable) === contaba) {
        // El servicio ganó o perdió opciones y la tarifa seguía con la propuesta de ONE: se
        // rehace. Si la asesora ya había escogido otra, se respeta.
        elegida = propuestaAhora
        propuesta = true
      } else {
        elegida = contaba
      }
      elegidas.push(elegida)
      porServicio.push({ r, elegida, propuesta })
    }
    // Con traslados que van con un hotel: en cada servicio que no se cruza, el de los hoteles de
    // ESTA tarifa. Se cambia lo propuesto por ONE, lo que ya no cabe (cambió el hotel) y lo de un
    // servicio cuyas asociaciones cambiaron; una elección de la asesora que cabe, se respeta.
    if (asociados.size > 0) {
      const hoteles = new Set([...fijosGenerales, ...porServicio.filter(x => x.r.combinable).map(x => x.elegida)])
      porServicio.forEach((x, i) => {
        if (x.r.combinable || !x.r.candidatos.some(id => asociados.has(id))) return
        const cambioLaAsociacion = x.r.candidatos.some(id => asociados.get(id) !== asociadosAntes.get(id))
        const cabe = cabeConLosHoteles(x.elegida, asociados, hoteles)
        if (cabe && !x.propuesta && !cambioLaAsociacion) return
        const suya = opcionParaLosHoteles(x.r.candidatos, asociados, hoteles)
        if (suya) elegidas[i] = suya
      })
    }
    // Lo nombrado fuera de los servicios con opciones se conserva (un servicio de una sola
    // opción, o una línea que ya no está): no cambia lo que suma y no hay por qué borrarlo.
    const resto = [...t.seleccionActual].filter(id => !todosLosCandidatos.has(id) && !candidatosAntes.has(id))
    seleccionFinal.set(t, [...resto, ...elegidas])
  }

  // ── El hotel que sobra: el orden sigue al precio (segunda vuelta de la COT-2026-0008) ──
  const recPrevia = recomendadaDe(trabajo.map(t => ({ ...t, id: t.id ?? `nueva:${t.nombre}`, vaEnPropuesta: t.vaAntes }))).fila
  const recPreviaTrabajo = recPrevia ? trabajo.find(t => (t.id ?? `nueva:${t.nombre}`) === recPrevia.id) ?? null : null
  const nombreFinal = new Map<Trabajo, string | null>()
  const reparto = repartoPorPrecio({
    ranuras,
    tarifas: trabajo.map(t => ({ t, nombre: t.nombre, seleccion: seleccionFinal.get(t) ?? [] })),
    recomendada: recPreviaTrabajo,
    costoDe,
  })
  for (const cambio of reparto ?? []) {
    seleccionFinal.set(cambio.tarifa, cambio.seleccion)
    if (cambio.nombre !== null) nombreFinal.set(cambio.tarifa, cambio.nombre)
  }
  const nombreDe = (t: Trabajo) => (nombreFinal.has(t) ? nombreFinal.get(t)! : t.nombre)

  // ── Qué va al cliente ──
  const firma = (t: Trabajo) => firmaDeTarifa(despues.items, seleccionFinal.get(t) ?? [])
  const firmaAntes = (t: Trabajo) => firmaDeTarifa(antes.items, [...t.seleccionAntes])
  const recomendada = recomendadaDe(trabajo.map(t => ({ ...t, id: t.id ?? `nueva:${t.nombre}`, vaEnPropuesta: t.vaAntes }))).fila
  const recTrabajo = recomendada ? trabajo.find(t => (t.id ?? `nueva:${t.nombre}`) === recomendada.id) ?? null : null
  const recAntes = recTrabajo?.id ? antes.tarifas.find(t => t.id === recTrabajo.id) ?? null : null
  const vaFinal = new Map<Trabajo, boolean>()
  const enOrden = [...trabajo].sort((a, b) => a.orden - b.orden)
  for (const t of enOrden) {
    if (t === recTrabajo) { vaFinal.set(t, true); continue }
    // La Intermedia cuenta como una de las tres: nace en la propuesta como la Premium.
    const canon = nombreCanonico(nombreDe(t)) ?? (esIntermedia(nombreDe(t)) ? 'Premium' : null)
    // Con una sola manera de armar vuelo y hotel no hay Económica ni Premium que mandar.
    if (canon !== null && !hayCombinables) { vaFinal.set(t, false); continue }
    const igualARec = recTrabajo !== null && firma(t) === firma(recTrabajo)
    const igualAOtraQueVa = enOrden.some(o => o !== t && o !== recTrabajo && o.orden < t.orden && vaFinal.get(o) === true && firma(o) === firma(t))
    if (igualARec || igualAOtraQueVa) { vaFinal.set(t, false); continue }
    if (t.nueva) { vaFinal.set(t, canon !== null); continue }
    // Dejó de ser idéntica (la asesora cambió una opción): vuelve a mandarse.
    const eraIgual = recAntes !== null && firmaAntes(t) === firmaDeTarifa(antes.items, recAntes.seleccion)
    vaFinal.set(t, eraIgual ? true : t.vaAntes)
  }

  // ── El plan ──
  for (const t of trabajo) {
    const sel = seleccionFinal.get(t) ?? []
    if (t.id === null) {
      plan.crear.push({ nombre: nombreDe(t) as TarifaNueva['nombre'], orden: t.orden, vaEnPropuesta: vaFinal.get(t) ?? false, seleccion: sel })
      continue
    }
    if (nombreDe(t) !== t.nombre) (plan.nombres ??= []).push({ itinerarioId: t.id, nombre: nombreDe(t) as string })
    const actual = t.seleccionActual
    const nueva = new Set(sel)
    const quitar = [...actual].filter(id => !nueva.has(id))
    const poner = [...nueva].filter(id => !actual.has(id))
    if (quitar.length > 0 || poner.length > 0) plan.seleccion.push({ itinerarioId: t.id, quitar, poner })
    const va = vaFinal.get(t) ?? t.vaAntes
    if (va !== t.vaAntes) plan.marcas.push({ itinerarioId: t.id, vaEnPropuesta: va })
  }
  return plan
}

const esRanuraDePaquete = (grupo: string) => ranuraDeGrupo(grupo)?.slug === 'paquete_detalle'

/**
 * LA RECOMENDADA ES LA DEL PRECIO INTERMEDIO (decisión de Mauricio del 2026-10-29, al revisar el PDF
 * de la COT-2026-0008: «siempre la que escogemos es la intermedia»). Reemplaza la «Intermedia» de
 * #1348 (la Recomendada la más cara y la del medio en el lugar de la Premium).
 *
 * Con tres hoteles queda: Económica = el más barato, Recomendada = el del medio y la tercera tarifa =
 * el más caro, con el nombre de la Premium (el documento la dice «Superior»). El orden del PDF, los
 * botones y el plan de pagos ya siguen el `orden` de las tarifas: Económica, Recomendada, Superior.
 *
 * Para UN solo servicio con opciones que se cruza y que es un hotel, con el costo de todas:
 *  · **La Recomendada es la más cara** (estrictamente) → se le pasa un hotel del medio (el que tenía
 *    la tarifa del lugar de la Premium si es más barato que el suyo, o el primero que se pegó de los
 *    que no están en ninguna otra tarifa), siempre que no sea más barato que el de la Económica; la
 *    tarifa del lugar de la Premium se queda con el más caro (el de la Recomendada) y, si se llamaba
 *    «Intermedia», vuelve a llamarse «Premium». Sin hotel del medio, nada cambia.
 *  · **La Recomendada no es la más cara** y la tarifa se llama «Intermedia» → vuelve a «Premium»
 *    con el hotel más caro (el reparto normal por precio).
 *  · En cualquier otro caso, nada: el aviso de «Revisar y enviar» (#1333) lo dice con su botón.
 *
 * Las cotizaciones guardadas no se reescriben solas: el reparto corre en la siguiente acción de
 * Tarifas (`sincronizarTarifas`). Devuelve los cambios (tarifa, selección y nombre nuevo o `null`),
 * o `null` si no cambia nada.
 */
function repartoPorPrecio<T>(args: {
  ranuras: { grupo: string; candidatos: string[]; combinable: boolean }[]
  tarifas: { t: T; nombre: string | null; seleccion: string[] }[]
  recomendada: T | null
  costoDe: (id: string) => number | null
}): { tarifa: T; seleccion: string[]; nombre: string | null }[] | null {
  const combinables = args.ranuras.filter(r => r.combinable)
  if (combinables.length !== 1) return null
  const r = combinables[0]
  if (ranuraDeGrupo(r.grupo)?.slug !== 'hotel_detalle') return null
  const costo = new Map(r.candidatos.map(id => [id, args.costoDe(id)]))
  if ([...costo.values()].some(c => c === null || !(c > 0))) return null
  const c = (id: string) => costo.get(id) as number
  const hotelDe = (sel: readonly string[]) => r.candidatos.find(id => sel.includes(id)) ?? null
  const conHotel = (x: { seleccion: string[] }, viejo: string, nuevo: string) => [...x.seleccion.filter(id => id !== viejo), nuevo]

  const rec = args.tarifas.find(x => x.t === args.recomendada)
  const recHotel = rec ? hotelDe(rec.seleccion) : null
  if (!rec || !recHotel) return null
  // La del lugar de la Premium: la Premium o la que quedó «Intermedia» (la primera).
  const p = args.tarifas.find(x => x !== rec && (esIntermedia(x.nombre) || nombreCanonico(x.nombre) === 'Premium'))
  if (!p) return null
  const pHotel = hotelDe(p.seleccion)
  if (!pHotel) return null
  const nombreDeP = esIntermedia(p.nombre) ? 'Premium' : null

  const recEsLaMasCara = r.candidatos.every(id => id === recHotel || c(id) < c(recHotel))
  if (!recEsLaMasCara) {
    if (!esIntermedia(p.nombre)) return null
    const caro = propuestaDeOne('Premium', r.candidatos, args.costoDe)
    return [{ tarifa: p.t, seleccion: conHotel(p, pHotel, caro), nombre: 'Premium' }]
  }

  const eco = args.tarifas.find(x => x !== rec && x !== p && nombreCanonico(x.nombre) === 'Económica')
  const ecoHotel = eco ? hotelDe(eco.seleccion) : null
  const piso = ecoHotel ? c(ecoHotel) : 0
  const delMedio = (id: string) => c(id) < c(recHotel) && c(id) >= piso && id !== ecoHotel
  const usados = new Set(args.tarifas.filter(x => x !== p).map(x => hotelDe(x.seleccion)).filter((id): id is string => id !== null))
  const medio = pHotel !== recHotel && delMedio(pHotel)
    ? pHotel
    : r.candidatos.find(id => !usados.has(id) && delMedio(id)) ?? null
  if (!medio) return null
  return [
    { tarifa: rec.t, seleccion: conHotel(rec, recHotel, medio), nombre: null },
    { tarifa: p.t, seleccion: conHotel(p, pHotel, recHotel), nombre: nombreDeP },
  ]
}

/**
 * VIAJE EN BLOQUEO: UNA TARIFA POR PAQUETE (decisión D5 de Mauricio, 2026-10-29).
 *
 * En un bloqueo el cliente escoge entre los paquetes del operador (mismo vuelo, otro hotel): cada
 * paquete es una opción completa con su precio. La asesora incluye o saca cada uno de la propuesta,
 * de forma reversible, con el «va en la propuesta» de su tarifa. Hasta el 2026-10-29 crear o guardar
 * un paquete no tocaba las tarifas y el PDF mostraba solo el primero (el supuesto de la ranura).
 *
 * La propuesta de Económica / Recomendada / Premium (la más barata, la primera, la más cara) no
 * sirve aquí: con tres paquetes, la más barata suele ser la primera y el del medio no salía nunca.
 *
 * Reglas:
 *  · cada paquete tiene su tarifa; la del primero (por `orden`) nace como la Recomendada, las demás
 *    sin nombre (la plantilla las numera «Opción N»), y todas nacen en la propuesta;
 *  · lo que la asesora decidió se respeta: qué tarifa lleva qué paquete y si va o no va;
 *  · la Recomendada siempre va (decisión E);
 *  · una tarifa sin paquete (lo borraron) toma uno que no tenga tarifa; si no queda ninguno, lleva el
 *    de la Recomendada y sale de la propuesta (es idéntica a ella);
 *  · los demás servicios con opciones (un traslado, una actividad) toman en cada tarifa la opción que
 *    ya nombran o, si no nombran ninguna, la de la Recomendada (o la primera);
 *  · **la marca «va en la propuesta» sigue al PAQUETE** (QA del #1359, decisión de Mauricio del
 *    2026-10-29): cuando un paquete cambia de tarifa (la asesora escogió otro en una pestaña, o cambió
 *    la Recomendada), la tarifa que lo recibe toma la marca que el paquete tenía antes (`antes`). El que
 *    sale de la Recomendada iba (la Recomendada siempre va). Un paquete sin tarifa previa (recién
 *    creado) va. Sin `antes`, ningún paquete cambió de tarifa por la acción: las marcas se quedan;
 *  · si dos tarifas nombran el mismo paquete, se lo queda la que lo ACABA de escoger (la que no lo
 *    nombraba en `antes`); la otra toma el que quedó libre. Sin eso, escoger en la Opción 3 el paquete
 *    de la Opción 2 se deshacía solo (ganaba la de menor `orden`).
 */
export function planDeTarifasDeBloqueo(despues: EstadoDeTarifas, paquetes: readonly string[], antes: EstadoDeTarifas | null = null): PlanDeTarifas {
  const plan = vacio()
  const otras = ranurasConAlternativas(despues.items).filter(r => !esRanuraDePaquete(r.grupo))
  const tarifas = [...despues.tarifas].sort((a, b) => a.orden - b.orden)
  const rec = recomendadaDe(tarifas).fila

  // El paquete de cada tarifa y su marca, ANTES de la acción.
  const paqueteAntes = new Map<string, string | null>()
  const marcaAntes = new Map<string, boolean>()
  if (antes) {
    const recAntes = recomendadaDe(antes.tarifas).fila
    for (const t of [...antes.tarifas].sort((a, b) => a.orden - b.orden)) {
      const p = paquetes.find(id => t.seleccion.includes(id)) ?? null
      paqueteAntes.set(t.id, p)
      // La Recomendada manda sobre una tarifa que solo repetía su paquete (`sinLugar`).
      if (p && (t.id === recAntes?.id || !marcaAntes.has(p))) marcaAntes.set(p, t.id === recAntes?.id ? true : t.vaEnPropuesta)
    }
  }
  const loAcabaDeEscoger = (t: TarifaDelPlan, p: string) => antes !== null && paqueteAntes.has(t.id) && paqueteAntes.get(t.id) !== p

  // Qué paquete lleva cada tarifa: la que lo acaba de escoger y, si no, la primera que lo nombra.
  const duena = new Map<string, TarifaDelPlan>()
  const paqueteDe = new Map<TarifaDelPlan, string | null>()
  const nombrado = (t: TarifaDelPlan) => paquetes.find(id => t.seleccion.includes(id)) ?? null
  const porPrioridad = [...tarifas].sort((a, b) => {
    const pa = nombrado(a)
    const pb = nombrado(b)
    const xa = pa !== null && loAcabaDeEscoger(a, pa) ? 0 : 1
    const xb = pb !== null && loAcabaDeEscoger(b, pb) ? 0 : 1
    return xa - xb || a.orden - b.orden
  })
  for (const t of porPrioridad) {
    const p = nombrado(t)
    if (p && !duena.has(p)) { duena.set(p, t); paqueteDe.set(t, p) } else paqueteDe.set(t, null)
  }
  const libres = paquetes.filter(id => !duena.has(id))
  // La Recomendada primero: si perdió su paquete, toma el primero libre.
  const huerfanas = tarifas.filter(t => paqueteDe.get(t) === null).sort((a, b) => (a === rec ? -1 : b === rec ? 1 : a.orden - b.orden))
  const sinLugar = new Set<TarifaDelPlan>()
  for (const t of huerfanas) {
    const p = libres.shift()
    if (p) { paqueteDe.set(t, p); duena.set(p, t) } else sinLugar.add(t)
  }
  const paqueteDeLaRec = rec ? paqueteDe.get(rec) ?? null : null
  for (const t of sinLugar) paqueteDe.set(t, paqueteDeLaRec ?? paquetes[0])

  // La opción de los demás servicios: la que la tarifa nombra, o la de la Recomendada, o la primera.
  const eleccionDe = (r: (typeof otras)[number], seleccion: readonly string[]): string => {
    const propia = r.candidatos.find(id => seleccion.includes(id))
    if (propia) return propia
    const deRec = rec ? r.candidatos.find(id => rec.seleccion.includes(id)) : undefined
    return deRec ?? r.candidatos[0]
  }
  const todosLosCandidatos = new Set([...paquetes, ...otras.flatMap(r => r.candidatos)])

  for (const t of tarifas) {
    const sel = [
      ...t.seleccion.filter(id => !todosLosCandidatos.has(id)),
      paqueteDe.get(t) as string,
      ...otras.map(r => eleccionDe(r, t.seleccion)),
    ]
    const actual = new Set(t.seleccion)
    const nueva = new Set(sel)
    const quitar = [...actual].filter(id => !nueva.has(id))
    const poner = [...nueva].filter(id => !actual.has(id))
    if (quitar.length > 0 || poner.length > 0) plan.seleccion.push({ itinerarioId: t.id, quitar, poner })
    // La marca sigue al paquete: la tarifa que recibe otro paquete toma la marca que ese tenía.
    const suyo = paqueteDe.get(t) as string
    const previo = antes && paqueteAntes.has(t.id) ? paqueteAntes.get(t.id) ?? null : nombrado(t)
    const cambio = !sinLugar.has(t) && suyo !== previo
    const va = t === rec ? true : sinLugar.has(t) ? false : cambio ? (marcaAntes.get(suyo) ?? true) : t.vaEnPropuesta
    if (va !== t.vaEnPropuesta) plan.marcas.push({ itinerarioId: t.id, vaEnPropuesta: va })
  }

  // Los paquetes que todavía no tienen tarifa: una cada uno, en la propuesta.
  let orden = tarifas.reduce((m, t) => Math.max(m, t.orden), 0)
  let hayRec = rec !== null
  for (const p of libres) {
    const nombre: NombreTarifa | null = hayRec ? null : 'Recomendada'
    hayRec = true
    plan.crear.push({ nombre, orden: ++orden, vaEnPropuesta: true, seleccion: [p, ...otras.map(r => eleccionDe(r, []))] })
  }
  return plan
}

/** Aplica el plan en memoria (para la prueba de propiedad y para la pantalla). */
export function aplicarPlan(tarifas: TarifaDelPlan[], plan: PlanDeTarifas, nuevoId: (n: TarifaNueva) => string): TarifaDelPlan[] {
  const salida = tarifas.map(t => ({ ...t, seleccion: [...t.seleccion] }))
  for (const c of plan.seleccion) {
    const t = salida.find(x => x.id === c.itinerarioId)
    if (!t) continue
    t.seleccion = [...t.seleccion.filter(id => !c.quitar.includes(id)), ...c.poner]
  }
  for (const m of plan.marcas) {
    const t = salida.find(x => x.id === m.itinerarioId)
    if (t) t.vaEnPropuesta = m.vaEnPropuesta
  }
  for (const r of plan.nombres ?? []) {
    const t = salida.find(x => x.id === r.itinerarioId)
    if (t) t.nombre = r.nombre
  }
  for (const n of plan.crear) salida.push({ id: nuevoId(n), nombre: n.nombre, orden: n.orden, vaEnPropuesta: n.vaEnPropuesta, seleccion: [...n.seleccion] })
  return salida
}

/**
 * La invariante de P1: con el interruptor encendido, toda tarifa nombra exactamente una opción
 * de cada servicio con opciones, y la Recomendada (si hay tarifas) va en la propuesta.
 * Devuelve qué está mal, o `null`.
 */
export function violacionDeInvariante(e: EstadoDeTarifas): string | null {
  const ranuras = ranurasConAlternativas(e.items)
  for (const t of e.tarifas) {
    const sel = new Set(t.seleccion)
    for (const r of ranuras) {
      const n = r.candidatos.filter(id => sel.has(id)).length
      if (n !== 1) return `La tarifa «${t.nombre}» nombra ${n} opciones de «${r.grupo}»`
    }
  }
  if (e.tarifas.length > 0) {
    const rec = e.tarifas.filter(t => esRecomendada(t.nombre))
    if (rec.length !== 1) return `Hay ${rec.length} tarifas Recomendada`
    if (!rec[0].vaEnPropuesta) return 'La Recomendada no va en la propuesta'
  }
  return null
}
