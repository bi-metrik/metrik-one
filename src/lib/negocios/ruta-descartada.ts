/**
 * Etapas que NO aplican a un caso: el otro lado de la reversa de ruta.
 *
 * `reversa-ruta.ts` responde "¿el caso se saltó etapas que SÍ le tocaban?" y propone
 * devolverlo. Este módulo responde la pregunta contraria y mucho más frecuente: "¿qué
 * etapas se saltó **con razón**, y por qué?".
 *
 * ── El problema, medido en SOENA ──────────────────────────────────────────────────────
 * Un caso que solo contrató devolución de IVA sale de Documentación y aterriza cinco
 * etapas más adelante. Cargue, Pago UPME, Revisión radicado y Certificación no le aplican
 * nunca, pero **en pantalla no queda rastro de eso**: los números de etapa saltan de E5 a
 * E10 y quien mira el caso no sabe si se omitieron por diseño o por error. La consecuencia
 * real no es estética — es que nadie distingue un salto correcto de uno equivocado, que es
 * justo lo que `reversa-ruta.ts` existe para detectar.
 *
 * ── Por qué se CALCULA y no se marca a mano ───────────────────────────────────────────
 * La alternativa evaluada era `omitible_por` (#240): hacer que el caso RECORRA las etapas
 * y que alguien las declare "no aplica" al avanzar. Se descartó con tres mediciones en
 * contra: obliga a revertir el conditional del routing (el caso dejaría de saltar y habría
 * que avanzarlo a mano en cada etapa), no cubre los gates de ETAPA como el `saldo_cero` de
 * Pago UPME (el caso queda trabado ahí), y dispara el `avisar_al_entrar` de Pago UPME
 * mandándole a la financiera un aviso de trabajo que no existe.
 *
 * Y una cuarta razón que solo aparece al enumerar a mano: **el plan escrito listaba tres
 * etapas y son cuatro.** Se le había escapado Revisión radicado. Una lista escrita a mano
 * envejece con cada cambio de routing; una derivada del routing no puede desactualizarse.
 *
 * ── Por qué NO se persiste ────────────────────────────────────────────────────────────
 * Se recalcula en cada lectura. Si alguien corrige el servicio contratado, la marca tiene
 * que desaparecer sola: en ese mismo momento `reversa-ruta.ts` empieza a proponer devolver
 * el caso a Cargue. Una marca guardada seguiría diciendo "no aplica" mientras la otra
 * pantalla dice "debía pasar por ahí" — dos superficies afirmando lo contrario sobre el
 * mismo caso.
 *
 * ── Sin opt-in, a propósito ───────────────────────────────────────────────────────────
 * A diferencia de la reversa, esto no mueve nada ni propone moverlo: pinta texto. El
 * portero es estructural en vez de declarado: una línea sin bifurcaciones no produce ni
 * una descartada, así que no hay nada que apagar. La reversa exige `activa = true` porque
 * devolver un caso tiene consecuencias de plata; aquí no las hay.
 */

import { destinoDeEtapa, type EtapaRuta, type ValoresPorOrden } from './reversa-ruta'
import { camposDeDecision, esRespuesta } from './dato-de-decision'

/** Tope del recorrido de una rama. Un routing mal configurado no puede colgar el render. */
const MAX_PASOS = 60

export interface MotivoDescarte {
  /** `orden` de la etapa donde se tomó la decisión que dejó esta etapa fuera. */
  decisionOrden: number
  /** Campo que decidió. */
  campo: string
  /** Valor que tenía el campo al decidir. Crudo, tal como lo compara el motor. */
  valor: string
}

export interface EtapaDescartada {
  orden: number
  motivo: MotivoDescarte
}

/**
 * ¿Qué rama tomó el routing de esta etapa, y con qué respuesta?
 *
 * Replica `destinoDeEtapa` (misma lectura de la etapa fuente, misma comparación por
 * `String(valor ?? '')`, primera que coincide gana) y además devuelve el campo y el valor
 * que la explican, que es lo único que hace legible la marca en pantalla: "no aplica" sin
 * el porqué obliga a ir a buscarlo.
 *
 * ⚠️ **Devuelve `null` cuando ninguno de los campos que deciden tiene respuesta.** El motor
 * en ese caso enruta igual, por el camino por defecto, y ahí está el peligro: marcar sobre
 * ese silencio convertiría un "nadie contestó" en un "no aplica" declarado. Es exactamente
 * lo que ya costó caro en SOENA — un campo derivado que quedó en `false` de relleno mandó
 * cinco casos por la vía corta, y ninguna pantalla dijo que la respuesta no existía. Un
 * caso sin responder no tiene etapas descartadas: tiene un dato pendiente, y de eso avisa
 * `dato-de-decision.ts`.
 *
 * Que gane el camino por DEFECTO no es problema mientras haya respuesta: una respuesta que
 * no coincide con ninguna condición es una decisión igual de real que una que sí coincide.
 */
function ramaTomada(
  etapa: EtapaRuta,
  valores: ValoresPorOrden,
): { destino: number; campo: string; valor: string } | null {
  const routing = etapa.routing
  if (!routing) return null

  const fuente = typeof routing.source_etapa_orden === 'number' ? routing.source_etapa_orden : etapa.orden
  const bolsa = valores[fuente] ?? {}

  const respondido = camposDeDecision(routing).find(c => esRespuesta(bolsa[c]))
  if (respondido === undefined) return null

  for (const regla of routing.conditional ?? []) {
    const campo = regla?.condition?.field
    if (typeof campo !== 'string') continue
    const crudo = String(bolsa[campo] ?? '')
    if (crudo === String(regla.condition.value)) {
      return { destino: regla.etapa_orden, campo, valor: crudo }
    }
  }

  const destino = routing.default_etapa_orden
  if (typeof destino !== 'number') return null
  return { destino, campo: respondido, valor: String(bolsa[respondido] ?? '') }
}

/** Todos los destinos que el routing de esta etapa podría haber elegido. */
function destinosPosibles(etapa: EtapaRuta): number[] {
  const routing = etapa.routing
  if (!routing) return []
  const vistos = new Set<number>()
  for (const regla of routing.conditional ?? []) {
    if (typeof regla?.etapa_orden === 'number') vistos.add(regla.etapa_orden)
  }
  if (typeof routing.default_etapa_orden === 'number') vistos.add(routing.default_etapa_orden)
  return [...vistos]
}

/**
 * El camino completo desde una etapa, sin parada: sirve como conjunto de reencuentro.
 *
 * ⚠️ Solo el primer tramo es certeza. De ahí en adelante las etapas no recorridas no tienen
 * datos, así que sus routings resuelven por el camino por defecto y esto pasa a ser la
 * predicción del sistema, no un hecho (mismo aviso que `recorridoDesde`). Aquí eso es
 * seguro en la dirección correcta: este conjunto solo se usa para PARAR la exploración de
 * las ramas alternas, y de más solo puede producir MENOS descartadas, nunca más.
 */
function alcanzablesDesde(etapas: readonly EtapaRuta[], origenOrden: number, valores: ValoresPorOrden): Set<number> {
  const porOrden = new Map(etapas.map(e => [e.orden, e]))
  const vistas = new Set<number>()
  let actual = porOrden.get(origenOrden)
  for (let i = 0; actual && i < MAX_PASOS; i++) {
    const siguiente = destinoDeEtapa(actual, etapas, valores)
    if (siguiente === null || vistas.has(siguiente)) break
    vistas.add(siguiente)
    actual = porOrden.get(siguiente)
  }
  return vistas
}

/**
 * Las etapas que este caso no va a recorrer nunca, y la decisión que las dejó fuera.
 *
 * El método, en una frase: por cada bifurcación que el caso YA pasó, se camina la rama que
 * NO tomó hasta que vuelve a juntarse con la ruta real; lo que queda en medio, sin
 * recorrer, no aplica.
 *
 * Cuatro cortes, y cada uno evita un falso positivo distinto:
 *
 * 1. **Solo bifurcaciones ya recorridas, y que el caso ya dejó atrás.** Una decisión que
 *    todavía no se tomó no descarta nada: el dato puede llegar mañana. Marcar el futuro
 *    sería adivinar, y adivinar aquí se lee como un hecho.
 * 2. **Se para al reencontrarse con la ruta real.** La rama alterna y la real casi siempre
 *    vuelven a juntarse (en SOENA, en Precobro). Sin este corte la marca se comería el
 *    resto del proceso.
 * 3. **Una etapa sin casillas configuradas se ignora.** No puede dejar prueba de haber sido
 *    recorrida, así que aparecería como descartada en todos los casos y para siempre — el
 *    mismo defecto que ya está documentado en `EtapaRuta.tieneCasillas`.
 * 4. **Una etapa que el motor salta por saldo cubierto se ignora.** Su ausencia tiene otra
 *    explicación, correcta y frecuente (`aplicaSaltoPorSaldo`). En SOENA son Precobro y
 *    Cobro: llamarlas "no aplica" sería mentir sobre por qué no están.
 *
 * Y el corte que las envuelve a todas: **lo recorrido nunca se marca.** Un caso que sí pasó
 * por Cargue aunque hoy su servicio diga lo contrario tiene historia, no una omisión; eso
 * es una incoherencia que le toca a `reversa-ruta.ts`, no una etapa que no aplica.
 */
export function etapasDescartadas(input: {
  etapas: readonly EtapaRuta[]
  /** Valores vigentes por etapa (`orden` → datos del bloque). */
  valores: ValoresPorOrden
  /** Órdenes con prueba de recorrido: el caso tiene instancias de sus casillas. */
  recorridas: ReadonlySet<number>
  /** Dónde está el caso ahora. */
  etapaActualOrden: number
}): EtapaDescartada[] {
  const { etapas, valores, recorridas, etapaActualOrden } = input
  const porOrden = new Map(etapas.map(e => [e.orden, e]))

  const descartadas = new Map<number, MotivoDescarte>()

  const decisiones = etapas
    .filter(e => (e.routing?.conditional ?? []).length > 0)
    .filter(e => e.orden !== etapaActualOrden && recorridas.has(e.orden))
    .sort((a, b) => a.orden - b.orden)

  for (const decision of decisiones) {
    const rama = ramaTomada(decision, valores)
    if (rama === null) continue
    const { destino, campo, valor } = rama

    // Dónde vuelven a juntarse las dos vías: por ahí va el caso de verdad.
    //
    // ⚠️ Lo RECORRIDO no entra aquí, aunque sea tentador. Un caso puede tener recorrida una
    // etapa de la rama alterna y seguir sin recorrer las de más abajo — es la forma de los
    // casos corregidos a medias (SOENA V0109: pasó por Cargue y Certificación pero nunca
    // por Pago UPME). Usarlo como corte cerraba la rama en la primera etapa recorrida y
    // dejaba sin mirar todo lo que venía después. Lo recorrido filtra al marcar, no corta.
    const rutaReal = alcanzablesDesde(etapas, decision.orden, valores)
    const reencuentro = new Set<number>([...rutaReal, decision.orden, etapaActualOrden])

    for (const alterna of destinosPosibles(decision)) {
      if (alterna === destino || reencuentro.has(alterna)) continue

      let actual = porOrden.get(alterna)
      const enRama = new Set<number>()
      for (let i = 0; actual && i < MAX_PASOS; i++) {
        if (reencuentro.has(actual.orden) || enRama.has(actual.orden)) break
        enRama.add(actual.orden)
        const siguiente = destinoDeEtapa(actual, etapas, valores)
        if (siguiente === null) break
        actual = porOrden.get(siguiente)
      }

      for (const orden of enRama) {
        const etapa = porOrden.get(orden)
        if (!etapa || !etapa.tieneCasillas || etapa.puedeSaltarsePorSaldo) continue
        if (recorridas.has(orden)) continue
        // La bifurcación de más arriba manda: es la que el equipo reconoce como el momento
        // en que el caso tomó su vía. Mismo criterio de orden que `retornosPosibles`.
        if (!descartadas.has(orden)) descartadas.set(orden, { decisionOrden: decision.orden, campo, valor })
      }
    }
  }

  return [...descartadas.entries()]
    .map(([orden, motivo]) => ({ orden, motivo }))
    .sort((a, b) => a.orden - b.orden)
}
