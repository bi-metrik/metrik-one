/**
 * El orden de OCURRENCIA de las etapas de una línea: en qué orden las pisa un caso.
 *
 * El segmentador de `/negocios` (Fase → Etapas de la fase) ordenaba las etapas por
 * `orden`, y el `orden` no es el recorrido. En la línea GIT EV/HEV de SOENA, Ejecución
 * salía como Cargue, Certificación, Generación, Envío, Cita, Notificación, Revisión
 * radicado: Revisión radicado (orden 20) va antes de Certificación, y Cita (16) antes de
 * Generación (13). Quien mira la fila para ver dónde se atasca el proceso leía un flujo
 * que no existe.
 *
 * Tampoco sirve el `numero`: es un identificador estable por línea, no una posición. En
 * SOENA hoy coincide con el recorrido, pero a una etapa que se inserta después el trigger
 * le da el siguiente número libre, y ordenada por `numero` quedaría al final de su fase
 * aunque ocurra al principio.
 *
 * ── Qué NO hace este archivo ────────────────────────────────────────────────────────
 * No resuelve el routing. El destino por defecto sale de `siguienteEtapaPorDefecto`
 * (`flujo.ts`, la misma regla que el botón Avanzar y `/flujo`) y las salidas de una etapa
 * de `destinosDeEtapa` (`retorno-decision.ts`, la misma que usa el reproceso). Aquí solo
 * se decide en qué orden quedan.
 *
 * ── Las reglas ──────────────────────────────────────────────────────────────────────
 * 1. **Tronco**: desde la primera etapa (menor `orden`) se sigue el destino por defecto
 *    hasta el cierre (una etapa que se apunta a sí misma) o hasta volver a una ya vista.
 * 2. **Ramas**: toda salida hacia una etapa todavía sin lugar abre una rama, que sigue el
 *    destino por defecto hasta tocar una etapa ya colocada (ahí «vuelve»). Se exploran en
 *    el orden en que aparecen: primero las del tronco, después las de cada rama nueva.
 * 3. **Desvío corto**: una rama de UNA sola etapa que sale de una etapa del tronco y vuelve
 *    a la siguiente del tronco queda dentro del tronco, en su lugar (Inclusión entre
 *    Validación y Propuesta). Más larga, o con otra entrada, es una rama.
 * 4. **Fuera del flujo**: lo que no se alcanza desde la primera etapa va al final, por
 *    `orden`.
 * 5. **Línea sin routing**: si ninguna etapa declara routing, el orden es el `orden`, que
 *    es exactamente lo que se veía antes. Ningún workspace sin routing cambia.
 *
 * El orden de ocurrencia es tronco, después las ramas, después lo que queda fuera. Por eso,
 * dentro de una fase, las etapas de una rama (la rama de IVA) van después de las del tronco.
 *
 * Los saltos hacia delante dentro de lo ya colocado (Documentación → Segundo cobro cuando
 * el servicio es solo IVA) y las vueltas atrás (Notificación → Cita por PQR rechazado) no
 * mueven nada: sus etapas ya tienen lugar.
 *
 * Puro: no toca base ni red.
 */

import type { RoutingEtapa } from './dato-de-decision'
import { siguienteEtapaPorDefecto } from './flujo'
import { destinosDeEtapa } from './retorno-decision'

export interface EtapaDeLinea {
  orden: number
  routing?: RoutingEtapa | null
}

/**
 * Lo que `getEtapasSegmentador` le manda a la pantalla de una etapa. De `config_extra`
 * solo el routing, no el objeto entero: la guía, los avisos y las plantillas no le sirven
 * a la lista y viajarían en cada carga.
 */
export interface EtapaDelSegmentador extends EtapaDeLinea {
  /** Identificador estable por línea: es con el que se cuenta y se filtra. */
  numero: number
  nombre: string
  stage: string
  orden: number
  routing: RoutingEtapa | null
}

export interface SecuenciaDeLinea<T> {
  /** Incluye los desvíos cortos en su lugar (regla 3). */
  tronco: T[]
  /** Una lista por rama, en el orden en que se descubrieron. */
  ramas: T[][]
  fueraDelFlujo: T[]
}

interface RamaCruda {
  desde: number[]
  etapas: number[]
  hacia: number | null
}

export function secuenciaDeLinea<T extends EtapaDeLinea>(etapas: readonly T[]): SecuenciaDeLinea<T> {
  const ordenadas = [...etapas].sort((a, b) => a.orden - b.orden)
  if (ordenadas.length === 0) return { tronco: [], ramas: [], fueraDelFlujo: [] }

  if (!ordenadas.some((e) => e.routing != null)) {
    return { tronco: ordenadas, ramas: [], fueraDelFlujo: [] }
  }

  const porOrden = new Map(ordenadas.map((e) => [e.orden, e]))
  const colocadas = new Set<number>()

  // 1. Tronco
  const tronco: number[] = []
  let actual: T | null = ordenadas[0]
  while (actual && !colocadas.has(actual.orden)) {
    tronco.push(actual.orden)
    colocadas.add(actual.orden)
    actual = siguienteEtapaPorDefecto(actual, ordenadas)
  }

  // Todas las salidas de una etapa. `destinosDeEtapa` no agrega la siguiente ascendente
  // cuando el routing existe pero no declara default; `siguienteEtapaPorDefecto` sí. Se
  // unen para que ninguna de las dos formas deje una salida sin mirar.
  const salidas = (e: T): number[] => {
    const out = [...destinosDeEtapa(e, ordenadas)]
    const porDefecto = siguienteEtapaPorDefecto(e, ordenadas)
    if (porDefecto && !out.includes(porDefecto.orden)) out.unshift(porDefecto.orden)
    return out.filter((o) => o !== e.orden && porOrden.has(o))
  }

  // 2. Ramas. Una etapa ya colocada que recibe una salida desde fuera de su rama queda
  // como otra entrada de esa rama (la rama de IVA sale de Cartera o de Entrega): con dos
  // entradas ya no es un desvío corto.
  const ramas: RamaCruda[] = []
  const ramaDe = new Map<number, number>()
  const porRecorrer = [...tronco]
  for (let i = 0; i < porRecorrer.length; i++) {
    const origen = porOrden.get(porRecorrer[i])!
    for (const destino of salidas(origen)) {
      if (colocadas.has(destino)) {
        const r = ramaDe.get(destino)
        if (r !== undefined && ramaDe.get(origen.orden) !== r && !ramas[r].desde.includes(origen.orden)) {
          ramas[r].desde.push(origen.orden)
        }
        continue
      }
      const cadena: number[] = []
      let hacia: number | null = null
      let paso: T | null = porOrden.get(destino) ?? null
      while (paso) {
        if (colocadas.has(paso.orden)) {
          hacia = paso.orden
          break
        }
        cadena.push(paso.orden)
        colocadas.add(paso.orden)
        paso = siguienteEtapaPorDefecto(paso, ordenadas)
      }
      const indice = ramas.length
      ramas.push({ desde: [origen.orden], etapas: cadena, hacia })
      for (const o of cadena) {
        ramaDe.set(o, indice)
        porRecorrer.push(o)
      }
    }
  }

  // 3. Desvíos cortos dentro del tronco
  const ramasAparte: RamaCruda[] = []
  for (const rama of ramas) {
    const posicion = rama.desde.length === 1 ? tronco.indexOf(rama.desde[0]) : -1
    const esDesvioCorto =
      rama.etapas.length === 1 &&
      posicion >= 0 &&
      rama.hacia !== null &&
      tronco[posicion + 1] === rama.hacia
    if (esDesvioCorto) tronco.splice(posicion + 1, 0, rama.etapas[0])
    else ramasAparte.push(rama)
  }

  const etapa = (o: number) => porOrden.get(o)!
  return {
    tronco: tronco.map(etapa),
    ramas: ramasAparte.map((r) => r.etapas.map(etapa)),
    fueraDelFlujo: ordenadas.filter((e) => !colocadas.has(e.orden)),
  }
}

/**
 * Todas las etapas de la línea en orden de ocurrencia: tronco, ramas, fuera del flujo.
 * Filtrar el resultado por `stage` da las etapas de una fase en el orden en que las pisa
 * un caso, con las de una rama después de las del tronco.
 */
export function etapasEnOrdenDeOcurrencia<T extends EtapaDeLinea>(etapas: readonly T[]): T[] {
  const sec = secuenciaDeLinea(etapas)
  return [...sec.tronco, ...sec.ramas.flat(), ...sec.fueraDelFlujo]
}
