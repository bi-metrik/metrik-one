/**
 * Reversa de ruta: corregir el dato no basta si el caso ya se fue por la vía equivocada.
 *
 * `propagarCamposDerivados` ya resuelve el dato hacia ADELANTE: al guardar la respuesta
 * escribe sus campos derivados en la misma operación, para que la PRÓXIMA decisión no se
 * tome con el valor viejo. Pero la decisión YA TOMADA no se revisa nunca, y el routing
 * solo se evalúa hacia adelante dentro de `cambiarEtapaNegocioConGate`. Resultado: el dato
 * queda bien y el caso se queda en la vía equivocada, sin que nada lo señale.
 *
 * Lo que costó (SOENA, V0122): el bloque que gobierna la bifurcación de Documentación se
 * creó el 03-ago y el negocio había avanzado el 01-ago, dos días antes de que existiera.
 * Nadie respondió la pregunta, `requiere_certificacion_upme` quedó en `false` y el motor
 * lo mandó por la vía corta: se saltó **Cargue, Pago UPME y Certificación**, que el
 * cliente sí había contratado. Se corrigió a mano por SQL. Hay al menos dos casos más con
 * la misma forma (V0107, V0114).
 *
 * ── Qué hace este módulo ──────────────────────────────────────────────────────────────
 * Nada más que las REGLAS, puras y probadas: recorrer el routing con un juego de valores,
 * comparar el recorrido que el caso DEBÍA hacer contra el que HIZO, y decir a qué etapa
 * habría que devolverlo. No mueve nada, no consulta nada. Ejecutar es de
 * `src/lib/correcciones/reversa.ts`, y **la decisión es siempre de una persona**: devolver
 * un caso tiene consecuencias de plata (gates de saldo, cobros abiertos, cuentas emitidas).
 *
 * ── Por qué vive aparte ───────────────────────────────────────────────────────────────
 * Las mismas reglas las aplican la detección al guardar la corrección, la consulta que
 * dibuja la propuesta en pantalla, y la revalidación al aplicarla. Tres sitios que tienen
 * que decir exactamente lo mismo; si cada uno las implementara por su cuenta terminarían
 * divergiendo, que es el defecto que ya costó caro con el ranking calculado en dos
 * funciones y con la fórmula de saldo escrita en cuatro.
 *
 * ── Opt-in ────────────────────────────────────────────────────────────────────────────
 * La LÍNEA lo declara: `lineas_negocio.config_extra.reversa_ruta.activa = true`. Una línea
 * que no lo declare se comporta exactamente igual que hoy. No hay una sola referencia a
 * SOENA dentro de `src/`.
 */

import type { RoutingEtapa } from './dato-de-decision'

export interface EtapaRuta {
  id: string
  nombre: string
  /** Orden INTERNO. Es el vocabulario del routing; NO ordena el recorrido. */
  orden: number
  /** Número VISIBLE de la etapa. Es el que ve el equipo. */
  numero: number
  routing?: RoutingEtapa | null
  /**
   * ¿La etapa tiene al menos una casilla configurada?
   *
   * ⚠️ La prueba de que un caso pasó por una etapa es tener instancias de sus casillas
   * (solo nacen al entrar). Una etapa SIN casillas configuradas no puede producir esa
   * prueba nunca, así que aparecería como "omitida" en todos los casos y para siempre.
   * Sin este dato, la propuesta invitaría a devolver casos sanos una y otra vez.
   */
  tieneCasillas: boolean
  /**
   * ¿Esta etapa se puede saltar legítimamente cuando el saldo está cubierto?
   *
   * ⚠️ Su ausencia del recorrido NO es prueba de una ruta equivocada: el motor la salta a
   * propósito cuando no queda nada por cobrar ahí (`aplicaSaltoPorSaldo` +
   * `debeSaltarPorSaldo`), y ese salto encadena varias etapas de un solo avance. Medido en
   * SOENA sobre V0107 y V0114: fueron de Documentación a Cita saltándose CINCO etapas, y
   * dos de ellas (Precobro y Cobro) por esta vía, que es correcta. Contarlas como omitidas
   * llenaría la propuesta de ruido, y en el peor caso propondría devolver un caso a una
   * etapa que no tenía nada que hacer.
   *
   * Se ignoran en bloque en vez de recalcular su saldo: el saldo de HOY no dice qué saldo
   * había el día que el caso pasó por ahí, así que cualquier recálculo sería una
   * reconstrucción, no un hecho. Ante la duda, no proponer.
   */
  puedeSaltarsePorSaldo: boolean
}

/** El bolsillo de datos de cada etapa, indexado por su `orden`. */
export type ValoresPorOrden = Record<number, Record<string, unknown>>

/** Tope del recorrido. Un routing mal configurado no puede colgar la detección. */
const MAX_PASOS = 60

/**
 * ¿Esta línea tiene encendida la reversa de ruta?
 *
 * Solo el booleano `true` la enciende. Una config a medio escribir (`"true"`, `1`) NO
 * cambia el comportamiento: proponer mover un caso es demasiado caro para hacerlo por
 * accidente. Mismo criterio que `exigeDatoDeDecision`.
 */
export function reversaActiva(configExtraLinea: Record<string, unknown> | null | undefined): boolean {
  const cfg = configExtraLinea?.reversa_ruta as { activa?: unknown } | undefined
  return cfg?.activa === true
}

/**
 * A qué etapa manda el routing de `etapa` con este juego de valores.
 *
 * Replica exactamente lo que hace el motor en `cambiarEtapaNegocioConGate`:
 *   1. Los campos se leen de la etapa FUENTE (`routing.source_etapa_orden`), que es el
 *      caso normal y no el raro: el interruptor suele vivir varias etapas antes.
 *   2. Primera condición que coincide gana, comparando `String(valor ?? '')`.
 *   3. Si ninguna coincide, el camino por defecto.
 *   4. Sin routing, la siguiente por orden ASCENDENTE — nunca `orden + 1`, que asume
 *      contigüidad y falla con los huecos que deja fusionar etapas.
 *
 * Devuelve `null` cuando el proceso cierra ahí: una etapa que se apunta a sí misma es la
 * forma de declarar el cierre, y una sin siguiente tampoco tiene a dónde ir.
 */
export function destinoDeEtapa(
  etapa: EtapaRuta,
  etapas: readonly EtapaRuta[],
  valores: ValoresPorOrden,
): number | null {
  const routing = etapa.routing
  if (!routing) {
    const siguiente = [...etapas].sort((a, b) => a.orden - b.orden).find(e => e.orden > etapa.orden)
    return siguiente ? siguiente.orden : null
  }

  const fuente = typeof routing.source_etapa_orden === 'number' ? routing.source_etapa_orden : etapa.orden
  const bolsa = valores[fuente] ?? {}

  let destino = routing.default_etapa_orden
  for (const regla of routing.conditional ?? []) {
    const campo = regla?.condition?.field
    if (typeof campo !== 'string') continue
    if (String(bolsa[campo] ?? '') === String(regla.condition.value)) {
      destino = regla.etapa_orden
      break
    }
  }

  if (typeof destino !== 'number') return null
  // Apuntarse a sí misma es como se declara "el proceso cierra aquí".
  return destino === etapa.orden ? null : destino
}

/**
 * El recorrido que el proceso haría desde una etapa, con este juego de valores.
 *
 * Devuelve los `orden` de las etapas SIGUIENTES (el origen no va incluido). Se detiene al
 * cerrar el proceso, al repetir una etapa (routing cíclico), al tocar `pararEn`, o al
 * llegar al tope.
 *
 * ⚠️ Las etapas que el caso nunca recorrió no tienen datos, así que sus routings resuelven
 * por el camino por defecto. Es lo mismo que le pasaría al caso de verdad al recorrerlas
 * sin responder nada, pero significa que **solo el primer tramo es una certeza**: de ahí
 * en adelante el recorrido es la predicción del sistema, no un hecho. Por eso lo que se
 * propone mover es el PRIMER destino omitido, y el resto de la lista se muestra como
 * contexto.
 */
export function recorridoDesde(
  etapas: readonly EtapaRuta[],
  origenOrden: number,
  valores: ValoresPorOrden,
  pararEn?: number,
): number[] {
  const porOrden = new Map(etapas.map(e => [e.orden, e]))
  const camino: number[] = []
  const vistas = new Set<number>([origenOrden])

  let actual = porOrden.get(origenOrden)
  for (let i = 0; actual && i < MAX_PASOS; i++) {
    const siguiente = destinoDeEtapa(actual, etapas, valores)
    if (siguiente === null) break
    if (vistas.has(siguiente)) break
    vistas.add(siguiente)
    camino.push(siguiente)
    if (siguiente === pararEn) break
    actual = porOrden.get(siguiente)
    if (!actual) break
  }

  return camino
}

export interface Divergencia {
  /** Órdenes que el caso debía haber recorrido y no recorrió, en orden de camino. */
  omitidas: number[]
  /** La PRIMERA omitida: la única que se propone mover. `null` = no hay divergencia. */
  destino: number | null
}

/**
 * ¿El recorrido real del caso se separó del que le corresponde con los valores de hoy?
 *
 * Se recorre el routing desde el punto de decisión con los valores VIGENTES y se compara
 * contra los hechos: qué etapas tiene el caso realmente recorridas.
 *
 * Tres decisiones que evitan proponer de más:
 *
 * 1. **Se para donde está el caso.** Lo que viene después de su etapa actual no está
 *    omitido, está por hacer. Sin esto, la propuesta señalaría medio proceso.
 * 2. **Una etapa sin casillas configuradas se ignora.** No puede dejar prueba de haber
 *    sido recorrida, así que juzgarla sería llamar omitida a una etapa sana (ver
 *    `EtapaRuta.tieneCasillas`). Por la misma razón se ignora una etapa que el motor puede
 *    saltar legítimamente por saldo cubierto (ver `EtapaRuta.puedeSaltarsePorSaldo`): su
 *    ausencia tiene una explicación normal y frecuente.
 * 3. **La etapa de decisión y la actual nunca son destino.** La primera ya se recorrió por
 *    definición; devolver a la segunda no movería nada.
 *
 * ⚠️ Y una cuarta, que solo apareció al probarlo: **si el caso SIGUE en el punto de
 * decisión, no hay nada que revisar.** El motor todavía no decidió, así que corregir el
 * dato basta. Sin este corte el recorrido se va hasta el final del proceso sin volver a
 * tocar la etapa donde está el caso, y la propuesta declara omitido medio flujo — el peor
 * falso positivo posible, porque llega justo cuando alguien acaba de corregir bien.
 */
export function divergenciaDeRuta(input: {
  etapas: readonly EtapaRuta[]
  /** Etapa que EVALÚA el routing que se está revisando. */
  decisionOrden: number
  /** Valores vigentes por etapa (ya con la corrección aplicada y sus derivados). */
  valores: ValoresPorOrden
  /** Órdenes con prueba de recorrido: el caso tiene instancias de sus casillas. */
  recorridas: ReadonlySet<number>
  /** Dónde está el caso ahora. */
  etapaActualOrden: number
}): Divergencia {
  const { etapas, decisionOrden, valores, recorridas, etapaActualOrden } = input
  if (etapaActualOrden === decisionOrden) return { omitidas: [], destino: null }

  const porOrden = new Map(etapas.map(e => [e.orden, e]))

  const camino = recorridoDesde(etapas, decisionOrden, valores, etapaActualOrden)

  const omitidas: number[] = []
  for (const orden of camino) {
    if (orden === etapaActualOrden || orden === decisionOrden) continue
    const etapa = porOrden.get(orden)
    if (!etapa || !etapa.tieneCasillas) continue
    if (etapa.puedeSaltarsePorSaldo) continue
    if (recorridas.has(orden)) continue
    omitidas.push(orden)
  }

  return { omitidas, destino: omitidas[0] ?? null }
}

/**
 * El aviso, en palabras del equipo: por dónde debía pasar el caso y a dónde se propone
 * devolverlo. La línea puede reemplazarlo entero con `reversa_ruta.aviso`.
 */
export function mensajePropuesta(
  omitidas: readonly { nombre: string }[],
  destino: { nombre: string },
  avisoConfigurado?: string | null,
): string {
  if (typeof avisoConfigurado === 'string' && avisoConfigurado.trim() !== '') return avisoConfigurado
  const nombres = omitidas.map(e => e.nombre)
  const lista =
    nombres.length <= 1
      ? nombres[0] ?? destino.nombre
      : `${nombres.slice(0, -1).join(', ')} y ${nombres[nombres.length - 1]}`
  return `Con este cambio el caso debía pasar por ${lista}, y no pasó. ¿Devolverlo a ${destino.nombre}?`
}
