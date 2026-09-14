/**
 * La línea de flujo de `/negocios`: en qué orden se DIBUJAN las etapas.
 *
 * El segmentador ordenaba las etapas de una fase por `orden`, y el `orden` no es el
 * recorrido. En la línea GIT EV/HEV de SOENA, Ejecución salía como Cargue, Certificación,
 * Generación, Envío, Cita, Notificación, Revisión radicado: Revisión radicado (orden 20)
 * va antes de Certificación, y Cita (16) antes de Generación (13). Quien mira la fila para
 * ver dónde se atasca el proceso leía un flujo que no existe.
 *
 * ── Qué NO hace este archivo ────────────────────────────────────────────────────────
 * No resuelve el routing. El destino por defecto sale de `siguienteEtapaPorDefecto`
 * (`flujo.ts`, la misma regla que el botón Avanzar y `/flujo`) y las salidas de una etapa
 * de `destinosDeEtapa` (`retorno-decision.ts`, la misma que usa el reproceso). Aquí solo
 * se decide cómo acomodar ese recorrido en filas.
 *
 * ── Las reglas ──────────────────────────────────────────────────────────────────────
 * 1. **Tronco**: desde la primera etapa (menor `orden`) se sigue el destino por defecto
 *    hasta el cierre (una etapa que se apunta a sí misma) o hasta volver a una ya vista.
 * 2. **Ramas**: toda salida hacia una etapa todavía sin lugar abre una rama, que sigue el
 *    destino por defecto hasta tocar una etapa ya colocada (ahí «vuelve»). Se exploran en
 *    el orden en que aparecen: primero las del tronco, después las de cada rama nueva.
 *    Una etapa colocada que recibe una salida desde fuera de su rama queda como otra
 *    entrada de esa rama (la rama de IVA sale de Cartera **o** de Entrega).
 * 3. **Desvío corto**: una rama de UNA sola etapa que sale de una etapa del tronco y vuelve
 *    a la siguiente del tronco se dibuja dentro del tronco, marcada como condicional
 *    (Inclusión entre Validación y Propuesta). Más larga, o con otra entrada, va en su
 *    propia fila: una sola fila mezclaría casos que nunca pasan por esas etapas.
 * 4. **Fuera del flujo**: lo que no se alcanza desde la primera etapa queda al final, por
 *    `orden`.
 * 5. **Línea sin routing**: si ninguna etapa declara routing, una sola fila por `orden`,
 *    que es exactamente lo que se veía antes. Ningún workspace sin routing cambia.
 *
 * Los saltos hacia delante dentro de lo ya colocado (Documentación → Segundo cobro cuando
 * el servicio es solo IVA) y las vueltas atrás (Notificación → Cita por PQR rechazado) no
 * crean filas: sus etapas ya tienen lugar.
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
 * Lo que `getEtapasSegmentador` le manda a la pantalla de una etapa. Solo el routing y el
 * SLA de `config_extra`, no el objeto entero: la guía, los avisos y las plantillas no le
 * sirven a la lista y viajarían en cada carga.
 */
export interface EtapaDelSegmentador extends EtapaDeLinea {
  /** Identificador estable por línea: es con el que se cuenta y se filtra. */
  numero: number
  nombre: string
  stage: string
  orden: number
  routing: RoutingEtapa | null
  /** SLA en horas hábiles; null = la etapa no mide atraso. */
  sla_horas: number | null
}

export interface PasoDelTronco<T> {
  etapa: T
  /** Desvío corto: solo algunos casos pasan por aquí (regla 3). */
  condicional: boolean
}

export interface RamaDeLinea<T> {
  /** Etapas desde las que se entra a la rama, en el orden en que se descubrieron. */
  desde: T[]
  etapas: T[]
  /** Etapa ya colocada a la que la rama vuelve. `null` si la rama termina sola. */
  hacia: T | null
}

export interface SecuenciaDeLinea<T> {
  /** false = la línea no declara routing y la secuencia es el `orden` de siempre. */
  porRouting: boolean
  tronco: PasoDelTronco<T>[]
  ramas: RamaDeLinea<T>[]
  fueraDelFlujo: T[]
}

interface RamaCruda {
  desde: number[]
  etapas: number[]
  hacia: number | null
}

export function secuenciaDeLinea<T extends EtapaDeLinea>(etapas: readonly T[]): SecuenciaDeLinea<T> {
  const ordenadas = [...etapas].sort((a, b) => a.orden - b.orden)
  if (ordenadas.length === 0) return { porRouting: false, tronco: [], ramas: [], fueraDelFlujo: [] }

  if (!ordenadas.some((e) => e.routing != null)) {
    return {
      porRouting: false,
      tronco: ordenadas.map((etapa) => ({ etapa, condicional: false })),
      ramas: [],
      fueraDelFlujo: [],
    }
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

  // 2. Ramas
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
  const condicionales = new Set<number>()
  const ramasEnFila: RamaCruda[] = []
  for (const rama of ramas) {
    const posicion = rama.desde.length === 1 ? tronco.indexOf(rama.desde[0]) : -1
    const esDesvioCorto =
      rama.etapas.length === 1 &&
      posicion >= 0 &&
      rama.hacia !== null &&
      tronco[posicion + 1] === rama.hacia
    if (esDesvioCorto) {
      tronco.splice(posicion + 1, 0, rama.etapas[0])
      condicionales.add(rama.etapas[0])
    } else {
      ramasEnFila.push(rama)
    }
  }

  const etapa = (o: number) => porOrden.get(o)!
  return {
    porRouting: true,
    tronco: tronco.map((o) => ({ etapa: etapa(o), condicional: condicionales.has(o) })),
    ramas: ramasEnFila.map((r) => ({
      desde: r.desde.map(etapa),
      etapas: r.etapas.map(etapa),
      hacia: r.hacia === null ? null : etapa(r.hacia),
    })),
    fueraDelFlujo: ordenadas.filter((e) => !colocadas.has(e.orden)),
  }
}

// ── Posición en la cuadrícula ──────────────────────────────────────────────────────

export type TipoNodo = 'tronco' | 'rama' | 'fuera'

export interface NodoDeLinea<T> {
  etapa: T
  /** 1 = tronco; 2.. = una fila por rama; la última, lo que queda fuera del flujo. */
  fila: number
  /** Columna de la cuadrícula, desde 1. */
  columna: number
  tipo: TipoNodo
  condicional: boolean
  /** Primera etapa de su rama: se dibuja con la flecha que baja desde su entrada. */
  abreRama: boolean
  /** Última etapa de una rama que vuelve: se dibuja con la flecha que sube. */
  cierraRama: boolean
  /** Etapa anterior en la misma fila, para dibujar el conector. `null` si no hay. */
  columnaAnterior: number | null
}

/**
 * Dónde va cada etapa, sin medir el DOM. Cada etapa ocupa una columna; una rama empieza
 * en la columna siguiente a su última entrada, y si vuelve al tronco la etapa a la que
 * vuelve se corre hasta quedar después del final de la rama (Facturación queda después
 * de Seguimiento, no debajo de Cita).
 */
export function distribuirLinea<T extends EtapaDeLinea>(sec: SecuenciaDeLinea<T>): NodoDeLinea<T>[] {
  const nodos: NodoDeLinea<T>[] = sec.tronco.map((p, i) => ({
    etapa: p.etapa,
    fila: 1,
    columna: i + 1,
    tipo: 'tronco' as const,
    condicional: p.condicional,
    abreRama: false,
    cierraRama: false,
    columnaAnterior: null,
  }))
  const columnaDe = (orden: number) => nodos.find((n) => n.etapa.orden === orden)?.columna

  sec.ramas.forEach((rama, r) => {
    const fila = r + 2
    const entradas = rama.desde.map((e) => columnaDe(e.orden)).filter((c): c is number => c !== undefined)
    const inicio = (entradas.length > 0 ? Math.max(...entradas) : 0) + 1
    rama.etapas.forEach((etapa, i) => {
      nodos.push({
        etapa,
        fila,
        columna: inicio + i,
        tipo: 'rama',
        condicional: false,
        abreRama: i === 0,
        cierraRama: i === rama.etapas.length - 1 && rama.hacia !== null,
        columnaAnterior: null,
      })
    })

    // La etapa del tronco a la que vuelve se corre, y con ella todo lo que va después
    // en el tronco y las ramas que empiezan desde ahí. Las ramas anteriores no se tocan.
    const fin = inicio + rama.etapas.length
    const destino = rama.hacia ? nodos.find((n) => n.etapa.orden === rama.hacia!.orden && n.fila === 1) : undefined
    if (destino && destino.columna < fin) {
      const desde = destino.columna
      const corrimiento = fin - desde
      const inicioDeFila = new Map<number, number>()
      for (const n of nodos) {
        if (n.fila > 1) inicioDeFila.set(n.fila, Math.min(inicioDeFila.get(n.fila) ?? Infinity, n.columna))
      }
      for (const n of nodos) {
        if (n.fila === fila) continue
        const mover = n.fila === 1 ? n.columna >= desde : (inicioDeFila.get(n.fila) ?? 0) >= desde
        if (mover) n.columna += corrimiento
      }
    }
  })

  const filaFuera = sec.ramas.length + 2
  sec.fueraDelFlujo.forEach((etapa, i) => {
    nodos.push({
      etapa,
      fila: filaFuera,
      columna: i + 1,
      tipo: 'fuera',
      condicional: false,
      abreRama: false,
      cierraRama: false,
      columnaAnterior: null,
    })
  })

  // Conector: la etapa anterior de la misma fila. La primera de una rama no tiene: entra
  // desde otra fila y se dibuja con su flecha.
  const porFila = new Map<number, NodoDeLinea<T>[]>()
  for (const n of nodos) porFila.set(n.fila, [...(porFila.get(n.fila) ?? []), n])
  for (const fila of porFila.values()) {
    fila.sort((a, b) => a.columna - b.columna)
    fila.forEach((n, i) => {
      if (i > 0 && n.tipo !== 'fuera') n.columnaAnterior = fila[i - 1].columna
    })
  }
  return nodos
}

// ── Color por atraso ───────────────────────────────────────────────────────────────

export type NivelDeAtraso = 'sin_sla' | 'al_dia' | 'algunos' | 'mayoria'

/**
 * El color de una etapa lo deciden sus atrasados, no su volumen: Seguimiento espera a la
 * DIAN y Propuesta al cliente, así que muchos casos parados ahí no son un cuello de
 * botella por sí solos.
 *
 * - `sin_sla`: la etapa no tiene SLA; no se mide atraso y nunca se pinta de alerta.
 * - `al_dia`: tiene SLA y ningún caso lo pasó.
 * - `algunos`: menos de la mitad de sus casos pasaron el SLA.
 * - `mayoria`: la mitad o más.
 *
 * «Atrasado» es el mismo criterio del filtro Atrasados (`sla_exceso_horas > 0`): lo cuenta
 * quien llama con esa función, no se reescribe aquí.
 */
export function nivelDeAtraso(conteo: { total: number; atrasados: number }, tieneSla: boolean): NivelDeAtraso {
  if (!tieneSla) return 'sin_sla'
  if (conteo.atrasados <= 0 || conteo.total <= 0) return 'al_dia'
  return conteo.atrasados * 2 >= conteo.total ? 'mayoria' : 'algunos'
}
